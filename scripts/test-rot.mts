/**
 * The rot test — the cheapest insurance this repo carries.
 *
 * Submissions close Oct 30; judging runs Dec 1-15. In the twelve weeks between
 * those two dates the things that quietly kill a demo are: a model ID
 * deprecated with no rerouting, an API key rotated or expired, a trial credit
 * balance hitting zero, a free database tier reclaimed. None of them announce
 * themselves. A judge just opens the URL and sees an error page, and the
 * submission scores whatever an error page scores.
 *
 * So this asserts the one property that makes all of those survivable: with no
 * NEBIUS_API_KEY present at all, the committed ledger still loads, every row
 * still carries a receipt that can be checked against the message it came from,
 * the money shot is still in the state the demo narrates, and the response
 * cache still covers the model calls the demo path makes.
 *
 * Run it:  npm run test:rot
 *
 * It deletes the key from its own environment first, so it means the same thing
 * on a laptop with a working .env.local as it does on a machine that has never
 * had one.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------- harness

const failures: string[] = [];
let checks = 0;

function ok(label: string): void {
  checks++;
  console.log(`  ok    ${label}`);
}

function fail(label: string, detail: string): void {
  checks++;
  failures.push(`${label}\n        ${detail}`);
  console.log(`  FAIL  ${label}`);
  console.log(`        ${detail}`);
}

function check(label: string, condition: boolean, detail: string): boolean {
  if (condition) ok(label);
  else fail(label, detail);
  return condition;
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ------------------------------------------------------- no key, on purpose

const hadKey = Boolean(process.env.NEBIUS_API_KEY);
delete process.env.NEBIUS_API_KEY;

console.log("Rot test — can this demo still demonstrate itself with no API key?\n");
console.log(
  hadKey
    ? "NEBIUS_API_KEY was set in this environment and has been removed for the duration of this test."
    : "NEBIUS_API_KEY was not set. Good — that is the condition under test.",
);

// Imported after the key is removed, so nothing can capture it at module scope.
// This also proves the render path's own modules load in a keyless process,
// which is the failure the app would actually hit in December.
const { loadLedger, loadMeta, decorate, buildView } = await import("../lib/ledger");
type LedgerRow = Awaited<ReturnType<typeof loadLedger>>[number];

interface CorpusMessage {
  id: string;
  body_text: string;
}

/**
 * Quote matching, normalized the same way lib/extract.ts normalizes it: curly
 * quotes, escaped quotes and line wrapping differ between what the model
 * returned and what is stored, and none of those differences mean the receipt
 * is wrong.
 */
