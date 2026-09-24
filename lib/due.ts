/**
 * Resolve a grounded deadline phrase into an actual date.
 *
 * Deliberately not a model call. This is the one place in the pipeline where a
 * hallucination is unrecoverable: an invented date makes an undated promise go
 * overdue on its own, and the user chases someone over a deadline nobody agreed
 * to. A date parser either resolves the phrase or returns null, and null is a
 * perfectly good answer - a commitment with no deadline is still a commitment,
 * it just can never be overdue.
 *
 * Input must already be grounded by cleanDue() in extract.ts, i.e. the wording
 * actually appears in the message.
 */

import * as chrono from "chrono-node";

const ORDINAL = /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i;

/**
 * @param dueText  deadline as the message phrased it ("by end of day Friday")
 * @param statedAt ISO date of the message the promise was made in
 * @returns ISO date string, or null when the phrase carries no resolvable date
 */
export function resolveDue(dueText: string, statedAt: string): string | null {
  const text = (dueText ?? "").trim();
  if (!text) return null;

  const ref = new Date(statedAt);
  if (Number.isNaN(ref.getTime())) return null;

  const parsed = chrono.parse(text, ref, { forwardDate: true })[0];
  if (parsed) return parsed.start.date().toISOString();

  // chrono does not handle a bare day-of-month ("by the 15th", "the 25th"),
  // which is one of the most common ways business email states a deadline.
  const m = text.match(ORDINAL);
  if (m) {
    const day = Number(m[1]);
    if (day >= 1 && day <= 31) {
      const d = new Date(ref);
      d.setUTCDate(day);
      // A day earlier in the month than the message itself means next month -
      // "I'll send it by the 3rd" written on the 28th is not four weeks ago.
      if (d.getTime() < ref.getTime()) d.setUTCMonth(d.getUTCMonth() + 1);
      return d.toISOString();
    }
  }

  return null;
}

export type Overdue = { overdue: boolean; daysLate: number };

/**
 * Overdue is counted in CALENDAR days, not elapsed milliseconds.
 *
 * A deadline of "by the 12th" resolves with the originating message's
 * time-of-day attached, so a millisecond diff against the 23rd floors to 10
 * days rather than 11. Users count dates on a calendar; a ledger that says "10
 * days overdue" for Sept 12 to Sept 23 looks broken even though the arithmetic
 * is defensible.
 */
export function overdueAs(dueIso: string | null, asOf: string): Overdue {
  if (!dueIso) return { overdue: false, daysLate: 0 };

  const dayOf = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? NaN
      : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };

  const due = dayOf(dueIso);
  const now = dayOf(asOf);
  if (Number.isNaN(due) || Number.isNaN(now) || now <= due) {
    return { overdue: false, daysLate: 0 };
  }
  return { overdue: true, daysLate: Math.round((now - due) / 86_400_000) };
}
