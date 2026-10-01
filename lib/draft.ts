/**
 * Chase drafts — the one place the ledger turns into an action.
 *
 * The premise of the whole product is that a ledger row carries a receipt. A
 * draft that does not USE that receipt is a generic nudge, and generic nudges
 * are free everywhere. So the single non-negotiable property of this stage is
 * that the email quotes what the person actually wrote, with the date they
 * wrote it:
 *
 *   "On Sept 9 you said you'd get me the full vendor list by end of day Friday."
 *
 * That sentence is the product. Everything else here — tone, playbook,
 * reliability stats, Tavily enrichment — is decoration on top of it, so the
 * quote is asked for in the prompt AND verified in code afterwards, the same
 * way extraction grounds its evidence rather than trusting the model to.
 *
 * Nothing in this file sends anything. There is no send path in this project.
 */

import { chat, type ChatMessage } from "./nebius";
import {
  decorate,
  loadEnrichment,
  loadLedger,
  loadMessages,
  loadMeta,
  reliability,
  STATE_LABEL,
  type CorpusMeta,
  type DisplayRow,
  type Reliability,
} from "./ledger";
import type { Message } from "./extract";

export interface DraftPlaybook {
  id: string;
  name: string;
  tone: string;
  instruction: string;
}

/** One line of evidence handed to the model, already dated and attributed. */
export interface DraftQuote {
  speaker: string;
  /** ISO timestamp of the message the words came from. */
  at: string;
  /** Verbatim. Never paraphrased on the way in, never paraphrased on the way out. */
  text: string;
  note: string;
}

export interface DraftInput {
  row: DisplayRow;
  owner: CorpusMeta["owner"];
  /** The frozen demo date. Overdue language is written against this, never the
   *  wall clock — see lib/ledger.ts for why. */
  today: string;
  playbook: DraftPlaybook;
  /** Subject of the thread the promise was made in. The draft is a reply inside
   *  it, so the subject line should look like one. */
  threadSubject: string;
  quotes: DraftQuote[];
  counterpartyOrg: string;
  reliability: Reliability | null;
  enrichment: { summary: string; sources: string[] } | null;
}

export interface DraftResult {
  subject: string;
  body: string;
  model: string;
  source: "live" | "cache";
  tokens: number;
  /** False when the body does not actually contain the promise, its date, or
   *  attributes it to the wrong side. Reported rather than hidden: the UI can
   *  say so instead of presenting an ungrounded draft as if it were a receipt. */
  quoted: boolean;
  rowId: string;
  playbook: string;
  /** Where the enrichment line came from, when one was used. */
  sources: string[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: {
      type: "string",
      minLength: 6,
      description:
        "Subject line for a reply inside the existing thread. Usually 'Re: ' plus the original thread subject. Never empty, never marketing language.",
    },
    body: {
      type: "string",
      minLength: 80,
      description:
        "Plain text email body containing a verbatim quote of what was promised and the date it was said. Greeting, 2-3 short paragraphs, sign-off with first name only.",
    },
  },
} as const;

