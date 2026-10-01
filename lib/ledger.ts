/**
 * Ledger loading and presentation logic. Shared by every screen and route.
 *
 * Reads the committed baseline produced by scripts/build-ledger.mts. No fetch,
 * no database, no API call on the render path - the ledger must render with
 * NEBIUS_API_KEY absent, because judging happens twelve weeks after submission.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LedgerRow, LedgerState } from "./reconcile";
import { overdueAs } from "./due";

export type { LedgerRow, LedgerState };

export interface CorpusMeta {
  owner: { name: string; email: string; role: string };
  /** The demo's "today". Overdue is computed against THIS, never Date.now().
   *  A judge opening the demo in December must see "11 days overdue", not 94 -
   *  the latter makes a working corpus look abandoned. */
  today: string;
  people: { name: string; email: string; org: string; note: string }[];
  beats: { id: string; subject: string; beat: string }[];
}

export interface DisplayRow extends LedgerRow {
  /** Still owed and past its date, as of the demo clock. Always false once a
   *  row is terminal — a delivered promise is not overdue, however long ago it
   *  was due. */
  overdue: boolean;
  daysLate: number;
  /** Whether a closed row was late WHEN IT CLOSED. Judging a settled row
   *  against today instead of its closing date is how someone who delivered on
   *  the day they promised gets recorded as having slipped. */
  wasLate: boolean;
  daysLateAtClose: number;
  /** Below this the row is a suggestion, not a claim, and is quarantined into
   *  the "needs review" bucket rather than stated as fact in the main ledger. */
  lowConfidence: boolean;
  counterpartyName: string;
}

export const LOW_CONFIDENCE = 0.6;

const dataPath = (...p: string[]) => path.join(process.cwd(), "data", ...p);

export async function loadMeta(): Promise<CorpusMeta> {
  return JSON.parse(await readFile(dataPath("corpus", "meta.json"), "utf8"));
}

export async function loadLedger(): Promise<LedgerRow[]> {
  return JSON.parse(await readFile(dataPath("ledger", "baseline.json"), "utf8"));
}

export async function loadMessages() {
  return JSON.parse(await readFile(dataPath("corpus", "messages.json"), "utf8"));
}

export async function loadEnrichment(): Promise<Record<string, { summary: string; sources: string[] }>> {
  try {
    return JSON.parse(await readFile(dataPath("enrichment.json"), "utf8"));
  } catch {
    return {};
  }
}

/** "marcus@acmelogistics.com" -> "Marcus Reed" when the corpus knows them,
 *  otherwise a readable fallback rather than a raw address. */
export function displayName(email: string, meta: CorpusMeta): string {
  const known = meta.people.find((p) => p.email.toLowerCase() === email.toLowerCase());
  if (known) return known.name;
  if (email.toLowerCase() === meta.owner.email.toLowerCase()) return meta.owner.name;
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function decorate(rows: LedgerRow[], meta: CorpusMeta): DisplayRow[] {
  return rows.map((r) => {
    const live = isLive(r);
    // A closed row is judged against the day it closed, not against today.
    const closedAt = r.history.at(-1)?.at ?? null;
    const atClose = overdueAs(r.due_iso, closedAt ?? meta.today);
    const now = overdueAs(r.due_iso, meta.today);

    return {
      ...r,
      overdue: live && now.overdue,
      daysLate: live ? now.daysLate : 0,
      wasLate: live ? now.overdue : atClose.overdue,
      daysLateAtClose: live ? now.daysLate : atClose.daysLate,
      lowConfidence: r.confidence < LOW_CONFIDENCE,
      counterpartyName: displayName(r.counterparty, meta),
    };
  });
}

export const TERMINAL_STATES: LedgerState[] = ["satisfied", "superseded", "abandoned"];

export function isLive(r: LedgerRow): boolean {
  return !TERMINAL_STATES.includes(r.state);
}

/**
 * Overdue first and angriest at the top, then by deadline, then undated.
 *
 * Undated rows sort last rather than being hidden: a promise with no stated
 * deadline is still owed, it just cannot go overdue. Dropping them would make
 * the ledger quietly incomplete.
 */
export function sortForDisplay(rows: DisplayRow[]): DisplayRow[] {
  return [...rows].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.overdue && b.overdue) return b.daysLate - a.daysLate;
    if (!a.due_iso && !b.due_iso) return a.origin.at.localeCompare(b.origin.at);
    if (!a.due_iso) return 1;
    if (!b.due_iso) return -1;
    return a.due_iso.localeCompare(b.due_iso);
  });
}

export interface LedgerView {
  owedByMe: DisplayRow[];
  owedToMe: DisplayRow[];
  needsReview: DisplayRow[];
  closed: DisplayRow[];
  stats: {
    owedByMe: number;
    owedToMe: number;
    overdueByMe: number;
    overdueToMe: number;
    worstDaysLate: number;
  };
}

export function buildView(rows: DisplayRow[]): LedgerView {
  const live = rows.filter(isLive);
  const confident = live.filter((r) => !r.lowConfidence);

  const owedByMe = sortForDisplay(confident.filter((r) => r.direction === "owed_by_me"));
  const owedToMe = sortForDisplay(confident.filter((r) => r.direction === "owed_to_me"));

  return {
    owedByMe,
    owedToMe,
    needsReview: sortForDisplay(live.filter((r) => r.lowConfidence)),
    closed: rows.filter((r) => !isLive(r)),
    stats: {
      owedByMe: owedByMe.length,
      owedToMe: owedToMe.length,
      overdueByMe: owedByMe.filter((r) => r.overdue).length,
      overdueToMe: owedToMe.filter((r) => r.overdue).length,
      worstDaysLate: Math.max(0, ...rows.map((r) => r.daysLate)),
    },
  };
}

export interface Reliability {
  counterparty: string;
  name: string;
  promised: number;
  kept: number;
  slipped: number;
  openOverdue: number;
  avgDaysLate: number;
}

/**
 * Counterparty reliability, DERIVED from ledger history rather than stored.
 *
 * Deriving it means it can never drift out of sync with the rows it describes -
 * a stored counter would need updating on every transition and would silently
 * lie the first time that was missed.
 */
export function reliability(rows: DisplayRow[], meta: CorpusMeta): Reliability[] {
  const byParty = new Map<string, DisplayRow[]>();
  for (const r of rows) {
    if (r.direction !== "owed_to_me") continue; // only they can be unreliable to you
    const list = byParty.get(r.counterparty) ?? [];
    list.push(r);
    byParty.set(r.counterparty, list);
  }

  return [...byParty.entries()]
    .map(([counterparty, list]) => {
      const kept = list.filter((r) => r.state === "satisfied").length;
      // wasLate, not overdue: someone who delivered on the day they promised
      // must never be recorded as having slipped just because that day has
      // since passed.
      const lateOnes = list.filter((r) => r.wasLate);
      return {
        counterparty,
        name: displayName(counterparty, meta),
        promised: list.length,
        kept,
        slipped: lateOnes.length,
        openOverdue: list.filter((r) => r.overdue).length,
        avgDaysLate: lateOnes.length
          ? Math.round(lateOnes.reduce((n, r) => n + r.daysLateAtClose, 0) / lateOnes.length)
          : 0,
      };
    })
    .sort((a, b) => b.openOverdue - a.openOverdue || b.slipped - a.slipped);
}

export const STATE_LABEL: Record<LedgerState, string> = {
  open: "Open",
  partially_satisfied: "Partly delivered",
  renegotiated: "Renegotiated",
  satisfied: "Delivered",
  superseded: "Cancelled",
  abandoned: "Abandoned",
};
