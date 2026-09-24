/**
 * Reconciliation — stage 2, and the thing that makes this a ledger rather than
 * a list of extracted sentences.
 *
 * Each new message, in chronological order, is asked what it does to the open
 * rows it could plausibly affect. The hard calls are:
 *
 *   superseded vs satisfied  - "hold off on that, it's not needed" is NOT
 *                              delivery, and conflating them silently closes a
 *                              row nobody ever fulfilled.
 *   renegotiated vs slipped  - an agreed new date is not a broken promise.
 *   abandoned                - never inferred from silence. See below.
 */

import { chat, embed, cosine } from "./nebius";
import { resolveDue } from "./due";
import type { Message, ExtractedCommitment } from "./extract";

export type LedgerState =
  | "open"
  | "partially_satisfied"
  | "renegotiated"
  | "satisfied"
  | "superseded"
  | "abandoned";

export const TERMINAL: ReadonlySet<LedgerState> = new Set<LedgerState>([
  "satisfied",
  "superseded",
  "abandoned",
]);

export interface HistoryEntry {
  state: LedgerState;
  at: string;
  evidence_message_id: string;
  evidence_quote: string;
  rationale: string;
}

export interface LedgerRow {
  id: string;
  direction: "owed_by_me" | "owed_to_me";
  counterparty: string;
  what: string;
  due_text: string;
  due_iso: string | null;
  confidence: number;
  state: LedgerState;
  origin: { message_id: string; thread_id: string; quote: string; at: string };
  history: HistoryEntry[];
}

interface Transition {
  commitment_id: string;
  new_state: LedgerState;
  evidence_quote: string;
  rationale: string;
  new_due_text: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["transitions"],
  properties: {
    transitions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["commitment_id", "new_state", "evidence_quote", "rationale", "new_due_text"],
        properties: {
          commitment_id: { type: "string" },
          new_state: {
            type: "string",
            enum: ["partially_satisfied", "renegotiated", "satisfied", "superseded", "abandoned"],
          },
          evidence_quote: {
            type: "string",
            description: "Exact sentence from THIS message proving the change",
          },
          rationale: {
            type: "string",
            minLength: 15,
            description: "One full sentence explaining the change. Shown to the user. Never empty.",
          },
          new_due_text: {
            type: "string",
            description: "Only for renegotiated: the new deadline as phrased. Otherwise empty string.",
          },
        },
      },
    },
  },
} as const;

const SYSTEM = `You maintain a ledger of outstanding commitments. Given one new email and
a list of currently open commitments, decide which of them this email changes.

Change a commitment ONLY when this email is direct evidence. If the email is
unrelated to a commitment, say nothing about it. Most emails change nothing;
returning an empty transitions list is the common and correct answer.

STATES:

satisfied - the thing was actually delivered or done.
  "Dates confirmed, all three sites: Riverton Oct 6..." -> satisfied
  "Attached is the finished report." -> satisfied

partially_satisfied - some delivered, a remainder is still owed.
  "Sending eleven of the thirteen vendors. Still chasing the other two."

superseded - CANCELLED or REPLACED before delivery. Nothing was delivered.
  "Hold off on the diligence summary, the committee pushed it to November."
  This is NOT satisfied. Nobody did the work. It stopped being wanted.
  Getting this wrong silently closes a row that was never fulfilled.

renegotiated - both sides moved to a NEW DEADLINE. The commitment still stands.
  "Can we push the staffing model to the 29th?" -> renegotiated, new_due_text "the 29th"
  This is NOT abandoned and NOT superseded. The work is still coming.

abandoned - EXPLICITLY dropped in words. "We're not doing that anymore."
  Silence is NEVER abandonment. If someone simply stopped replying, the
  commitment stays open. Do not use this state to tidy up stale rows.

The commitment_id must be copied exactly from the candidate list.
evidence_quote must be copied character-for-character from THIS email. If you
cannot quote it exactly, do not emit the transition.`;