const SYSTEM = `You draft one short follow-up email about one outstanding commitment,
written in the first person as the mailbox owner. Output only JSON matching the schema.

THE RULE THAT MATTERS MORE THAN EVERYTHING ELSE

The email must contain, word for word and inside quotation marks, what was
actually written, and it must name the date those words were written. Copy the
wording out of the QUOTES block. Do not paraphrase it, do not summarise it, do
not tidy up the grammar, do not invent a sentence nobody sent.

Write it the way a person does:
  On Sept 9 you said you'd "get me the full vendor list by end of day Friday".
  Back on Aug 12 you said you'd "put together the integration spec" and get it to me "next week".

There are exactly two correct ways to set a quote, and one common way to break it.

  CORRECT, introduced with a colon, pronouns left as they were written:
    On Sept 9 you wrote: "I'll get you the full vendor list by end of day Friday."

  CORRECT, folded into your own sentence with the pronouns flipped:
    On Sept 9 you said you'd "get me the full vendor list by end of day Friday".

  WRONG, and the most common mistake — the two forms jammed together:
    On Sept 9 you said you'd "I'll get you the full vendor list by end of day Friday".

Pick one form and make the sentence read correctly. Flipping a pronoun is the
only change permitted inside the quotation marks. Quoting a fragment is fine.
The quoted words always sit inside straight double quotes, escaped as \" in the
JSON string. Words presented as a quote without quotation marks around them are
indistinguishable from your own paraphrase, which is the failure this whole
email exists to avoid.
The "[date — name]" label in front of each quote is metadata for you: it is
never part of the quote and must never appear in the email.

A follow-up with no dated verbatim quote is worthless — it is indistinguishable
from a form reminder, and the entire reason this email is worth sending is that
it carries the receipt. If you are about to write a summary of what they meant,
stop and paste their actual words instead.

DIRECTION

them_to_me — you are chasing. Quote THEIR words back to them, say how late it
  is in plain terms, and ask for one specific thing: either the deliverable or a
  firm date. One ask, not three.

me_to_them — YOU are the late one. This is an apology, not a chase. The quote
  you must use is your own, so introduce it as "I said" or "I wrote", never as
  "you said" or "you wrote" — putting your own promise in their mouth accuses
  them of something they never did. Say plainly that you missed it, commit to
  ONE specific new date, and ask for nothing else in return. Never chase
  somebody over a thing you owe them, and do not blame a third party.

FACTS

Use only the facts given below. Do not invent attachments, meetings, names,
numbers, prior emails, or reasons for the delay. If part of the commitment was
already delivered, acknowledge that part by name and ask only for the remainder.
If the deadline has not passed yet, do not call it late.

FORM

- 60 to 130 words in the body. Plain text only: no markdown, no bullet
  characters, no headings, no emoji, no placeholder brackets.
- Separate paragraphs with real newline characters. Never emit HTML — no <br>,
  no tags, no character entities like &quot;. Use ordinary " and '.
- The subject line is a reply inside the existing thread: "Re: " plus that
  thread's subject, unless a plainer one is obviously better. Never leave it empty.
- Greeting on its own line, then the body, then a sign-off with the sender's
  first name alone. No title, no company block, no phone number.
- Never mention this tool, the ledger, a playbook, a reliability score, or that
  anything was generated. The recipient must read a human email.`;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sept", "Oct", "Nov", "Dec",
];

/** "2026-09-09T14:12:00.000Z" -> "Sept 9, 2026". Written out for the model so
 *  it never has to do date arithmetic, which is where models invent things. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

/**
 * Super writes email bodies as if they were going into an HTML template: `<br>`
 * for paragraph breaks and `&quot;` around the quoted promise. Asking it not to
 * helps but does not eliminate it, and a composer showing `&quot;I'll get you`
 * destroys the credibility of the receipt it is trying to present. Same policy
 * as cleanDue() in extract.ts: ask in the prompt, enforce in code.
 *
 * Also strips the "[Sept 9, 2026 — Marcus Reed]" metadata label if the model
 * copies it into the quote along with the words.
 */
function cleanBody(body: string, signer = ""): string {
  const stripped = decodeEntities(
    body
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\/\s*p\s*>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\[[^\]]*—[^\]]*\]\s*/g, "")
    .replace(/([.!?])(?=[A-Z])/g, "$1 ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return reflow(stripped, signer);
}

const ENTITIES: Record<string, string> = {
  quot: '"', apos: "'", lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"',
  amp: "&", lt: "<", gt: ">", nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
};

/** Super emits `&rsquo;` and `&quot;` inside email bodies even when told not to.
 *  A composer showing `I haven&rsquo;t seen the spec` reads as broken software,
 *  which is a bad look for the one screen whose job is to look trustworthy. */
function decodeEntities(s: string): string {
  return s
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)));
}

