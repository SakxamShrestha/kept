/**
 * Build the committed baseline ledger.
 *
 * Runs offline with NEBIUS_CACHE_WRITE=1 so that every model call the demo path
 * needs lands in data/cache. The app must then render the whole ledger, and
 * replay the money shot, with no API key present at all - which is what keeps
 * the demo alive through the twelve weeks between submission and judging.
 *
 * Usage:
 *   NEBIUS_CACHE_WRITE=1 npx tsx scripts/build-ledger.mts
 *   NEBIUS_CACHE_WRITE=1 npx tsx scripts/build-ledger.mts --no-gate
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extractFromMessage, type Message } from "../lib/extract";
import { shouldExtract } from "../lib/gate";
import { embed, cosine } from "../lib/nebius";
import {
  reconcileMessage,
  applyTransition,
  rowFromCommitment,
  TERMINAL,
  type LedgerRow,
} from "../lib/reconcile";

const args = process.argv.slice(2);
const useGate = !args.includes("--no-gate");

const messages: Message[] = JSON.parse(await readFile("data/corpus/messages.json", "utf8"));
const meta = JSON.parse(await readFile("data/corpus/meta.json", "utf8"));
const OWNER: string[] = [meta.owner.email];

messages.sort((a, b) => a.date_iso.localeCompare(b.date_iso));

console.log(`Building ledger from ${messages.length} messages (gate: ${useGate ? "on" : "off"})\n`);

// ---------------------------------------------------------------- pass 1: extract
const rows: LedgerRow[] = [];
const byId = new Map<string, Message>();
let gated = 0;
let extractCalls = 0;

for (const msg of messages) {
  byId.set(msg.id, msg);

  if (useGate) {
    const gate = await shouldExtract(msg);
    if (!gate.hasCommitment) {
      gated++;
      continue;
    }
  }

  extractCalls++;
  const { commitments } = await extractFromMessage(msg, OWNER);
  for (const c of commitments) {
    rows.push(rowFromCommitment(c, rows.length));
  }
}

console.log(`extracted ${rows.length} commitments from ${extractCalls} messages` +
  (useGate ? ` (${gated} skipped by gate, ${Math.round((gated / messages.length) * 100)}% saved)` : ""));

// ---------------------------------------------------------------- dedupe
// A promise restated across a thread is one obligation, not three. Collapse
// only within a thread and direction - two different people owing you the same
// kind of thing are genuinely two rows.
const deduped: LedgerRow[] = [];
const dropped: string[] = [];

if (rows.length > 1) {
  let vectors: number[][] = [];
  try {
    vectors = await embed(rows.map((r) => r.what));
  } catch {
    vectors = [];
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dupeOf = deduped.find((kept, j) => {
      if (kept.origin.thread_id !== row.origin.thread_id) return false;
      if (kept.direction !== row.direction) return false;
      if (kept.counterparty.toLowerCase() !== row.counterparty.toLowerCase()) return false;
      if (!vectors.length) return kept.what.toLowerCase() === row.what.toLowerCase();
      const ki = rows.indexOf(deduped[j]);
      return cosine(vectors[i], vectors[ki]) > 0.85;
    });
    if (dupeOf) dropped.push(`${row.what} (dupe of ${dupeOf.id})`);
    else deduped.push(row);
  }
} else {
  deduped.push(...rows);
}

if (dropped.length) console.log(`deduped ${dropped.length}: ${dropped.join(", ")}`);

// ------------------------------------------------- pass 2: chronological reconcile
// Replay the mailbox in order. Each message sees only the rows that existed
// before it, which is what makes the resulting history honest rather than
// reconstructed after the fact.
const ledger = new Map<string, LedgerRow>(deduped.map((r) => [r.id, r]));
let transitionCount = 0;
let droppedTransitions = 0;

for (const msg of messages) {
  const open = [...ledger.values()].filter(
    (r) => !TERMINAL.has(r.state) && r.origin.at < msg.date_iso,
  );
  if (open.length === 0) continue;

  const { applied, dropped: dr } = await reconcileMessage(msg, open);
  droppedTransitions += dr.length;

  for (const t of applied) {
    const row = ledger.get(t.commitment_id);
    if (!row) continue;
    ledger.set(t.commitment_id, applyTransition(row, t, msg));
    transitionCount++;
    console.log(`  ${msg.date_iso.slice(0, 10)}  ${t.commitment_id} -> ${t.new_state}  (${t.rationale})`);
  }
}

console.log(`\n${transitionCount} transitions applied, ${droppedTransitions} dropped as ungrounded`);

// ---------------------------------------------------------------- write
const out = [...ledger.values()].sort((a, b) => {
  const ao = a.due_iso ?? "9999";
  const bo = b.due_iso ?? "9999";
  return ao.localeCompare(bo);
});

await mkdir("data/ledger", { recursive: true });
await writeFile("data/ledger/baseline.json", JSON.stringify(out, null, 2));

const byState = out.reduce<Record<string, number>>((acc, r) => {
  acc[r.state] = (acc[r.state] ?? 0) + 1;
  return acc;
}, {});

console.log(`\n${out.length} rows -> data/ledger/baseline.json`);
console.log(Object.entries(byState).map(([s, n]) => `  ${s}: ${n}`).join("\n"));
