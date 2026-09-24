/**
 * Commitment extraction — stage 1 of the ledger pipeline.
 *
 * The whole product rests on this being precise. A ledger that is 30% junk is
 * worse than no ledger, because its entire value proposition is that you can
 * trust it without re-reading the thread. So the bias here is heavily toward
 * precision over recall: a missed commitment is a gap, a fabricated one is a
 * reason to stop using the product.
 */

import { chat } from "./nebius";

export interface Message {
  id: string;
  thread_id: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date_iso: string;
  body_text: string;
}

export type Direction = "owed_by_me" | "owed_to_me";

export interface Commitment {
  direction: Direction;
  counterparty: string;
  what: string;
  /** The deadline as the message phrased it ("end of day Friday"). Empty when
   *  the promise carries no date — those are still real commitments, they just
   *  can never be overdue. */
  due_text: string;
  confidence: number;
  /** Must appear verbatim in the source message. Enforced in code below, not
   *  merely requested in the prompt. */
  evidence_quote: string;
}

export interface ExtractedCommitment extends Commitment {
  message_id: string;
  thread_id: string;
  stated_at: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["commitments"],
  properties: {
    commitments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["direction", "counterparty", "what", "due_text", "confidence", "evidence_quote"],
        properties: {
          direction: {
            type: "string",
            enum: ["owed_by_me", "owed_to_me"],
            description: "owed_by_me when the mailbox owner is the one who promised",
          },
          counterparty: {
            type: "string",
            description: "The other party's name or email as written in the message",
          },
          what: {
            type: "string",
            description: "The deliverable, in under 12 words, as a noun phrase",
          },
          due_text: {
            type: "string",
            description: "Deadline exactly as phrased, or empty string if none stated",
          },
          confidence: {
            type: "number",
            description: "0.0-1.0. Below 0.6 means you are unsure this is a firm commitment",
          },
          evidence_quote: {
            type: "string",
            description: "The exact sentence from the message, copied verbatim, that states this commitment",
          },
        },
      },
    },
  },
} as const;

const SYSTEM = `You extract firm commitments from business email for an obligation ledger.

A FIRM COMMITMENT requires ALL THREE of these. If any one is missing, extract nothing:
  1. A specific PERSON or NAMED GROUP is the one who will act.
  2. The action is still IN THE FUTURE and has not happened yet.
  3. The sentence states it will happen - not that it might, could, or should.

Extract these:
  "I'll send the vendor list by Friday"          -> yes
  "We'll have the contract over to you Monday"   -> yes
  "I'll look into it and get back to you"        -> yes: vague deliverable, but a real promise
  "The IT group will modify the billing cycle"   -> yes: named group, future, stated

Do NOT extract these. Each of these was wrongly extracted in testing:
  "Attached is the current version of the doc"   -> ALREADY DONE. Nothing is owed.
  "I've sent that over this morning"             -> ALREADY DONE.
  "Meeting scheduled for Thursday"               -> a calendar fact. Nobody owes anything.
  "Rick and Steve will be available for signing" -> availability, not a deliverable.
  "We can make Thursday if that's better"        -> CONDITIONAL offer.
  "Happy to loop in Priya if that's useful"      -> CONDITIONAL offer.
  "Let's maybe sync sometime next month"         -> vague intention, no deliverable.
  "Will catch you on the next round"             -> pleasantry.
  "I would like to give the tickets to Cynthia"  -> a WISH ("would like to"), not a promise.
  "Thanks, that sounds great"                    -> acknowledgement.
  "I will be out of the office Aug 6-17"         -> availability, not a deliverable.
  Anything inside quoted reply history           -> already logged from the original message.

REQUESTS ARE NOT COMMITMENTS. This is the most common mistake. An instruction
telling someone to do something creates no commitment until that person agrees:
  "Please review these documents by COB Friday"  -> NO. A request.
  "Ava, please set up a time on Wednesday"       -> NO. A request.
  "You should send that over when you can"       -> NO. A request.
  "Can you get me the numbers by Tuesday?"       -> NO. A request.
Only the REPLY agreeing to a request is a commitment ("Will do, sending Friday").
A commitment sentence names its actor in the first or second person ("I will",
"we'll") or names a specific group that will act ("the IT group will").

The "what" field is the DELIVERABLE, not the person. Write it as a verb phrase
describing what gets done, under 12 words:
  good: "send the vendor list"     "modify the scheduling cycle"
  bad:  "Gary Spraggins and I"     "The IT group"     "michael@enron.com"

Precision matters far more than recall. When a sentence could plausibly be read as
either a firm promise or a soft intention, omit it. A ledger full of things nobody
actually promised is worthless, and one missed promise costs far less than one
invented promise.

RULES FOR due_text - these are violated often, read them twice:
  - Copy the deadline WORDING FROM THE MESSAGE: "by Friday", "end of week", "mid July".
  - If the message states no deadline, due_text MUST be the empty string "".
  - NEVER put the message's own send date in due_text.
  - NEVER put an ISO timestamp, a date you inferred, or "N/A" in due_text.
  - NEVER put a condition ("if it is Thursday") or a restatement of the task in due_text.
  A commitment with no stated deadline is still a real commitment. It simply can
  never become overdue, and that is correct.

evidence_quote must be copied character-for-character from the message body. Do not
paraphrase, do not fix typos, do not merge two sentences. If you cannot quote it
exactly, do not extract it.`;

