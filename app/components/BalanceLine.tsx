import type { DisplayRow } from "@/lib/ledger";

/**
 * The statement of position.
 *
 * A ledger's defining object is a balance: two sides, read against each other.
 * So the screen opens with one rather than with a row of counters - one rule,
 * what you owe on the left, what you are owed on the right, a segment per
 * commitment, oxblood where a segment is late.
 *
 * It is drawing, but it is not illustration: every segment is one row, and
 * hovering names it. The gap in the middle is the thing being balanced, which is
 * why the two sides are not flush.
 */
export function BalanceLine({
  owedByMe,
  owedToMe,
}: {
  owedByMe: DisplayRow[];
  owedToMe: DisplayRow[];
}) {
  if (owedByMe.length === 0 && owedToMe.length === 0) return null;

  const segment = (r: DisplayRow, side: "you" | "them") => (
    <span
      key={r.id}
      className="balance-seg"
      data-state={r.overdue ? "overdue" : r.state === "partially_satisfied" ? "pending" : "open"}
      title={
        `${r.what} — ${side === "you" ? `you owe ${r.counterpartyName}` : `${r.counterpartyName} owes you`}` +
        (r.overdue ? `, ${r.daysLate} days late` : r.due_text ? `, due ${r.due_text}` : ", no deadline")
      }
    />
  );

  return (
    <div>
      <div className="balance" role="img" aria-label={
        `Balance: you owe ${owedByMe.length}, ${owedByMe.filter((r) => r.overdue).length} late. ` +
        `You are owed ${owedToMe.length}, ${owedToMe.filter((r) => r.overdue).length} late.`
      }>
        {/* Reversed so the oldest debts sit at the outer edges and the two sides
            read outward from the gap, the way a balance does. */}
        {[...owedByMe].reverse().map((r) => segment(r, "you"))}
        <span className="balance-gap" aria-hidden="true" />
        {owedToMe.map((r) => segment(r, "them"))}
      </div>

      <div className="ledger-row mt-2">
        <p className="text-[0.75rem] text-ink-faint">
          <span className="tabular text-ink-soft">{owedByMe.length}</span> you owe
        </p>
        <p className="text-[0.75rem] text-ink-faint">
          owed to you <span className="tabular text-ink-soft">{owedToMe.length}</span>
        </p>
      </div>
    </div>
  );
}