function flatten(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\\(["'])/g, "$1")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// ---------------------------------------------------------------- the ledger

section("1. The committed ledger loads with no key");

let rows: LedgerRow[] = [];
try {
  rows = await loadLedger();
  check(
    "data/ledger/baseline.json loads and has rows",
    rows.length > 0,
    "The ledger file parsed but is empty. Rebuild it with `npm run build:ledger` (needs a key) and commit the result.",
  );
} catch (e) {
  fail(
    "data/ledger/baseline.json loads and has rows",
    `Could not read the committed ledger: ${e instanceof Error ? e.message : String(e)}`,
  );
}

let today = "";
try {
  const meta = await loadMeta();
  today = meta.today;
  check(
    "data/corpus/meta.json carries the frozen demo date",
    Boolean(meta.today) && !Number.isNaN(new Date(meta.today).getTime()),
    `meta.today is ${JSON.stringify(meta.today)}. Overdue is computed against this, not the wall clock; without it a judge in December sees a mailbox that looks abandoned.`,
  );
} catch (e) {
  fail(
    "data/corpus/meta.json carries the frozen demo date",
    `Could not read the corpus metadata: ${e instanceof Error ? e.message : String(e)}`,
  );
}

let corpus = new Map<string, CorpusMessage>();
try {
  const messages: CorpusMessage[] = JSON.parse(
    await readFile(path.join(process.cwd(), "data", "corpus", "messages.json"), "utf8"),
  );
  corpus = new Map(messages.map((m) => [m.id, m]));
  check(
    "data/corpus/messages.json loads",
    corpus.size > 0,
    "The corpus is empty, so no receipt can be checked against its source message.",
  );
} catch (e) {
  fail(
    "data/corpus/messages.json loads",
    `Could not read the corpus: ${e instanceof Error ? e.message : String(e)}`,
  );
}

if (rows.length > 0 && today) {
  try {
    const meta = await loadMeta();
    const view = buildView(decorate(rows, meta));
    check(
      "the ledger view the UI renders builds without a network call",
      view.owedByMe.length + view.owedToMe.length + view.needsReview.length + view.closed.length ===
        rows.length,
      "buildView() dropped or duplicated rows, so the two columns plus the review and closed buckets do not account for the whole ledger.",
    );
  } catch (e) {
    fail(
      "the ledger view the UI renders builds without a network call",
      `Rendering logic threw in a keyless process: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// ---------------------------------------------------------------- receipts

section("2. Every row carries a receipt that can be checked");

if (rows.length > 0) {
  const noQuote = rows.filter((r) => !r.origin?.quote || r.origin.quote.trim().length < 10);
  check(
    "every row has a non-trivial origin.quote",
    noQuote.length === 0,
    `${noQuote.length} row(s) have no usable evidence quote: ${noQuote.map((r) => r.id).join(", ")}. A row without a receipt is a guess, and the product's premise is that the ledger can be trusted without re-reading the thread.`,
  );

  const noCounterparty = rows.filter((r) => !r.counterparty || !r.counterparty.trim());
  check(
    "every row names a counterparty",
    noCounterparty.length === 0,
    `${noCounterparty.length} row(s) have an empty counterparty: ${noCounterparty.map((r) => r.id).join(", ")}. A debt owed to nobody cannot be chased.`,
  );

  if (corpus.size > 0) {
    const ungrounded: string[] = [];
    for (const r of rows) {
      const src = corpus.get(r.origin.message_id);
      if (!src) {
        ungrounded.push(`${r.id} (origin message ${r.origin.message_id} is not in the corpus)`);
        continue;
      }
      if (!flatten(src.body_text).includes(flatten(r.origin.quote))) {
        ungrounded.push(`${r.id} (quote is not present in ${r.origin.message_id})`);
      }
    }
    check(
      "every origin.quote appears verbatim in the message it cites",
      ungrounded.length === 0,
      `${ungrounded.length} ungrounded receipt(s): ${ungrounded.join("; ")}`,
    );

    const badHistory: string[] = [];
    for (const r of rows) {
      for (const h of r.history ?? []) {
        const src = corpus.get(h.evidence_message_id);
        if (!src) {
          badHistory.push(`${r.id} -> ${h.state} (message ${h.evidence_message_id} missing)`);
          continue;
        }
        if (!flatten(src.body_text).includes(flatten(h.evidence_quote))) {
          badHistory.push(`${r.id} -> ${h.state} (quote not in ${h.evidence_message_id})`);
        }
        if (!h.rationale || !h.rationale.trim()) {
          badHistory.push(`${r.id} -> ${h.state} (no rationale to show the user)`);
        }
      }
    }
    check(
      "every state transition quotes the message that caused it",
      badHistory.length === 0,
      `${badHistory.length} unsupported transition(s): ${badHistory.join("; ")}`,
    );
  }
}

// ---------------------------------------------------------------- money shot

section("3. The money shot is in the state the demo narrates");

// Identified by structure, not by phrasing: the model rewords `what` between
// builds, and a test pinned to a literal string fails on a correct result.
const moneyShot = rows.find(
  (r) =>
    r.counterparty.toLowerCase().startsWith("marcus@") &&
    /vendor list/i.test(`${r.what} ${r.origin?.quote ?? ""}`),
);

if (
  check(
    "the Marcus vendor-list row exists",
    Boolean(moneyShot),
    "No row for Marcus's vendor list. The whole demo is built on this row; without it there is nothing to show.",
  ) &&
  moneyShot
) {
  check(
    "it is partially_satisfied",
    moneyShot.state === "partially_satisfied",
    `State is "${moneyShot.state}". The demo narrates a partial delivery — eleven of thirteen vendors — moving the row to partly delivered. Rebuild the ledger and re-run npm run test:ledger.`,
  );
  check(
    "it carries its state history",
    (moneyShot.history?.length ?? 0) > 0,
    "History is empty, so the expanded receipt has nothing to show about how the row got here. History is append-only for exactly this reason.",
  );
  check(
    "it has a resolved deadline, so it can be shown as overdue",
    Boolean(moneyShot.due_iso),
    "due_iso is null. The row cannot be shown as late, which is the entire point of the demo's opening frame.",
  );
}

// ---------------------------------------------------------------- the cache

section("4. The response cache covers the demo path");

try {
  const cacheDir = path.join(process.cwd(), "data", "cache");
  const files = (await readdir(cacheDir)).filter((f) => f.endsWith(".json"));

  if (
    check(
      "data/cache has committed entries",
      files.length > 0,
      "The cache is empty, so any model call on the demo path throws the moment the key is gone. Rebuild with NEBIUS_CACHE_WRITE=1 and commit data/cache.",
    )
  ) {
    let gate = 0;
    let extract = 0;
    let reconcile = 0;
    let partial = 0;
    let unreadable = 0;

    for (const f of files) {
      let entry: { data?: Record<string, unknown> };
      try {
        entry = JSON.parse(await readFile(path.join(cacheDir, f), "utf8"));
      } catch {
        unreadable++;
        continue;
      }
      const data = entry.data ?? {};
      if ("has_commitment" in data) gate++;
      if (Array.isArray(data.commitments)) extract++;
      if (Array.isArray(data.transitions)) {
        reconcile++;
        const transitions = data.transitions as { new_state?: string }[];
        if (transitions.some((t) => t.new_state === "partially_satisfied")) partial++;
      }
    }

    check(
      "every cache entry parses",
      unreadable === 0,
      `${unreadable} cache file(s) are not readable JSON. A corrupt entry is a cache miss, and a cache miss with no key is an exception.`,
    );
    // Cache keys are namespaced by pipeline role rather than model ID, so this
    // is checking that all three roles are covered, not that three models are.
    check(
      "the Nano gate stage is cached",
      gate > 0,
      "No cached gate responses. The first model call of every message would go live.",
    );
    check(
      "the Super extraction stage is cached",
      extract > 0,
      "No cached extraction responses.",
    );
    check(
      "the Super reconciliation stage is cached",
      reconcile > 0,
      "No cached reconciliation responses.",
    );
    check(
      "the partial-delivery transition is cached",
      partial > 0,
      "No cached reconcile response contains a partially_satisfied transition, so the money shot cannot be replayed without a live call.",
    );

    console.log(
      `        ${files.length} entries: ${gate} gate, ${extract} extract, ${reconcile} reconcile`,
    );
  }
} catch (e) {
  fail(
    "data/cache has committed entries",
    `Could not read data/cache: ${e instanceof Error ? e.message : String(e)}`,
  );
}

// ---------------------------------------------------------------- verdict

console.log("");
if (failures.length === 0) {
  console.log(`All ${checks} rot checks passed with no NEBIUS_API_KEY present.`);
  console.log("The ledger, its receipts, the money shot and the cached demo path all survive.");
  process.exit(0);
}

console.error(`${failures.length} of ${checks} rot checks FAILED with no NEBIUS_API_KEY present.`);
console.error("This demo will not demonstrate itself once the key or the model IDs go stale.\n");
for (const f of failures) console.error(`  - ${f}`);
console.error("");
process.exit(1);
