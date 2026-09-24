/**
 * Measure the cascade gate, per SPEC.md section 2.
 *
 * The gate exists to stop paying for a Super extraction on the ~89% of messages
 * that contain no commitment. It is only worth keeping if it almost never drops
 * a message that had one: a false positive costs one call, a false negative
 * loses a commitment permanently and silently.
 *
 * Decision rule from the spec: recall >= 98% keep, < 95% drop the gate entirely
 * and send everything to Super. Between the two, judgement call.
 *
 * Ground truth is Super's own extractions over the same Enron messages, which
 * Day 1 measured at ~95% precision. That makes this a measure of gate-vs-Super
 * agreement rather than gate-vs-human, which is the right question: the gate's
 * only job is to not hide anything from Super.
 *
 * Usage: npx tsx evals/gate-recall.mts
 */

import { readFile } from "node:fs/promises";
import { shouldExtract } from "../lib/gate";
import type { Message } from "../lib/extract";

const CANDIDATES = process.argv[2] ?? "evals/candidates-final.json";

interface Candidate {
  message: Message;
  commitments: unknown[];
}

const results: Candidate[] = JSON.parse(await readFile(CANDIDATES, "utf8"));

const positives = results.filter((r) => r.commitments.length > 0);
const negatives = results.filter((r) => r.commitments.length === 0);

console.log(
  `Gate eval over ${results.length} Enron messages ` +
    `(${positives.length} with a commitment, ${negatives.length} without)\n`,
);

async function runAll(items: Candidate[], label: string) {
  let yes = 0;
  const missed: string[] = [];
  const CONCURRENCY = 6;
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        const { hasCommitment } = await shouldExtract(items[i].message, { noCache: true });
        if (hasCommitment) yes++;
        else missed.push(items[i].message.subject.slice(0, 60));
      }
    }),
  );

  console.log(`${label}: gate said yes to ${yes}/${items.length}`);
  return { yes, missed };
}

const pos = await runAll(positives, "messages WITH a commitment");
const neg = await runAll(negatives, "messages WITHOUT one");

const recall = pos.yes / positives.length;
const falsePositiveRate = neg.yes / negatives.length;
// Every message the gate rejects is a Super call not made.
const saved = 1 - (pos.yes + neg.yes) / results.length;

console.log(`
recall (must not hide commitments)  ${(recall * 100).toFixed(1)}%
false positive rate (wasted calls)  ${(falsePositiveRate * 100).toFixed(1)}%
Super calls avoided                 ${(saved * 100).toFixed(1)}%
`);

if (pos.missed.length) {
  console.log("Commitments the gate would have dropped:");
  pos.missed.forEach((s) => console.log(`  - ${s}`));
}

console.log(
  recall >= 0.98
    ? "\nVERDICT: keep the gate."
    : recall >= 0.95
      ? "\nVERDICT: borderline. Keep only if the call saving is large."
      : "\nVERDICT: DROP the gate. Send everything to Super - losing rows is not worth the saving.",
);