function flatten(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\\(["'])/g, "$1")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Pick the rows this message could plausibly affect.
 *
 * Same-thread open rows are always included - a reply in a thread is the single
 * strongest signal, and cosine similarity alone misses short replies like
 * "done, sent it over". Everything else competes on embedding similarity.
 *
 * The cap matters: passing the whole ledger would both blow past the ~100k
 * token point where Nemotron starts misreading exact facts, and invite the
 * model to invent relationships between unrelated rows.
 */
export async function selectCandidates(
  msg: Message,
  open: LedgerRow[],
  opts: { topK?: number; cap?: number } = {},
): Promise<LedgerRow[]> {
  const topK = opts.topK ?? 6;
  const cap = opts.cap ?? 8;

  const sameThread = open.filter((r) => r.origin.thread_id === msg.thread_id);
  const others = open.filter((r) => r.origin.thread_id !== msg.thread_id);
  if (others.length === 0) return sameThread.slice(0, cap);

  let ranked: LedgerRow[] = [];
  try {
    const vectors = await embed([
      `${msg.subject}\n${msg.body_text}`,
      ...others.map((r) => `${r.what} (${r.counterparty})`),
    ]);
    const [msgVec, ...rowVecs] = vectors;
    ranked = others
      .map((r, i) => ({ row: r, score: cosine(msgVec, rowVecs[i]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((x) => x.row);
  } catch {
    // Embeddings are an optimization for ranking, not a correctness
    // requirement. If the endpoint is unavailable, fall back to recency so
    // reconciliation still runs rather than failing the whole build.
    ranked = [...others]
      .sort((a, b) => b.origin.at.localeCompare(a.origin.at))
      .slice(0, topK);
  }

  return [...sameThread, ...ranked].slice(0, cap);
}

function candidateBlock(rows: LedgerRow[]): string {
  return rows
    .map(
      (r) =>
        `- id: ${r.id}\n  direction: ${r.direction}\n  counterparty: ${r.counterparty}\n` +
        `  what: ${r.what}\n  due: ${r.due_text || "(none stated)"}\n  state: ${r.state}\n` +
        `  originally said: "${r.origin.quote}"`,
    )
    .join("\n");
}

export interface ReconcileResult {
  applied: Transition[];
  /** Transitions dropped because the quote was not in the message, or the id
   *  did not match a candidate. Reported so the eval can measure grounding. */
  dropped: Transition[];
  model: string;
  source: "live" | "cache";
}

export async function reconcileMessage(
  msg: Message,
  open: LedgerRow[],
  opts: { noCache?: boolean } = {},
): Promise<ReconcileResult> {
  const candidates = await selectCandidates(msg, open);
  if (candidates.length === 0) {
    return { applied: [], dropped: [], model: "", source: "cache" };
  }

  const res = await chat<{ transitions: Transition[] }>({
    role: "reconcile",
    reasoningEffort: "high",
    maxTokens: 4096,
    noCache: opts.noCache,
    schema: { name: "transitions", schema: SCHEMA as unknown as Record<string, unknown> },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `OPEN COMMITMENTS:\n${candidateBlock(candidates)}\n\nNEW EMAIL\nFrom: ${msg.from}\nDate: ${msg.date_iso}\nSubject: ${msg.subject}\n\n${msg.body_text}`,
      },
    ],
  });

  const validIds = new Set(candidates.map((c) => c.id));
  const flat = flatten(msg.body_text);
  const applied: Transition[] = [];
  const dropped: Transition[] = [];

  for (const t of res.data.transitions ?? []) {
    const quote = flatten(t.evidence_quote);
    // A state change with no explanation is a receipt nobody can audit, which
    // defeats the point of the ledger. Drop it rather than show a blank reason.
    if (
      !validIds.has(t.commitment_id) ||
      quote.length < 10 ||
      !flat.includes(quote) ||
      !t.rationale?.trim()
    ) {
      dropped.push(t);
      continue;
    }
    applied.push(t);
  }

  return { applied, dropped, model: res.model, source: res.source };
}

/** Apply a transition to a row, appending history rather than overwriting it so
 *  the UI can always show how a row reached its current state. */
export function applyTransition(row: LedgerRow, t: Transition, msg: Message): LedgerRow {
  const next: LedgerRow = {
    ...row,
    state: t.new_state,
    history: [
      ...row.history,
      {
        state: t.new_state,
        at: msg.date_iso,
        evidence_message_id: msg.id,
        evidence_quote: t.evidence_quote,
        rationale: t.rationale,
      },
    ],
  };

  if (t.new_state === "renegotiated" && t.new_due_text) {
    const iso = resolveDue(t.new_due_text, msg.date_iso);
    if (iso) {
      next.due_text = t.new_due_text;
      next.due_iso = iso;
      // A renegotiated commitment is live again against its new date. Leaving
      // it in a terminal-looking state would hide work that is still coming.
      next.state = "open";
      next.history[next.history.length - 1].state = "renegotiated";
    }
  }

  return next;
}

export function rowFromCommitment(c: ExtractedCommitment, index: number): LedgerRow {
  return {
    id: `c${String(index).padStart(3, "0")}`,
    direction: c.direction,
    counterparty: c.counterparty,
    what: c.what,
    due_text: c.due_text,
    due_iso: resolveDue(c.due_text, c.stated_at),
    confidence: c.confidence,
    state: "open",
    origin: {
      message_id: c.message_id,
      thread_id: c.thread_id,
      quote: c.evidence_quote,
      at: c.stated_at,
    },
    history: [],
  };
}
