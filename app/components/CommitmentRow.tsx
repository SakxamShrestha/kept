"use client";

import Link from "next/link";
import type { DisplayRow, LedgerState } from "@/lib/ledger";
import { StateChip } from "./StateChip";
import { ChaseComposer } from "./ChaseComposer";
import { fmtDate, plural } from "./format";

/**
 * Everything the row needs that lives on the server side of the boundary.
 *
 * `lib/ledger` reads the committed JSON off disk, so it cannot be imported
 * into a client component. STATE_LABEL and the org lookup are resolved on the
 * server and handed across as plain data instead.
 */
export interface RowContext {
  stateLabels: Record<LedgerState, string>;
  /** lib/ledger's TERMINAL_STATES, carried across the boundary. A closed row
   *  still has a due date in the past, so without this a delivered promise
   *  would show up in overdue red - and red only means something here while it
   *  is spent on things that are genuinely still owed. */
  terminalStates: LedgerState[];
  orgs: Record<string, string>;
  ownerName: string;
  ownerEmail: string;
}

/**
 * One line of the ledger, expanding to its receipt.
 *
 * `<details>` rather than React state on purpose: the receipt is the one thing
 * on this page that has to work when JavaScript does not, because the claim the
 * product makes is that a row can be trusted without re-reading the thread.
 */
export function CommitmentRow({
  row,
  ctx,
  onDismiss,
  onRestore,
}: {
  row: DisplayRow;
  ctx: RowContext;
  onDismiss?: (row: DisplayRow) => void;
  onRestore?: (row: DisplayRow) => void;
}) {
  // Who actually said the sentence. On a row you owe, the promise is yours -
  // attributing it to the counterparty would make the receipt a lie.
  const speaker =
    row.direction === "owed_by_me"
      ? { name: ctx.ownerName, email: ctx.ownerEmail }
      : { name: row.counterpartyName, email: row.counterparty };
  const org = ctx.orgs[row.counterparty];
  const stillOwed = !ctx.terminalStates.includes(row.state);

  return (
    <details
      id={`row-${row.id}`}
      className="group scroll-mt-24 border-b border-rule last:border-b-0"
    >
      <summary className="flex cursor-pointer list-none items-baseline gap-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium text-ink">{row.counterpartyName}</span>
            {org ? <span className="text-xs text-ink-faint">{org}</span> : null}
          </div>
          <p className="mt-0.5 text-sm leading-snug text-ink-soft">{row.what}</p>
          <p className="mt-1 text-xs text-ink-faint">
            {row.due_text ? `due ${row.due_text}` : "no deadline stated"}
            <span aria-hidden="true"> · </span>
            <span className="text-accent underline-offset-2 group-hover:underline">
              <span className="group-open:hidden">Show receipt</span>
              <span className="hidden group-open:inline">Hide receipt</span>
            </span>
          </p>
        </div>

        <div className="shrink-0 space-y-1.5 text-right">
          <StateChip state={row.state} label={ctx.stateLabels[row.state]} />
          {row.overdue && stillOwed ? (
            <div className="tabular text-xs text-overdue">
              {row.daysLate} {plural(row.daysLate, "day", "days")} late
            </div>
          ) : null}
        </div>
      </summary>

      <div className="border-t border-rule pb-6 pt-4">
        <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
          <dt className="text-[0.6875rem] uppercase tracking-[0.14em] text-ink-faint">
            Said
          </dt>
          <dd>
            <blockquote className="receipt">{row.origin.quote}</blockquote>
            <p className="mt-2 text-xs text-ink-soft">
              {speaker.name} <span className="text-ink-faint">{speaker.email}</span>
              <span aria-hidden="true"> · </span>
              <span className="tabular">{fmtDate(row.origin.at)}</span>
            </p>
            <p className="mt-0.5 font-mono text-[0.6875rem] text-ink-faint">
              {row.origin.message_id}
            </p>
          </dd>

          <dt className="text-[0.6875rem] uppercase tracking-[0.14em] text-ink-faint">
            Since
          </dt>
          <dd>
            {row.history.length === 0 ? (
              <p className="text-sm leading-relaxed text-ink-soft">
                No later message has touched this row. Silence on its own never closes
                one, so it stays exactly where the promise left it.
              </p>
            ) : (
              <ol className="space-y-5">
                {row.history.map((h, i) => (
                  <li key={`${h.evidence_message_id}-${i}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <StateChip state={h.state} label={ctx.stateLabels[h.state]} />
                      <span className="tabular text-xs text-ink-faint">{fmtDate(h.at)}</span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                      {h.rationale}
                    </p>
                    <blockquote className="receipt mt-2">{h.evidence_quote}</blockquote>
                    <p className="mt-1 font-mono text-[0.6875rem] text-ink-faint">
                      {h.evidence_message_id}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </dd>

          {onDismiss ? (
            <>
              <dt className="text-[0.6875rem] uppercase tracking-[0.14em] text-ink-faint">
                Correct
              </dt>
              <dd>
                <button
                  type="button"
                  onClick={() => onDismiss(row)}
                  className="border border-rule-strong px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
                >
                  Not a commitment
                </button>
                <p className="mt-2 max-w-prose text-xs leading-relaxed text-ink-faint">
                  Drops the row and writes one plain English rule into{" "}
                  <Link
                    href="/memory"
                    className="text-accent underline underline-offset-2"
                  >
                    Memory
                  </Link>
                  , with this row recorded as the reason it exists.
                </p>
              </dd>
            </>
          ) : null}

          {onRestore ? (
            <>
              <dt className="text-[0.6875rem] uppercase tracking-[0.14em] text-ink-faint">
                Correct
              </dt>
              <dd>
                <button
                  type="button"
                  onClick={() => onRestore(row)}
                  className="border border-rule-strong px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
                >
                  Put it back
                </button>
                <p className="mt-2 max-w-prose text-xs leading-relaxed text-ink-faint">
                  Returns the row to the ledger. The rule your correction wrote stays in
                  Memory until you delete it there.
                </p>
              </dd>
            </>
          ) : null}
        </dl>

        {/* Outside the <dl> on purpose: a subject line and a body editor do not
            fit the 6.5rem label column, and the composer reads better given the
            full width of the receipt. Only on rows still owed - there is nothing
            to chase on a promise that was kept. */}
        {stillOwed ? <ChaseComposer row={row} /> : null}
      </div>
    </details>
  );
}
