/**
 * The labeling tool — where the ground truth comes from.
 *
 * Every accuracy number this project reports traces back to the file this writes.
 * That is why no model may write it: a model labeling its own test set makes the
 * score circular, and the circularity is invisible once it is in the file. So this
 * is a human sitting down with real email for forty-five minutes, and the harness
 * is built around protecting that work.
 *
 * Pass 1 (this, by default) scores PRECISION. It walks the union of what Nano and
 * Super already extracted from the 150 Enron messages and asks, for each one: is
 * this actually a commitment someone made? Keep or reject. That alone replaces the
 * eyeballed "Super ~95%, Nano ~60%" with a measured figure for both.
 *
 * Pass 2 (`--pass 2`) scores RECALL. It walks all 150 messages and asks whether
 * there is a commitment neither model found. Slower, and not needed to stand the
 * loop up.
 *
 * Resumable. Every decision is written immediately, so stopping is free - run it
 * again and it picks up where it left off.
 *
 *   npx tsx evals/label.mts              # pass 1, precision
 *   npx tsx evals/label.mts --pass 2     # pass 2, recall
 *   npx tsx evals/label.mts --stats      # progress, no prompting
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import type { Message } from "../lib/extract";

const OUT = "evals/labeled/extract-150.json";
const SOURCES = [
  { model: "nano", file: "evals/candidates-nano-150.json" },
  { model: "super", file: "evals/candidates-super-150.json" },
] as const;

const args = process.argv.slice(2);
const PASS = args.includes("--pass") ? Number(args[args.indexOf("--pass") + 1]) : 1;
const STATS_ONLY = args.includes("--stats");

// --------------------------------------------------------------- the criteria

/**
 * Written down because label drift across sessions is the quiet way a ground
 * truth set stops being one. If a judgement call is not covered here, make the
 * call, then add the rule - the file is the spec, not a memory.
 */
const CRITERIA = `
KEEP a candidate when all of these hold:

  1. Someone commits to a future action. "I'll send it Friday", "we'll take a
     look", "I can get you that next week". A weak or hedged promise still counts.
  2. The evidence quote is really in the message and really supports it.
  3. The direction is right: the person who said "I will" is the one who owes it.
  4. The counterparty is the other side, never the person who made the promise.
  5. If due_text is filled in, the message actually said that. An invented
     deadline is a reject even when the commitment is real.

REJECT when it is:

  - a REQUEST, not a promise. "Can you send the deck?" is someone else's
    commitment at best, and usually nobody's.
  - CONDITIONAL on something that has not happened. "If the board approves, I'll
     circulate it" is not yet owed.
  - a pleasantry. "Happy to help", "let me know", "looking forward to it".
  - a statement about the past, or about what someone else will do with no
     commitment from them.
  - real, but with the direction or the counterparty backwards. Reject it: the row
     as extracted is wrong, and precision is measuring the row, not the intent.

When genuinely torn, SKIP. A coin-flip label is worse than a gap - the gap is
visible in the count and a bad label is not.
`.trim();

// ------------------------------------------------------------------ the data

interface Candidate {
  message: Message;
  commitments: {
    direction: string;
    counterparty: string;
    what: string;
    due_text: string;
    confidence: number;
    evidence_quote: string;
    message_id: string;
  }[];
}

interface Label {
  key: string;
  message_id: string;
  evidence_quote: string;
  what: string;
  direction: string;
  counterparty: string;
  due_text: string;
  found_by: string[];
  verdict: "keep" | "reject";
  labeled_at: string;
}

