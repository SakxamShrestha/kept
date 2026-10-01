/**
 * Fill the committed response cache for the two runtime routes.
 *
 * The routes call Token Factory live, which is the point - the demo should show a
 * Nemotron call happening. But submissions close Oct 30 and judging runs Dec 1-15,
 * and in those nine weeks a model ID can be retired, a key rotated, or a credit
 * balance hit zero. A judge would then click "Run now" and get a 503.
 *
 * So the exact calls the demo path makes are made once here, deliberately, with
 * NEBIUS_CACHE_WRITE=1, and the resulting entries are committed. After that the
 * routes answer from disk whether or not a key exists.
 *
 * This calls the same lib functions the routes call, with the same arguments, so
 * the cache keys are identical - lib/nebius.ts keys on role + messages + schema
 * name + effort + temperature, never on the resolved model ID, so the entries also
 * survive a model swap.
 *
 *   npm run prewarm
 *
 * What is NOT covered, stated plainly: a viewer who edits a playbook on the Skills
 * screen changes the prompt, which changes the cache key, so their draft needs a
 * live key. That is correct behaviour - an edited playbook is a different request -
 * and the four builtins are what the untouched demo uses.
 */

import { extractFromMessage, type Message } from "../lib/extract";
import { shouldExtract } from "../lib/gate";
import { generateDraft, prepareDraft } from "../lib/draft";
import { isLive, loadLedger, loadMeta } from "../lib/ledger";
import { reconcileMessage, TERMINAL } from "../lib/reconcile";
import { DEFAULT_PLAYBOOKS } from "../lib/policy";
import { readFile } from "node:fs/promises";
import path from "node:path";

if (process.env.NEBIUS_CACHE_WRITE !== "1") {
  console.error(
    "NEBIUS_CACHE_WRITE is not 1, so nothing would be written and this would just\n" +
      "spend tokens. Run it through `npm run prewarm`.",
  );
  process.exit(1);
}

/** The money-shot row. Pre-warmed against every playbook, because it is the one a
 *  judge is most likely to open and try more than one tone on. */
const PRIMARY_ROW = "c004";

const meta = await loadMeta();
const baseline = await loadLedger();
let calls = 0;

// ------------------------------------------------------------ /api/reconcile

const heldPath = path.join(process.cwd(), "data", "corpus", "held-back.json");
const held: { messages: Message[] } = JSON.parse(await readFile(heldPath, "utf8"));

console.log(`\nReconcile route — ${held.messages.length} held-back message(s)\n`);

for (const msg of held.messages) {
  const gate = await shouldExtract(msg);
  calls++;
  console.log(`  ${msg.id}`);
  console.log(`    gate: ${gate.hasCommitment ? "may carry a promise" : "no new promise"}`);

  if (gate.hasCommitment) {
    const extracted = await extractFromMessage(msg, [meta.owner.email]);
    calls++;
    console.log(`    extract: ${extracted.commitments.length} commitment(s)`);
  }

  // Same scoping as the route: same thread, still open, originating earlier. This
  // is what makes selectCandidates short-circuit without an embeddings call, and
  // it is why this entry is replayable with no key at all.
  const open = baseline.filter(
    (r) =>
      r.origin.thread_id === msg.thread_id &&
      !TERMINAL.has(r.state) &&
      r.origin.at < msg.date_iso,
  );
  if (open.length === 0) {
    console.log(`    reconcile: no open rows in this thread, nothing to cache`);
    continue;
  }
  const { applied, dropped, source } = await reconcileMessage(msg, open);
  calls++;
  console.log(
    `    reconcile: ${applied.length} applied, ${dropped.length} dropped (${source})` +
      (applied.length ? ` → ${applied.map((t) => `${t.commitment_id}:${t.new_state}`).join(", ")}` : ""),
  );
}

// ---------------------------------------------------------------- /api/draft

const chaseable = baseline.filter(isLive);

console.log(`\nDraft route — ${chaseable.length} chaseable row(s)\n`);

for (const row of chaseable) {
  // Every row gets the default tone; the money shot gets all four, since that is
  // the row a judge will try the picker on.
  const books = row.id === PRIMARY_ROW ? DEFAULT_PLAYBOOKS : [DEFAULT_PLAYBOOKS[0]];

  for (const pb of books) {
    try {
      const input = await prepareDraft(row.id, {
        id: pb.id,
        name: pb.name,
        tone: pb.tone,
        instruction: pb.instruction,
      });
      const res = await generateDraft(input);
      calls++;
      console.log(
        `  ${row.id}  ${pb.name.padEnd(22)} ${res.source.padEnd(5)} ` +
          `${res.quoted ? "grounded" : "NOT GROUNDED"}  ${res.tokens} tok`,
      );
    } catch (err) {
      // One bad row must not abandon the rest of the cache.
      console.log(`  ${row.id}  ${pb.name.padEnd(22)} FAILED  ${(err as Error).message.slice(0, 80)}`);
    }
  }
}

console.log(
  `\n${calls} call(s) made. Commit data/cache/ and run \`npm run test:rot\` to confirm\n` +
    `the demo path still answers with no NEBIUS_API_KEY present.\n`,
);