function userPrompt(msg: Message, ownerAddresses: string[]): string {
  const owner = ownerAddresses.join(", ");
  const senderIsOwner = ownerAddresses.some(
    (a) => a.toLowerCase() === msg.from.toLowerCase(),
  );
  return `The mailbox owner is: ${owner}
This message was sent by ${msg.from}${senderIsOwner ? " (the mailbox owner)" : " (someone else)"}.
${
  senderIsOwner
    ? "So promises made by the sender are owed_by_me."
    : "So promises made by the sender are owed_to_me, and promises the sender attributes to the mailbox owner are owed_by_me."
}

Date: ${msg.date_iso}
Subject: ${msg.subject}

${msg.body_text}`;
}

/**
 * Normalize for quote matching. Curly quotes, escaped quotes, and non-breaking
 * spaces otherwise sink real commitments: `I will get this "final" down` and
 * `I'll call you to set up a time.` were both being rejected as ungrounded
 * purely over punctuation, which loses true positives for no benefit.
 */
function flatten(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\\(["'])/g, "$1")
    .replace(/[ \s]+/g, " ")
    .toLowerCase()
    .trim();
}

/** Drop any commitment whose quote is not actually in the message. Models are
 *  good at this but not perfect, and an unverifiable receipt defeats the point
 *  of having receipts. Whitespace is normalized before comparing because line
 *  wrapping differs between the prompt and the stored body. */
function verifyQuotes(
  commitments: Commitment[],
  msg: Message,
): { kept: Commitment[]; rejected: Commitment[] } {
  const flat = flatten(msg.body_text);
  const kept: Commitment[] = [];
  const rejected: Commitment[] = [];
  for (const c of commitments) {
    const q = flatten(c.evidence_quote);
    // Models sometimes emit confidence on a 0-100 scale despite the schema
    // asking for 0-1, which would sail past every downstream threshold check.
    const confidence = c.confidence > 1 ? c.confidence / 100 : c.confidence;
    if (q.length >= 10 && flat.includes(q)) {
      kept.push({ ...c, confidence, due_text: cleanDue(c.due_text, msg) });
    }
    else rejected.push(c);
  }
  return { kept, rejected };
}

/**
 * Models routinely fill due_text with the message's own send timestamp, an
 * inferred ISO date, or the string "N/A" when no deadline was stated. In a
 * ledger that is the most damaging possible error: an undated promise silently
 * acquires a date and then goes overdue on its own, so the user is chased about
 * a deadline nobody ever agreed to.
 *
 * The prompt forbids all of this, but a prompt is a request. This enforces it:
 * a deadline survives only if its wording actually appears in the message.
 */
function cleanDue(due: string, msg: Message): string {
  const d = (due ?? "").trim();
  if (!d) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return ""; // ISO timestamp, always inferred
  if (/^(n\/?a|none|unspecified|not specified|tbd)$/i.test(d)) return "";
  if (/^(if|when|unless|by (providing|modifying|sending)\b)/i.test(d)) return ""; // a condition or a restated task

  // Keep it only if the message really says it.
  const flat = msg.body_text.replace(/\s+/g, " ").toLowerCase();
  return flat.includes(d.toLowerCase()) ? d : "";
}

/**
 * When the owner is the one promising, the model often leaves counterparty
 * blank - from inside the sentence "I'll have the process map over to you"
 * there is no name to copy. The mailbox knows who "you" is, so fill it from the
 * envelope rather than shipping a ledger row that says you owe nobody.
 */
function inferCounterparty(
  direction: Direction,
  msg: Message,
  ownerAddresses: string[],
): string {
  const owners = ownerAddresses.map((a) => a.toLowerCase());
  const senderIsOwner = owners.includes(msg.from.toLowerCase());

  if (direction === "owed_by_me") {
    // The owner promised: the counterparty is whoever they were writing to.
    const recipient = msg.to.find((a) => !owners.includes(a.toLowerCase()));
    return recipient ?? msg.to[0] ?? msg.from;
  }
  // Someone else promised: it is the sender, unless the owner sent the message
  // describing someone else's promise.
  if (senderIsOwner) {
    return msg.to.find((a) => !owners.includes(a.toLowerCase())) ?? msg.to[0] ?? "";
  }
  return msg.from;
}

export interface ExtractResult {
  commitments: ExtractedCommitment[];
  /** Quotes the model could not ground in the source. Surfaced rather than
   *  hidden so the eval can report a hallucination rate. */
  rejected: Commitment[];
  model: string;
  source: "live" | "cache";
}

export async function extractFromMessage(
  msg: Message,
  ownerAddresses: string[],
  opts: { noCache?: boolean } = {},
): Promise<ExtractResult> {
  const res = await chat<{ commitments: Commitment[] }>({
    role: "extract",
    // Nano is clamped to "low" internally; see safeEffort() in nebius.ts for why.
    reasoningEffort: "low",
    maxTokens: 4096,
    noCache: opts.noCache,
    schema: { name: "commitments", schema: SCHEMA as unknown as Record<string, unknown> },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt(msg, ownerAddresses) },
    ],
  });

  const { kept, rejected } = verifyQuotes(res.data.commitments ?? [], msg);

  return {
    commitments: kept.map((c) => ({
      ...c,
      counterparty: c.counterparty?.trim() || inferCounterparty(c.direction, msg, ownerAddresses),
      message_id: msg.id,
      thread_id: msg.thread_id,
      stated_at: msg.date_iso,
    })),
    rejected,
    model: res.model,
    source: res.source,
  };
}
