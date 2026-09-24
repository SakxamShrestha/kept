/**
 * Day 1 falsifier: does commitment extraction work on REAL email?
 *
 * Run against the Enron corpus rather than our own fixtures. LLM-written test
 * mail is easy for an LLM to parse, so precision measured on it would be
 * flattering and meaningless. Real business mail is full of conditional offers,
 * rhetorical near-promises, and renegotiations - the exact failure surface.
 *
 * This script does not score anything. It produces candidate extractions for a
 * human pass, because the ground truth has to come from a person. Scoring lives
 * in score-extract.ts once labels exist.
 *
 * Usage:
 *   npx tsx evals/run-extract.ts --limit 40
 *   npx tsx evals/run-extract.ts --limit 40 --model-role reconcile   # Super instead of Nano
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { extractFromMessage, type Message } from "../lib/extract";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const LIMIT = Number(flag("limit", "40"));
const CORPUS = flag("corpus", "evals/enron/messages.json");
const OUT = flag("out", "evals/candidates.json");
const CONCURRENCY = Number(flag("concurrency", "4"));

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const messages: Message[] = JSON.parse(await readFile(CORPUS, "utf8"));

// Enron messages come from many different people's folders, so there is no one
// mailbox owner. Frame each message from its first recipient's point of view:
// the sender's promises are owed_to_me, and promises the sender attributes back
// to the recipient are owed_by_me. Both directions get exercised.
const usable = messages.filter((m) => m.to.length > 0 && m.body_text.length > 80).slice(0, LIMIT);

console.log(`Extracting from ${usable.length} real Enron messages...\n`);

let failures = 0;
let hallucinated = 0;
const started = Date.now();

const results = await mapLimit(usable, CONCURRENCY, async (msg, i) => {
  try {
    // Always bypass the cache here. Cache keys are namespaced by pipeline role,
    // not by model ID - correct for production, fatal for an A/B eval, since a
    // Super run would silently be served Nano's cached answers.
    const r = await extractFromMessage(msg, [msg.to[0]], { noCache: true });
    hallucinated += r.rejected.length;
    process.stdout.write(
      `  [${String(i + 1).padStart(3)}/${usable.length}] ${r.commitments.length} found` +
        `${r.rejected.length ? `, ${r.rejected.length} ungrounded` : ""}\n`,
    );
    return { message: msg, commitments: r.commitments, rejected: r.rejected, model: r.model, error: null };
  } catch (err) {
    failures++;
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`  [${String(i + 1).padStart(3)}/${usable.length}] ERROR ${message.slice(0, 80)}\n`);
    return { message: msg, commitments: [], rejected: [], model: "", error: message };
  }
});

const total = results.reduce((n, r) => n + r.commitments.length, 0);
const withAny = results.filter((r) => r.commitments.length > 0).length;
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(results, null, 2));

console.log(`
--- ${elapsed}s, model: ${results.find((r) => r.model)?.model ?? "?"}
messages processed     ${usable.length}
messages with >=1      ${withAny}  (${((withAny / usable.length) * 100).toFixed(0)}%)
commitments extracted  ${total}
ungrounded quotes      ${hallucinated}   <- dropped; quote was not verbatim in the source
call failures          ${failures}

Wrote ${OUT}. Review with:
  npx tsx evals/review.ts
`);