const GREETING = /^((?:hi|hello|hey|dear)\b[^,\n]{0,40},|[A-Z][a-zA-Z'’-]{1,30},)[ \t]*(?=\S)/i;
const CLOSINGS = "thanks|thank you|many thanks|best regards|best|kind regards|regards|cheers|sincerely";

/**
 * Put the paragraph breaks back.
 *
 * Told not to emit `<br>`, Super stops emitting paragraph breaks rather than
 * switching to "\n": bodies come back as one run-on block reading
 * "Hi Marcus,On Sept 9 you wrote...remaining two vendors.Thanks,Sam". The words
 * are right and only the layout is wrong, so it gets a layout fix rather than
 * another round-trip to the model.
 *
 * Both repairs are conditional on the break being absent, so a body the model
 * formatted correctly passes through untouched.
 */
function reflow(body: string, signer: string): string {
  if (!body) return body;

  // Runs of spaces are Super's other paragraph marker, but it also double-spaces
  // around a quotation, so they cannot be trusted as break points. Collapse them
  // and rebuild the breaks from the two positions that are actually knowable.
  let out = body.includes("\n") ? body : body.replace(/ {2,}/g, " ");

  out = out.replace(GREETING, "$1\n\n");

  const name = signer ? escapeRe(signer) : "[A-Z][a-z]+";
  const closing = new RegExp(`([^\\n])[ \t]*\\b((?:${CLOSINGS})[,.!]?)[ \t\\n]*(${name})\\s*$`, "i");
  if (closing.test(out)) return out.replace(closing, "$1\n\n$2\n$3").trim();

  if (signer) {
    const bare = new RegExp(`([^\\n])[ \t]+(${name})\\s*$`);
    out = out.replace(bare, "$1\n\n$2");
  }
  return out.trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Did the draft actually use the receipt?
 *
 * Checked with a sliding window rather than an exact full-quote match: a real
 * email reasonably writes `you said you would "get me the full vendor list by
 * end of day Friday"` where the ledger stored "I'll get you the full vendor
 * list by end of day Friday". Pronouns flip, the rest must not.
 */
export function quotesEvidence(body: string, quotes: DraftQuote[]): boolean {
  const hay = normalize(body);
  if (!hay) return false;

  const hasDate =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? ?\d{1,2}\b/i.test(body) ||
    /\b\d{1,2}(st|nd|rd|th)\b/i.test(body);

  const WINDOW = 6;
  const hasQuote = quotes.some((q) => {
    const words = normalize(q.text).split(" ").filter(Boolean);
    if (words.length < WINDOW) return words.length > 0 && hay.includes(words.join(" "));
    for (let i = 0; i + WINDOW <= words.length; i++) {
      if (hay.includes(words.slice(i, i + WINDOW).join(" "))) return true;
    }
    return false;
  });

  return hasQuote && hasDate;
}

/**
 * On a commitment the owner owes, the draft must not attribute the owner's own
 * words to the recipient. Cheap to check, and the failure is not cosmetic: an
 * apology reading "On Sept 2 you wrote: I'll have the process map over to you"
 * tells the recipient they promised something they never promised.
 */
export function attributionOk(body: string, direction: DisplayRow["direction"]): boolean {
  if (direction !== "owed_by_me") return true;
  return !/\byou\s+(wrote|said|promised|agreed|committed|told)\b/i.test(body);
}

/**
 * Did the model actually mark the quote as a quote?
 *
 * Accepts either style, because Super picks between " and ' run to run and both
 * read fine. Contraction apostrophes are excluded by requiring an opening
 * position: "I'll" must not count as quoting anything.
 */
export function hasQuotationMarks(body: string): boolean {
  return /["“”]/.test(body) || /(^|[\s:(])['‘]/.test(body);
}

/**
 * Put quotation marks around the receipt when the model did not.
 *
 * Super marks the quote with " or ' on the blunter playbooks and leaves it
 * unmarked on the gentler ones, where the verbatim words are there but read as
 * the sender's own paraphrase. A re-ask fixes it only sometimes and costs a
 * whole second call, and the span is findable exactly: locate the longest run
 * of the evidence that survives in the body and wrap that.
 *
 * Word-aligned rather than string-matched, so a flipped pronoun or a dropped
 * final clause does not defeat it.
 */
function markQuote(body: string, quotes: DraftQuote[]): string {
  if (!body || hasQuotationMarks(body)) return body;

  const tokens = [...body.matchAll(/[A-Za-z0-9'’]+/g)].map((m) => ({
    word: normalize(m[0]),
    start: m.index,
    end: m.index + m[0].length,
  }));
  if (tokens.length === 0) return body;

  let best: { from: number; to: number; len: number } | null = null;
  for (const q of quotes) {
    const words = normalize(q.text).split(" ").filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      for (let j = 0; j < words.length; j++) {
        let n = 0;
        while (i + n < tokens.length && j + n < words.length && tokens[i + n].word === words[j + n]) n++;
        if (n >= 6 && (!best || n > best.len)) best = { from: i, to: i + n - 1, len: n };
      }
    }
  }
  if (!best) return body;

  const from = tokens[best.from].start;
  const to = tokens[best.to].end;
  return `${body.slice(0, from)}"${body.slice(from, to)}"${body.slice(to)}`;
}

function reliabilityLine(r: Reliability | null): string {
  if (!r || r.promised === 0) return "No prior history with this person in the ledger.";
  const parts = [
    `${r.promised} commitment${r.promised === 1 ? "" : "s"} tracked`,
    `${r.kept} delivered`,
    `${r.slipped} ran past the stated date`,
  ];
  if (r.avgDaysLate > 0) parts.push(`average ${r.avgDaysLate} days late`);
  return `${r.name}: ${parts.join(", ")}.`;
}

function dueLine(row: DisplayRow, today: string): string {
  if (!row.due_text) return "No deadline was ever stated, so this cannot be called late.";
  const stated = `stated as "${row.due_text}"`;
  const resolved = row.due_iso ? ` (${formatDay(row.due_iso)})` : "";
  if (row.overdue) {
    return `${stated}${resolved} — that is ${row.daysLate} day${row.daysLate === 1 ? "" : "s"} ago as of ${formatDay(today)}.`;
  }
  return `${stated}${resolved} — not yet past as of ${formatDay(today)}.`;
}

export function buildUserPrompt(input: DraftInput): string {
  const { row, owner, playbook } = input;
  const mine = row.direction === "owed_by_me";

  const blocks: string[] = [];

  blocks.push(
    [
      "COMMITMENT",
      `  who owes it: ${mine ? "me" : "them"} (${mine ? "me_to_them" : "them_to_me"})`,
      `  what: ${row.what}`,
      `  promised on: ${formatDay(row.origin.at)}`,
      `  deadline: ${dueLine(row, input.today)}`,
      `  current ledger state: ${STATE_LABEL[row.state]}`,
      `  thread it lives in: "${input.threadSubject}"`,
    ].join("\n"),
  );

  blocks.push(
    [
      "PEOPLE",
      `  me: ${owner.name} <${owner.email}> — ${owner.role}`,
      `  them: ${row.counterpartyName} <${row.counterparty}>${input.counterpartyOrg ? `, ${input.counterpartyOrg}` : ""}`,
      `  sign off as: ${firstName(owner.name)}`,
    ].join("\n"),
  );

  blocks.push(
    [
      "QUOTES — the actual words, in order. Quote from these verbatim.",
      "Who said it is part of the fact. Attribute every quote to the side the label names.",
      ...input.quotes.map(
        (q) =>
          `  [${formatDay(q.at)} — said by ${q.speaker}] "${q.text.replace(/\s+/g, " ").trim()}"` +
          (q.note ? `\n      (${q.note})` : ""),
      ),
    ].join("\n"),
  );

  blocks.push(`TRACK RECORD\n  ${reliabilityLine(input.reliability)}`);

  if (input.enrichment?.summary) {
    blocks.push(
      [
        `BACKGROUND ON ${input.counterpartyOrg || "their organisation"} (web search, may be out of date)`,
        `  ${input.enrichment.summary.replace(/\s+/g, " ").trim()}`,
        "  Use this only if it genuinely changes what is reasonable to ask for. Never",
        "  present it as something they told you, and never cite it as a source.",
      ].join("\n"),
    );
  }

  blocks.push(
    [
      `PLAYBOOK — ${playbook.name}`,
      `  tone: ${playbook.tone}`,
      `  instruction: ${playbook.instruction}`,
    ].join("\n"),
  );

  blocks.push(
    mine
      ? "Write the apology. It must contain my own promise, verbatim, with its date, and exactly one new date I am committing to."
      : "Write the follow-up. It must contain their promise, verbatim, with the date they made it.",
  );

  return blocks.join("\n\n");
}

/**
 * The repair pass.
 *
 * The prompt asks for the quote in three places, and Super usually complies.
 * When it does not, asking again with the exact required string is cheaper and
 * far more reliable than shipping an ungrounded draft, so the failure is caught
 * in code rather than left to the reader to notice.
 */
function repairMessages(input: DraftInput, firstBody: string): ChatMessage[] {
  const q = input.quotes[0];
  const mine = input.row.direction === "owed_by_me";
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: buildUserPrompt(input) },
    { role: "assistant", content: firstBody },
    {
      role: "user",
      content:
        `That draft does not carry the receipt correctly, so it is not usable. Rewrite it.\n\n` +
        `It must contain this text word for word, inside double quotation marks, with only the pronouns changed:\n` +
        `  "${q.text.replace(/\s+/g, " ").trim()}"\n\n` +
        `It must name the date those words were written: ${formatDay(q.at)}.\n` +
        (mine
          ? `Those are MY OWN words. Introduce them as "I said" or "I wrote". Writing "you said" there is wrong.\n`
          : `Those are THEIR words. Introduce them as "you said" or "you wrote".\n`) +
        `Keep the same tone and the same length. Output JSON only.`,
    },
  ];
}

export async function generateDraft(
  input: DraftInput,
  opts: { noCache?: boolean } = {},
): Promise<DraftResult> {
  if (input.quotes.length === 0) {
    throw new Error(
      `Row ${input.row.id} has no evidence quote. A chase with no receipt is exactly ` +
        `the thing this product refuses to send.`,
    );
  }

  const schema = { name: "chase_draft", schema: SCHEMA as unknown as Record<string, unknown> };
  // Measured: Super at reasoning_effort "medium" on this prompt spends 700-1400
  // tokens thinking before it writes a word. At max_tokens 1400 it returned
  // finish_reason "length" with EMPTY content, which chat() reads as a dead
  // model and silently falls through to Ultra. The budget has to cover the
  // reasoning, not just the email.
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: buildUserPrompt(input) },
  ];

  let res = await chat<{ subject: string; body: string }>({
    role: "draft",
    reasoningEffort: "medium",
    maxTokens: 3000,
    noCache: opts.noCache,
    schema,
    messages,
  });

  let tokens = (res.usage?.prompt_tokens ?? 0) + (res.usage?.completion_tokens ?? 0);
  const signer = firstName(input.owner.name);
  let body = markQuote(cleanBody(res.data.body ?? "", signer), input.quotes);
  let subject = cleanBody(res.data.subject ?? "").replace(/\s+/g, " ");
  let quoted =
    quotesEvidence(body, input.quotes) &&
    attributionOk(body, input.row.direction) &&
    hasQuotationMarks(body);

  if (!quoted) {
    try {
      const retry = await chat<{ subject: string; body: string }>({
        role: "draft",
        reasoningEffort: "medium",
        maxTokens: 3000,
        noCache: opts.noCache,
        schema,
        messages: repairMessages(input, body),
      });
      const retryBody = markQuote(cleanBody(retry.data.body ?? "", signer), input.quotes);
      tokens += (retry.usage?.prompt_tokens ?? 0) + (retry.usage?.completion_tokens ?? 0);
      if (
        quotesEvidence(retryBody, input.quotes) &&
        attributionOk(retryBody, input.row.direction) &&
        hasQuotationMarks(retryBody)
      ) {
        res = retry;
        body = retryBody;
        subject = cleanBody(retry.data.subject ?? "").replace(/\s+/g, " ");
        quoted = true;
      }
    } catch {
      // The first draft still exists and is still shown; it is just flagged as
      // ungrounded. Failing the whole request here would be worse.
    }
  }

  // Super returns subject: "" often enough that the schema's minLength is not
  // load-bearing on its own. A chase with no subject line is unusable, and the
  // thread it belongs to is known, so fill it rather than shipping a blank.
  if (!subject) subject = `Re: ${input.threadSubject}`.trim();

  return {
    subject,
    body,
    model: res.model,
    source: res.source,
    tokens,
    quoted,
    rowId: input.row.id,
    playbook: input.playbook.name,
    sources: input.enrichment?.sources ?? [],
  };
}