interface LabelFile {
  version: 1;
  note: string;
  criteria: string;
  pass1_complete: boolean;
  pass2_complete: boolean;
  labels: Label[];
  /** Pass 2 only: commitments a human found that no model extracted. */
  misses: { message_id: string; evidence_quote: string; what: string; direction: string }[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const keyOf = (messageId: string, quote: string) => `${messageId}::${norm(quote).slice(0, 80)}`;

async function loadLabels(): Promise<LabelFile> {
  try {
    return JSON.parse(await readFile(OUT, "utf8")) as LabelFile;
  } catch {
    return {
      version: 1,
      note:
        "Human-labeled ground truth for commitment extraction, over the 150-message " +
        "Enron sample. Written by evals/label.mts. No model may write or edit this file - " +
        "see loop/PROJECT.md. Every accuracy number in the README traces back here.",
      criteria: CRITERIA,
      pass1_complete: false,
      pass2_complete: false,
      labels: [],
      misses: [],
    };
  }
}

async function save(file: LabelFile): Promise<void> {
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(file, null, 2) + "\n");
}

// ------------------------------------------------------------------ the union

interface Item {
  key: string;
  message: Message;
  c: Candidate["commitments"][number];
  foundBy: string[];
}

async function buildUnion(): Promise<Item[]> {
  const byKey = new Map<string, Item>();
  for (const { model, file } of SOURCES) {
    const rows: Candidate[] = JSON.parse(await readFile(file, "utf8"));
    for (const row of rows) {
      for (const c of row.commitments ?? []) {
        const key = keyOf(row.message.id, c.evidence_quote);
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.foundBy.includes(model)) existing.foundBy.push(model);
        } else {
          byKey.set(key, { key, message: row.message, c, foundBy: [model] });
        }
      }
    }
  }
  // Group a message's candidates together so the body is read once, not twice.
  return [...byKey.values()].sort((a, b) =>
    a.message.id === b.message.id ? a.key.localeCompare(b.key) : a.message.id.localeCompare(b.message.id),
  );
}

// ----------------------------------------------------------------- rendering

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const OFF = "\x1b[0m";
const UNDER = "\x1b[4m";

/** The quote in context, because the surrounding sentences are what decide a
 *  conditional from a commitment. */
function context(body: string, quote: string, radius = 420): string {
  const i = body.toLowerCase().indexOf(quote.slice(0, 40).toLowerCase());
  if (i < 0) return body.slice(0, radius * 2);
  const from = Math.max(0, i - radius);
  const to = Math.min(body.length, i + quote.length + radius);
  const before = body.slice(from, i);
  const hit = body.slice(i, i + quote.length);
  const after = body.slice(i + quote.length, to);
  return `${from > 0 ? "…" : ""}${before}${UNDER}${hit}${OFF}${after}${to < body.length ? "…" : ""}`;
}

function render(item: Item, n: number, total: number, full: boolean): void {
  const m = item.message;
  const c = item.c;
  console.clear();
  console.log(`${BOLD}[${n}/${total}]${OFF}  found by ${item.foundBy.join(" + ")}\n`);
  console.log(`${DIM}From:${OFF}    ${m.from}`);
  console.log(`${DIM}To:${OFF}      ${(m.to ?? []).join(", ").slice(0, 90)}`);
  console.log(`${DIM}Subject:${OFF} ${m.subject}`);
  console.log(`${DIM}Date:${OFF}    ${m.date_iso}\n`);
  console.log(full ? m.body_text : context(m.body_text, c.evidence_quote));
  console.log(`\n${BOLD}Extracted as:${OFF}`);
  console.log(`  what          ${c.what}`);
  console.log(`  direction     ${c.direction}`);
  console.log(`  counterparty  ${c.counterparty}`);
  console.log(`  due_text      ${c.due_text || `${DIM}(none)${OFF}`}`);
  console.log(`  confidence    ${c.confidence}`);
  console.log(`  quote         "${c.evidence_quote}"`);
  console.log(
    `\n${BOLD}k${OFF} keep   ${BOLD}r${OFF} reject   ${BOLD}s${OFF} skip   ` +
      `${BOLD}f${OFF} full body   ${BOLD}c${OFF} criteria   ${BOLD}q${OFF} save and quit`,
  );
}

// ---------------------------------------------------------------- key reading

function readKey(): Promise<string> {
  const stdin = process.stdin;
  if (stdin.isTTY) {
    return new Promise((resolve) => {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.once("data", (buf) => {
        stdin.setRawMode(false);
        stdin.pause();
        const ch = buf.toString();
        resolve(ch === "" ? "q" : ch.trim().toLowerCase().slice(0, 1));
      });
    });
  }
  const rl = createInterface({ input: stdin });
  return new Promise((resolve) => {
    rl.once("line", (line) => {
      rl.close();
      resolve(line.trim().toLowerCase().slice(0, 1));
    });
  });
}

