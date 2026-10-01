/**
 * The scorer — metric S1, extraction precision against the human labels.
 *
 * Two modes, and the difference matters:
 *
 *   --static   No model calls. Computes the precision of the extractions ALREADY
 *              in evals/candidates-{nano,super}-150.json from the label file
 *              alone. This is the number the README publishes, and it is free.
 *
 *   (default)  Runs the live pipeline over the frozen 150-message sample with the
 *              current prompts and scores what comes back. This is the number an
 *              optimization iteration moves.
 *
 * The live mode has one honest complication worth stating up front. The labels
 * cover the union of what Nano and Super extracted when the dumps were made. A
 * changed prompt can extract a sentence nobody ever labeled, and that candidate is
 * neither a true positive nor a false positive - it is UNLABELED.
 *
 * Counting unlabeled as wrong would penalise any novel extraction and push the
 * optimizer toward timidity. Silently dropping them would let it score well by
 * extracting only things outside the labeled set. So they are excluded from the
 * ratio and reported as a first-class number, with a trust threshold: past
 * MAX_UNLABELED_SHARE the score is not comparable to the baseline and the run says
 * so instead of printing a figure that looks usable.
 *
 *   npx tsx loop/evaluate/score-extract.mts --static
 *   npx tsx loop/evaluate/score-extract.mts --limit 40 --runs 3
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extractFromMessage, type Message } from "../../lib/extract";
import { shouldExtract } from "../../lib/gate";

const LABELS = "evals/labeled/extract-150.json";
const SAMPLE = "evals/candidates-final.json";
const SMOKE = "evals/smoke-40.json";

/** Past this share of unlabeled extractions, the run is not comparable. */
const MAX_UNLABELED_SHARE = 0.2;

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const STATIC = args.includes("--static");
const RUNS = Number(flag("runs", "1"));
const LIMIT = Number(flag("limit", "0"));
const USE_SMOKE = args.includes("--smoke");
const OUT_DIR = "loop/runs";

// --------------------------------------------------------------------- labels

interface Label {
  key: string;
  message_id: string;
  evidence_quote: string;
  found_by: string[];
  verdict: "keep" | "reject";
}