/**
 * Assemble everything a draft needs from the committed corpus.
 *
 * Server-side only — it reads the ledger, the corpus and the enrichment file
 * off disk. Callers are the /api/draft route and the local test script.
 */
export async function prepareDraft(
  rowId: string,
  playbook: DraftPlaybook,
): Promise<DraftInput> {
  const [rows, meta, messages, enrichment] = await Promise.all([
    loadLedger(),
    loadMeta(),
    loadMessages() as Promise<Message[]>,
    loadEnrichment(),
  ]);

  const decorated = decorate(rows, meta);
  const row = decorated.find((r) => r.id === rowId);
  if (!row) throw new Error(`No ledger row with id "${rowId}".`);

  const senderOf = new Map(messages.map((m) => [m.id, m.from]));
  const originMessage = messages.find((m) => m.id === row.origin.message_id);
  // "me (Sam Okafor)" rather than "Sam Okafor". Measured: given only the bare
  // name, Super wrote "On Sept 2 you wrote:" in front of the owner's OWN
  // promise — an apology that accuses the recipient of making it. Naming the
  // side explicitly is what fixed it.
  const speakerFor = (messageId: string | undefined, fallbackIsOwner: boolean): string => {
    const email = messageId ? senderOf.get(messageId) : undefined;
    const isOwner = email
      ? email.toLowerCase() === meta.owner.email.toLowerCase()
      : fallbackIsOwner;
    return isOwner ? `me (${meta.owner.name})` : `them (${row.counterpartyName})`;
  };

  const quotes: DraftQuote[] = [
    {
      speaker: speakerFor(row.origin.message_id, row.direction === "owed_by_me"),
      at: row.origin.at,
      text: row.origin.quote,
      note: "the original promise",
    },
    ...row.history.map((h) => ({
      speaker: speakerFor(h.evidence_message_id, false),
      at: h.at,
      text: h.evidence_quote,
      note: `${STATE_LABEL[h.state].toLowerCase()} — ${h.rationale}`,
    })),
  ];

  const person = meta.people.find(
    (p) => p.email.toLowerCase() === row.counterparty.toLowerCase(),
  );

  return {
    row,
    owner: meta.owner,
    today: meta.today,
    playbook,
    threadSubject: (originMessage?.subject ?? "").replace(/^re:\s*/i, "").trim(),
    quotes,
    counterpartyOrg: person?.org ?? "",
    reliability:
      reliability(decorated, meta).find((r) => r.counterparty === row.counterparty) ?? null,
    enrichment: enrichment[row.counterparty] ?? null,
  };
}
