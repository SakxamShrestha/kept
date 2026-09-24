/**
 * Acceptance tests for the reconciliation state machine, from SPEC.md section 1.
 *
 * These run against the committed baseline ledger, so they test the artifact
 * the demo actually serves rather than a fresh pipeline run. Rebuild with
 * `npm run build:ledger` before running them.
 *
 * Usage: npm run test:ledger
 */

import { readFile } from "node:fs/promises";
import type { LedgerRow } from "../lib/reconcile";
import { overdueAs } from "../lib/due";

const ledger: LedgerRow[] = JSON.parse(await readFile("data/ledger/baseline.json", "utf8"));
const meta = JSON.parse(await readFile("data/corpus/meta.json", "utf8"));
const TODAY: string = meta.today;

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

const find = (pred: (r: LedgerRow) => boolean) => ledger.find(pred);
const has = (r: LedgerRow | undefined, state: string) => r?.state === state;
const historyHas = (r: LedgerRow | undefined, state: string) =>
  !!r?.history.some((h) => h.state === state);

console.log(`\nReconciliation acceptance (${ledger.length} rows, demo date ${TODAY})\n`);

// 1. THE MONEY SHOT
const vendorList = find((r) => /full vendor list/i.test(r.what));
check(
  "vendor-shortlist: Marcus's row is partially_satisfied",
  has(vendorList, "partially_satisfied"),
  vendorList ? `got ${vendorList.state}` : "row missing",
);
check(
  "vendor-shortlist: partial delivery rationale names the missing vendors",
  /delacroix|halvorsen|eleven|two/i.test(vendorList?.history.at(-1)?.rationale ?? ""),
  vendorList?.history.at(-1)?.rationale?.slice(0, 60),
);
// Assert on structure, not wording. The model phrases this row differently
// between runs ("get you those two" / "get the two vendors' paperwork"), and a
// test that pins the phrasing fails on a pipeline that is working correctly.
const vendorThread = vendorList?.origin.thread_id;
const marcusRows = ledger.filter(
  (r) => r.origin.thread_id === vendorThread && /marcus/i.test(r.counterparty),
);
check(
  "vendor-shortlist: the remainder became its own row owed by Marcus",
  marcusRows.length >= 2,
  `${marcusRows.length} Marcus row(s) in the thread`,
);
const remainder = marcusRows.find((r) => r.id !== vendorList?.id);
check(
  "vendor-shortlist: the remainder row is open with its own deadline",
  remainder?.state === "open" && !!remainder?.due_iso,
  remainder ? `${remainder.state}, due ${remainder.due_iso}` : "not found",
);

// The owner's own delivery in the same thread. This one regressed between two
// builds on identical input, which is why chat() now pins a seed.
const rubric = find((r) => /scoring rubric/i.test(r.what));
check(
  "vendor-shortlist: owner's scoring rubric is satisfied",
  has(rubric, "satisfied"),
  rubric ? `got ${rubric.state}` : "row missing",
);

// 2. RENEGOTIATED, not abandoned
const staffing = find((r) => /staffing model/i.test(r.what));
check("northwind: staffing model was renegotiated", historyHas(staffing, "renegotiated"));
check(
  "northwind: new deadline resolved to 2026-09-29",
  staffing?.due_iso?.slice(0, 10) === "2026-09-29",
  staffing?.due_iso ?? "null",
);
check("northwind: row is live again, not terminal", has(staffing, "open"), staffing?.state);

// 3. SUPERSEDED, not satisfied — the distinction the model split exists to win
const diligence = find((r) => /diligence summary/i.test(r.what));
check(
  "ridgeline: diligence summary is superseded, NOT satisfied",
  has(diligence, "superseded"),
  diligence ? `got ${diligence.state}` : "row missing",
);
const comparables = find((r) => /comparables/i.test(r.what));
check("ridgeline: replacement comparables-table row exists", !!comparables);

// 4. Clean satisfaction
const coldChain = find((r) => /cold chain|audit dates/i.test(r.what));
check(
  "mercer: cold chain audit dates satisfied",
  has(coldChain, "satisfied"),
  coldChain ? `got ${coldChain.state}` : "row missing",
);

// 5. Silence is NOT abandonment
const spec = find((r) => /integration spec/i.test(r.what));
check("brightpath: silent row stays open", has(spec, "open"), spec?.state);
check(
  "brightpath: silent row is overdue",
  overdueAs(spec?.due_iso ?? null, TODAY).overdue,
);

// 6. The ledger is uncomfortable in both directions
const processMap = find((r) => /process map/i.test(r.what));
check("owed-by-me: owner's own row is open and overdue", has(processMap, "open"));
check(
  "owed-by-me: overdue by 11 days as of the demo date",
  overdueAs(processMap?.due_iso ?? null, TODAY).daysLate === 11,
  `got ${overdueAs(processMap?.due_iso ?? null, TODAY).daysLate}`,
);
check(
  "owed-by-me: at least one row in each direction",
  ledger.some((r) => r.direction === "owed_by_me") && ledger.some((r) => r.direction === "owed_to_me"),
);

// 7. Noise produced nothing
check(
  "noise: no row from conditional offers, requests, or pleasantries",
  !ledger.some((r) => /rotterdam|org chart|lunch|availability for october|sla language/i.test(r.what)),
  ledger.find((r) => /rotterdam|org chart|lunch/i.test(r.what))?.what,
);

// Invariants
check(
  "every row carries a verbatim evidence quote",
  ledger.every((r) => r.origin.quote.trim().length >= 10),
);
check(
  "every counterparty is populated",
  ledger.every((r) => r.counterparty.trim().length > 0),
  ledger.find((r) => !r.counterparty.trim())?.id,
);
check(
  "no row invented a deadline it was not given",
  ledger.every((r) => (r.due_iso === null) === (r.due_text.trim() === "")),
);
check(
  "every transition in history has a rationale and evidence",
  ledger.every((r) => r.history.every((h) => h.rationale.trim() && h.evidence_quote.trim())),
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