// --------------------------------------------------------------------- stats

function stats(file: LabelFile, total: number): void {
  const kept = file.labels.filter((l) => l.verdict === "keep");
  const rejected = file.labels.filter((l) => l.verdict === "reject");
  const byModel = (model: string) => {
    const seen = file.labels.filter((l) => l.found_by.includes(model));
    const k = seen.filter((l) => l.verdict === "keep").length;
    return { n: seen.length, kept: k, precision: seen.length ? k / seen.length : 0 };
  };
  console.log(`\nLabeled ${file.labels.length} of ${total} candidates`);
  console.log(`  kept     ${kept.length}`);
  console.log(`  rejected ${rejected.length}\n`);
  for (const model of ["nano", "super"]) {
    const s = byModel(model);
    console.log(
      `  ${model.padEnd(6)} ${s.kept}/${s.n} kept` +
        (s.n ? `  →  precision ${(s.precision * 100).toFixed(1)}%` : ""),
    );
  }
  if (file.labels.length < total) {
    console.log(`\n${total - file.labels.length} left. Run again to continue.`);
  } else {
    console.log(`\nPass 1 complete. Precision above is measured, not assumed.`);
    console.log(`Next: npx tsx loop/evaluate/score-extract.mts`);
  }
}

// ---------------------------------------------------------------------- main

async function main(): Promise<void> {
  if (PASS !== 1) {
    console.error(
      "Pass 2 (recall) is not implemented yet. It walks all 150 messages looking for\n" +
        "commitments neither model found, and is only worth doing once pass 1 is complete.",
    );
    process.exit(1);
  }

  const file = await loadLabels();
  const union = await buildUnion();

  if (STATS_ONLY) {
    stats(file, union.length);
    return;
  }

  const done = new Set(file.labels.map((l) => l.key));
  const todo = union.filter((i) => !done.has(i.key));

  if (todo.length === 0) {
    console.log("Every candidate is labeled.");
    if (!file.pass1_complete) {
      file.pass1_complete = true;
      await save(file);
    }
    stats(file, union.length);
    return;
  }

  console.clear();
  console.log(`${BOLD}Labeling pass 1 — precision${OFF}\n`);
  console.log(`${union.length} candidates from Nano and Super over 150 Enron messages.`);
  console.log(`${done.size} already labeled, ${todo.length} to go.\n`);
  console.log(CRITERIA);
  console.log(`\n${DIM}Press any key to start.${OFF}`);
  await readKey();

  let showFull = false;
  for (let i = 0; i < todo.length; i++) {
    const item = todo[i];
    let decided = false;
    while (!decided) {
      render(item, done.size + i + 1, union.length, showFull);
      const k = await readKey();
      if (k === "f") {
        showFull = !showFull;
        continue;
      }
      if (k === "c") {
        console.clear();
        console.log(CRITERIA);
        console.log(`\n${DIM}Press any key to go back.${OFF}`);
        await readKey();
        continue;
      }
      if (k === "q") {
        await save(file);
        console.log(`\nSaved ${file.labels.length} labels to ${OUT}.`);
        stats(file, union.length);
        return;
      }
      if (k === "s") {
        decided = true;
        continue;
      }
      if (k === "k" || k === "r") {
        file.labels.push({
          key: item.key,
          message_id: item.message.id,
          evidence_quote: item.c.evidence_quote,
          what: item.c.what,
          direction: item.c.direction,
          counterparty: item.c.counterparty,
          due_text: item.c.due_text,
          found_by: item.foundBy,
          verdict: k === "k" ? "keep" : "reject",
          labeled_at: new Date().toISOString(),
        });
        // Written every decision, so stopping is always free.
        await save(file);
        decided = true;
      }
    }
    showFull = false;
  }

  if (file.labels.length >= union.length) file.pass1_complete = true;
  await save(file);
  console.clear();
  stats(file, union.length);
}

void main();
