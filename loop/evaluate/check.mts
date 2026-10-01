/**
 * The ratchet.
 *
 * Deterministic, free, and fast enough to run after every change: it makes no
 * model calls at all. Its single job is to answer "did this change break
 * something that used to work", and to answer it the same way every time.
 *
 * That determinism is the whole reason it is separate from loop:eval. `seed` is
 * accepted by Token Factory and does not give reproducibility - the same
 * reconcile prompt produced a transition on one run and none on the next - so any
 * check that calls a model is a noisy signal, useless as a tripwire. Everything
 * here reads committed artifacts and source instead.
 *
 * It compares against loop/baseline/scorecard.json, which pins the COUNT of
 * assertions in each suite as well as their result. That matters: without it, the
 * cheapest way to make this command green is to delete the assertion that was
 * failing. Pinning the count makes deletion itself a regression.
 *
 *   npm run loop:check           every gate, including the production build
 *   npm run loop:check -- --fast skip the build when iterating tightly
 *
 * Exit code is 0 only when nothing regressed. Anything else means revert.
 */

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { runInvariants } from "./invariants";

const FAST = process.argv.includes("--fast");
const BASELINE = "loop/baseline/scorecard.json";

interface Baseline {
  recorded_at: string;
  commit: string;
  gates: {
    G1_ledger_assertions: number;
    G2_rot_checks: number;
    G7_G8_invariants: number;
  };
}

interface GateResult {
  id: string;
  name: string;
  ok: boolean;
  /** Assertions that ran, where the suite reports a count. */
  count?: number;
  expected?: number;
  detail: string;
}

const gates: GateResult[] = [];

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

const baseline: Baseline = JSON.parse(await readFile(BASELINE, "utf8"));

console.log(`\nRatchet — against the baseline recorded ${baseline.recorded_at} (${baseline.commit})\n`);

// --- G1: the ledger acceptance assertions ----------------------------------
{
  const { code, out } = await run("npx", ["tsx", "evals/reconcile.test.mts"]);
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const passed = m ? Number(m[1]) : 0;
  const expected = baseline.gates.G1_ledger_assertions;
  gates.push({
    id: "G1",
    name: "ledger acceptance assertions",
    ok: code === 0 && passed >= expected,
    count: passed,
    expected,
    detail:
      code !== 0
        ? (out.match(/Failures:[\s\S]*/)?.[0] ?? "suite exited non-zero").slice(0, 400)
        : passed < expected
          ? `only ${passed} assertions ran; the baseline has ${expected}. An assertion was removed.`
          : "",
  });
}

// --- G2: the rot checks, with no API key present ---------------------------
{
  const { code, out } = await run("npx", ["tsx", "scripts/test-rot.mts"]);
  const m = out.match(/All (\d+) rot checks passed/) ?? out.match(/\d+ of (\d+) rot checks FAILED/);
  const ran = m ? Number(m[1]) : 0;
  const expected = baseline.gates.G2_rot_checks;
  gates.push({
    id: "G2",
    name: "rot checks with no API key",
    ok: code === 0 && ran >= expected,
    count: ran,
    expected,
    detail:
      code !== 0
        ? (out.match(/FAILED[\s\S]*/)?.[0] ?? "suite exited non-zero").slice(0, 400)
        : ran < expected
          ? `only ${ran} checks ran; the baseline has ${expected}. A check was removed.`
          : "",
  });
}

// --- G3: typecheck ---------------------------------------------------------
{
  const { code, out } = await run("npx", ["tsc", "--noEmit"]);
  gates.push({
    id: "G3",
    name: "typecheck",
    ok: code === 0,
    detail: code === 0 ? "" : out.split("\n").filter((l) => l.includes("error")).slice(0, 5).join("\n        "),
  });
}

// --- G4: the production build ----------------------------------------------
if (FAST) {
  gates.push({ id: "G4", name: "production build", ok: true, detail: "skipped (--fast)" });
} else {
  const { code, out } = await run("npm", ["run", "build"]);
  gates.push({
    id: "G4",
    name: "production build",
    ok: code === 0,
    detail: code === 0 ? "" : out.split("\n").slice(-12).join("\n        "),
  });
}

// --- G7 + G8: the invariants -----------------------------------------------
{
  const all = await runInvariants();
  const failed = all.filter((r) => !r.ok);
  const expected = baseline.gates.G7_G8_invariants;
  gates.push({
    id: "G7+G8",
    name: "invariants and prompt/code couplings",
    ok: failed.length === 0 && all.length >= expected,
    count: all.length,
    expected,
    detail: failed.length
      ? failed.map((r) => `${r.gate} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`).join("\n        ")
      : all.length < expected
        ? `only ${all.length} invariants ran; the baseline has ${expected}. One was removed.`
        : "",
  });
}

// ---------------------------------------------------------------------------

for (const g of gates) {
  const counts = g.count !== undefined ? `  ${g.count}/${g.expected}` : "";
  console.log(`  ${g.ok ? "ok  " : "FAIL"}  ${g.id.padEnd(5)} ${g.name}${counts}`);
  if (g.detail) console.log(`        ${g.detail}`);
}

const failed = gates.filter((g) => !g.ok);
console.log("");

if (failed.length === 0) {
  console.log(`Nothing regressed. ${gates.length} gates green.`);
  if (FAST) console.log("Note: --fast skipped the production build. Run it fully before committing.");
  process.exit(0);
}

console.error(
  `${failed.length} gate(s) regressed: ${failed.map((g) => g.id).join(", ")}.\n` +
    `Revert the change. A gate is never the thing to fix - see loop/PROJECT.md.`,
);
process.exit(1);
