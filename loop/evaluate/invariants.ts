/**
 * The invariant assertions — gates G7 and G8 of the scorecard.
 *
 * These exist because an optimizer pointed at a score will find the cheapest way
 * to raise it, and the cheapest way is almost always to weaken a check. Deleting
 * the quote-grounding verification raises extraction precision immediately, and
 * every row in the ledger becomes a guess. So the things that must never move are
 * asserted here, in a file the optimizer cannot edit.
 *
 * Two kinds of assertion, and the behavioural kind is preferred wherever the
 * symbol is exported:
 *
 *   G7  the measured invariants are still in place
 *   G8  prompt text and the code that depends on it have not desynced
 *
 * G8 is the gate the surface inventory earned. Three places in lib/draft.ts have
 * prompt wording and a code-level check that must change together:
 *
 *   - the repair turn tells the model to write `I said` / `I wrote`, and
 *     attributionOk() rejects `you wrote` on a commitment the owner owes
 *   - MONTHS feeds formatDay(), and quotesEvidence() verifies the draft by
 *     matching a date regex against that output
 *   - quotesEvidence() uses a 6-word window, and markQuote() repairs using the
 *     same tolerance written out a second time
 *
 * An optimizer free to reword prompts can break any of these silently: the draft
 * still generates, the grounding check just stops recognising its own evidence.
 *
 * Run alone:  npx tsx loop/evaluate/invariants.mts
 */

import { readFile } from "node:fs/promises";
import {
  attributionOk,
  formatDay,
  hasQuotationMarks,
  quotesEvidence,
  type DraftQuote,
} from "../../lib/draft";
import { overdueAs, resolveDue } from "../../lib/due";

export interface InvariantResult {
  gate: "G7" | "G8";
  name: string;
  ok: boolean;
  detail: string;
}

const results: InvariantResult[] = [];

function assert(gate: "G7" | "G8", name: string, ok: boolean, detail = ""): void {
  results.push({ gate, name, ok, detail });
}

const read = (p: string) => readFile(p, "utf8");

// ---------------------------------------------------------------------------
// G7 - the measured invariants
// ---------------------------------------------------------------------------