interface LabelFile {
  labels: Label[];
  pass1_complete: boolean;
  pass2_complete: boolean;
  misses: { message_id: string }[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

let labelFile: LabelFile;
try {
  labelFile = JSON.parse(await readFile(LABELS, "utf8")) as LabelFile;
} catch {
  console.error(
    `No labels at ${LABELS}.\n\n` +
      `There is no score without them, and no model may write them - see loop/PROJECT.md.\n` +
      `Run  npm run label  to do labeling pass 1 (~44 candidates, about 45 minutes).`,
  );
  process.exit(1);
}

if (labelFile.labels.length === 0) {
  console.error(`${LABELS} exists but holds no labels yet. Run  npm run label  first.`);
  process.exit(1);
}

/**
 * Match an extraction to a label by message plus quote overlap.
 *
 * Exact string equality is too strict: a reworded prompt legitimately picks
 * slightly different quote boundaries around the same sentence, and that is the
 * same commitment, not a new one. Six consecutive words shared is the same
 * tolerance lib/draft.ts uses to verify a quote, so the two agree on what
 * "the same quote" means.
 */
const WINDOW = 6;

function findLabel(messageId: string, quote: string): Label | null {
  const mine = norm(quote).split(" ").filter(Boolean);
  const candidates = labelFile.labels.filter((l) => l.message_id === messageId);
  for (const l of candidates) {
    const theirs = norm(l.evidence_quote);
    const joined = mine.join(" ");
    if (theirs === joined) return l;
    if (mine.length < WINDOW) {
      if (theirs.includes(joined) || joined.includes(theirs)) return l;
      continue;
    }
    for (let i = 0; i + WINDOW <= mine.length; i++) {
      if (theirs.includes(mine.slice(i, i + WINDOW).join(" "))) return l;
    }
  }
  return null;
}

// ------------------------------------------------------------- static scoring

interface Precision {
  model: string;
  labeled: number;
  kept: number;
  rejected: number;
  precision: number | null;
}

function staticPrecision(): Precision[] {
  return ["nano", "super"].map((model) => {
    const seen = labelFile.labels.filter((l) => l.found_by.includes(model));
    const kept = seen.filter((l) => l.verdict === "keep").length;
    return {
      model,
      labeled: seen.length,
      kept,
      rejected: seen.length - kept,
      precision: seen.length ? kept / seen.length : null,
    };
  });
}

// --------------------------------------------------------------- live scoring

interface RunResult {
  messages: number;
  gatePassed: number;
  extracted: number;
  truePositive: number;
  falsePositive: number;
  unlabeled: number;
  unlabeledShare: number;
  precision: number | null;
  /** Cost proxy: one gate call per message plus one extract call per message the
   *  gate passed. Not tokens - neither extractFromMessage() nor shouldExtract()
   *  returns usage, and lib/ is frozen to the optimizer, so a real token count
   *  needs a deliberate change to those signatures rather than a guess here. */
  calls: number;
  superCallsAvoided: number;
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function loadMessages(): Promise<Message[]> {
  const file = USE_SMOKE ? SMOKE : SAMPLE;
  let rows: { message: Message }[];
  try {
    rows = JSON.parse(await readFile(file, "utf8"));
  } catch {
    console.error(
      USE_SMOKE
        ? `No frozen smoke set at ${SMOKE}. It is stratified on the labels, so it can only be\n` +
            `built after labeling pass 1. Run without --smoke until then.`
        : `Cannot read ${file}.`,
    );
    process.exit(1);
  }
  const msgs = rows.map((r) => r.message);
  return LIMIT > 0 ? msgs.slice(0, LIMIT) : msgs;
}

async function oneRun(messages: Message[], owner: string[]): Promise<RunResult> {
  const gated = await mapLimit(messages, 6, async (m) => ({
    m,
    pass: (await shouldExtract(m, { noCache: true })).hasCommitment,
  }));
  const passed = gated.filter((g) => g.pass);

  const extractions = await mapLimit(passed, 4, async ({ m }) => {
    const res = await extractFromMessage(m, owner, { noCache: true });
    return { m, commitments: res.commitments };
  });

  let tp = 0;
  let fp = 0;
  let unlabeled = 0;
  let extracted = 0;

  for (const e of extractions) {
    for (const c of e.commitments) {
      extracted++;
      const label = findLabel(e.m.id, c.evidence_quote);
      if (!label) unlabeled++;
      else if (label.verdict === "keep") tp++;
      else fp++;
    }
  }

  const scored = tp + fp;
  return {
    messages: messages.length,
    gatePassed: passed.length,
    extracted,
    truePositive: tp,
    falsePositive: fp,
    unlabeled,
    unlabeledShare: extracted ? unlabeled / extracted : 0,
    precision: scored ? tp / scored : null,
    calls: messages.length + passed.length,
    superCallsAvoided: messages.length - passed.length,
  };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------------- main

const pct = (n: number | null) => (n === null ? "  n/a" : `${(n * 100).toFixed(1)}%`);

console.log(`\nExtraction precision — ${labelFile.labels.length} human labels`);
if (!labelFile.pass1_complete) {
  console.log(`Labeling pass 1 is incomplete. Precision below is over what is labeled so far.`);
}
console.log("");

const stat = staticPrecision();
console.log(`  committed dumps (no model calls):`);
for (const s of stat) {
  console.log(`    ${s.model.padEnd(6)} ${String(s.kept).padStart(3)}/${String(s.labeled).padEnd(3)} kept   precision ${pct(s.precision)}`);
}

if (!labelFile.pass2_complete) {
  console.log(
    `\n  Recall is not measured: labeling pass 2 has not run, so there is no record of\n` +
      `  commitments neither model found. Gate recall (G6) holds recall from below in the\n` +
      `  meantime - see loop/PROJECT.md.`,
  );
}

if (STATIC) {
  console.log("");
  process.exit(0);
}

const messages = await loadMessages();
const meta = JSON.parse(await readFile("data/corpus/meta.json", "utf8"));
const owner: string[] = [meta.owner.email];

console.log(`\n  live run — ${messages.length} messages, ${RUNS} run(s), current prompts\n`);

const runs: RunResult[] = [];
for (let i = 0; i < RUNS; i++) {
  const r = await oneRun(messages, owner);
  runs.push(r);
  console.log(
    `    run ${i + 1}: ${r.truePositive} kept / ${r.falsePositive} rejected / ${r.unlabeled} unlabeled` +
      `   precision ${pct(r.precision)}   gate passed ${r.gatePassed}/${r.messages}`,
  );
}

const precisions = runs.map((r) => r.precision).filter((p): p is number => p !== null);
const medianPrecision = precisions.length ? median(precisions) : null;
const medianUnlabeled = median(runs.map((r) => r.unlabeledShare));
const trustworthy = medianUnlabeled <= MAX_UNLABELED_SHARE;

const scorecard = {
  recorded_at: new Date().toISOString(),
  mode: USE_SMOKE ? "smoke" : "full",
  runs: RUNS,
  messages: messages.length,
  labels_used: labelFile.labels.length,
  S1_extraction_precision: medianPrecision,
  S1_spread: precisions.length > 1 ? { min: Math.min(...precisions), max: Math.max(...precisions) } : null,
  S2_extraction_recall: null,
  S3_f1: null,
  S4_calls_per_pass: median(runs.map((r) => r.calls)),
  S4_tokens_per_pass: null,
  S5_super_calls_avoided: median(runs.map((r) => r.superCallsAvoided / r.messages)),
  unlabeled_share: medianUnlabeled,
  comparable: trustworthy,
  per_run: runs,
};

await mkdir(OUT_DIR, { recursive: true });
const out = `${OUT_DIR}/${scorecard.recorded_at.replace(/[:.]/g, "-")}.json`;
await writeFile(out, JSON.stringify(scorecard, null, 2) + "\n");

console.log(`\n  S1 precision (median of ${RUNS})   ${pct(medianPrecision)}`);
if (scorecard.S1_spread) {
  console.log(`  spread across runs             ${pct(scorecard.S1_spread.min)} – ${pct(scorecard.S1_spread.max)}`);
}
console.log(`  S4 model calls per pass        ${scorecard.S4_calls_per_pass}`);
console.log(`  S5 Super calls avoided         ${pct(scorecard.S5_super_calls_avoided)}`);
console.log(`  unlabeled share                ${pct(medianUnlabeled)}`);

if (!trustworthy) {
  console.log(
    `\n  NOT COMPARABLE. ${pct(medianUnlabeled)} of extractions are outside the labeled set,\n` +
      `  over the ${pct(MAX_UNLABELED_SHARE)} threshold. The prompt is finding sentences nobody\n` +
      `  adjudicated, so this precision figure is measured on a shrinking slice. Extend the\n` +
      `  labels before treating this run as a result.`,
  );
}

console.log(`\n  written to ${out}\n`);