async function g7(): Promise<void> {
  const [nebius, gate, extract, due, reconcile] = await Promise.all([
    read("lib/nebius.ts"),
    read("lib/gate.ts"),
    read("lib/extract.ts"),
    read("lib/due.ts"),
    read("lib/reconcile.ts"),
  ]);

  // Deadline resolution must stay a date parser. A model inventing a deadline is
  // unrecoverable: the row looks authoritative and the date is fiction.
  assert(
    "G7",
    "deadline resolution never calls a model",
    !/from\s+["'].*nebius["']/.test(due) && !/\bchat\s*\(/.test(due),
    "lib/due.ts must not import the Token Factory client",
  );
  assert(
    "G7",
    "resolveDue resolves a real phrase and refuses an unresolvable one",
    typeof resolveDue("by Wednesday", "2026-09-07T12:00:00.000Z") === "string" &&
      resolveDue("", "2026-09-07T12:00:00.000Z") === null &&
      resolveDue("when the audit wraps up", "2026-09-07T12:00:00.000Z") === null,
    "an unresolvable phrase must stay null rather than become a guessed date",
  );
  assert(
    "G7",
    "overdue counts calendar days, not elapsed milliseconds",
    overdueAs("2026-09-12T17:00:00.000Z", "2026-09-23T00:00:00.000Z").daysLate === 11,
    `got ${overdueAs("2026-09-12T17:00:00.000Z", "2026-09-23T00:00:00.000Z").daysLate}, expected 11`,
  );

  // Nano returns empty content at reasoning_effort "none" and runs away into a
  // whitespace loop at "high". Both arrive as HTTP 200.
  assert(
    "G7",
    "safeEffort still clamps Nano",
    /function safeEffort/.test(nebius) &&
      /\/nano\/i/.test(nebius) &&
      /return "low"/.test(nebius) &&
      /safeEffort\(model, opts\.reasoningEffort\)/.test(nebius),
    "lib/nebius.ts must clamp Nano's reasoning_effort and apply the clamp",
  );

  // A broken gate must never silently drop mail.
  assert(
    "G7",
    "the cascade gate still fails open",
    /has_commitment !== false/.test(gate) && /hasCommitment:\s*true/.test(gate),
    "lib/gate.ts must pass a message through when the gate errors or answers ambiguously",
  );

  // Direction is checkable from the headers, so it is checked rather than asked.
  assert(
    "G7",
    "direction still derives from the envelope",
    /function correctDirection/.test(extract) &&
      /FIRST_PERSON/.test(extract) &&
      /correctDirection\(c, msg, ownerAddresses\)/.test(extract),
    "lib/extract.ts must override the model's direction on first-person promises",
  );
  assert(
    "G7",
    "the owner can never be their own counterparty",
    /ownerNamed/.test(extract) && /inferCounterparty\(direction, msg, ownerAddresses\)/.test(extract),
    "lib/extract.ts must fall back to the envelope when the model names the owner",
  );

  // A commitment whose quote is not in the body is a guess with a citation.
  assert(
    "G7",
    "quote grounding still runs on every extraction",
    /function verifyQuotes/.test(extract) && /verifyQuotes\(res\.data\.commitments/.test(extract),
    "lib/extract.ts must verify every evidence quote against the message body",
  );
  assert(
    "G7",
    "ungrounded transitions are still dropped",
    /flatten\(msg\.body_text\)/.test(reconcile) && /rationale/.test(reconcile),
    "lib/reconcile.ts must drop a transition whose evidence is not in the message",
  );

  // The committed cache has to survive a model deprecation, so it is keyed by
  // pipeline role rather than by resolved model ID.
  const cacheKeyBody = nebius.slice(nebius.indexOf("function cacheKey"), nebius.indexOf("async function readCache"));
  assert(
    "G7",
    "cache keys are namespaced by role, not by model ID",
    /role:\s*opts\.role/.test(cacheKeyBody) && !/\bmodel\b/.test(cacheKeyBody),
    "lib/nebius.ts cacheKey() must not include the resolved model ID",
  );

  assert(
    "G7",
    "seed is pinned and structured output stays strict",
    /seed:\s*opts\.seed \?\? 7/.test(nebius) && /strict:\s*true/.test(nebius),
    "lib/nebius.ts must pin seed and request strict json_schema",
  );

  // Token Factory deprecates IDs with no rerouting; a hardcoded ID is a demo
  // that dies silently between submission and judging.
  const files = await Promise.all(
    ["lib/extract.ts", "lib/gate.ts", "lib/reconcile.ts", "lib/draft.ts", "lib/ledger.ts"].map(
      async (p) => [p, await read(p)] as const,
    ),
  );
  const offenders = files.filter(([, src]) => /["'](nvidia|Qwen)\//i.test(src)).map(([p]) => p);
  assert(
    "G7",
    "no model ID is hardcoded outside the chains in lib/nebius.ts",
    offenders.length === 0,
    offenders.join(", "),
  );
  assert(
    "G7",
    "chat() resolves its model through modelChain()",
    /const chain = modelChain\(opts\.role\)/.test(nebius),
    "lib/nebius.ts must resolve models through the env fallback chain",
  );
}

// ---------------------------------------------------------------------------
// G8 - prompt text and the code that verifies it have not desynced
// ---------------------------------------------------------------------------

async function g8(): Promise<void> {
  const draft = await read("lib/draft.ts");

  // Every month formatDay() can emit must be recognised by the date regex
  // quotesEvidence() uses. "Sept" rather than "Sep" is the one that bites.
  const quoteText = "I will get you those two by Thursday";
  const monthFailures: string[] = [];
  for (let m = 0; m < 12; m++) {
    const iso = `2026-${String(m + 1).padStart(2, "0")}-09T12:00:00.000Z`;
    const day = formatDay(iso);
    const quotes: DraftQuote[] = [{ speaker: "them (Marcus)", at: iso, text: quoteText, note: "" }];
    const body = `You said "${quoteText}" on ${day}, and I am still waiting.`;
    if (!quotesEvidence(body, quotes)) monthFailures.push(day);
  }
  assert(
    "G8",
    "every formatDay month is recognised by the quotesEvidence date regex",
    monthFailures.length === 0,
    monthFailures.length ? `unrecognised: ${monthFailures.join(", ")}` : "",
  );

  // The repair turn prescribes "I said" / "I wrote" on the owner's own promise.
  // attributionOk() is what enforces it. Assert both halves agree.
  const prescribed = `I said "I will get you those two by Thursday" on Sept 9, 2026.`;
  const forbidden = `On Sept 9, 2026 you wrote: "I will get you those two by Thursday."`;
  assert(
    "G8",
    "the wording the repair prompt prescribes is the wording attributionOk accepts",
    attributionOk(prescribed, "owed_by_me") && !attributionOk(forbidden, "owed_by_me"),
    "repairMessages() and attributionOk() must agree on how the owner's own words are introduced",
  );
  assert(
    "G8",
    "the repair prompt still carries the attribution instruction",
    /Those are MY OWN words/.test(draft) && /"I said" or "I wrote"/.test(draft),
    "lib/draft.ts repairMessages() must keep telling the model which side the quote belongs to",
  );
  assert(
    "G8",
    "attribution is only policed on the owner's own commitments",
    attributionOk(forbidden, "owed_to_me"),
    "quoting the counterparty with \"you wrote\" is correct and must not be rejected",
  );

  // A quote has to be marked as a quote, and a contraction is not a quote mark.
  assert(
    "G8",
    "hasQuotationMarks accepts both styles and ignores contractions",
    hasQuotationMarks(`He said "hello"`) &&
      hasQuotationMarks(`He said 'hello'`) &&
      !hasQuotationMarks(`I'll send it Friday`),
    "lib/draft.ts hasQuotationMarks() must not count an apostrophe inside a word",
  );

  // The receipt is the quote AND its date. Either alone is not a receipt.
  const quotes: DraftQuote[] = [
    { speaker: "them (Marcus)", at: "2026-09-09T12:00:00.000Z", text: quoteText, note: "" },
  ];
  assert(
    "G8",
    "quotesEvidence requires both the quote and its date",
    !quotesEvidence(`You said "${quoteText}" last week.`, quotes) &&
      !quotesEvidence(`Just following up on Sept 9, 2026.`, quotes),
    "a draft with a quote but no date, or a date but no quote, must not count as grounded",
  );

  // Measured floor: Super at medium effort spends 700-1400 tokens reasoning
  // before it writes. At maxTokens 1400 it returned finish_reason "length" with
  // empty content, which chat() reads as a dead model and falls through to Ultra.
  const draftBudgets = [...draft.matchAll(/maxTokens:\s*(\d+)/g)].map((m) => Number(m[1]));
  assert(
    "G8",
    "the draft token budget stays at or above its measured floor of 3000",
    draftBudgets.length > 0 && draftBudgets.every((n) => n >= 3000),
    draftBudgets.length ? `found ${draftBudgets.join(", ")}` : "no maxTokens found in lib/draft.ts",
  );

  // quotesEvidence verifies with a 6-word window; markQuote repairs using the
  // same tolerance, written out a second time. They must not drift apart.
  const window = draft.match(/const WINDOW = (\d+)/)?.[1];
  const repairWindow = draft.match(/n >= (\d+) && \(!best/)?.[1];
  assert(
    "G8",
    "the verify window and the repair window are the same number",
    !!window && window === repairWindow,
    `quotesEvidence WINDOW=${window ?? "?"}, markQuote n>=${repairWindow ?? "?"}`,
  );
}

// ---------------------------------------------------------------------------

export async function runInvariants(): Promise<InvariantResult[]> {
  results.length = 0;
  await g7();
  await g8();
  return results;
}

// Runnable alone as well as through loop:check. No top-level await: this module
// is imported by a .mts file and has to stay loadable in either module format.
async function main(): Promise<void> {
  const all = await runInvariants();
  for (const r of all) {
    console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.gate}  ${r.name}`);
    if (!r.ok && r.detail) console.log(`        ${r.detail}`);
  }
  const failed = all.filter((r) => !r.ok);
  console.log(`\n${all.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}

if (process.argv[1]?.endsWith("invariants.ts")) void main();
