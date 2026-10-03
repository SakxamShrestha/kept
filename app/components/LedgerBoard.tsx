"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { DisplayRow, LedgerView } from "@/lib/ledger";
import {
  addRule,
  dismissRow,
  loadApplied,
  loadDismissed,
  loadRules,
  restoreRow,
  ruleFromRejection,
  saveRules,
  type AppliedReconciliation,
} from "@/lib/policy";
import { CommitmentRow, type RowContext } from "./CommitmentRow";
import { InboxNotice, type InboxMessage } from "./InboxNotice";
import { BalanceLine } from "./BalanceLine";
import { plural } from "./format";

interface LastCorrection {
  rowId: string;
  what: string;
  ruleId: string;
  ruleText: string;
}

/**
 * The ledger body.
 *
 * A client component because dismissals live in localStorage, which is the
 * deliberate persistence choice for this project - each viewer gets a clean
 * session and their corrections never leave the browser. It still renders in
 * full on the server, so the rows and their receipts are in the HTML whether
 * or not JavaScript ever runs; the only thing hydration adds is the ability to
 * correct a row and hide the ones already corrected.
 */
export function LedgerBoard({
  view,
  allRows,
  ctx,
  inbox = [],
}: {
  view: LedgerView;
  allRows: DisplayRow[];
  ctx: RowContext;
  /** Mail that has not been reconciled into the committed ledger. Empty when
   *  there is none held back, and the notice then renders nothing. */
  inbox?: InboxMessage[];
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [last, setLast] = useState<LastCorrection | null>(null);
  // Starts empty so the server render and the first client render agree; a
  // reconciliation this viewer already ran arrives after mount.
  const [applied, setApplied] = useState<AppliedReconciliation>({
    messageIds: [],
    view: null,
    changed: [],
    newRowIds: [],
    at: "",
  });

  useEffect(() => {
    const sync = () => {
      setDismissed(loadDismissed());
      setApplied(loadApplied());
    };
    sync();
    window.addEventListener("kept:storage", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("kept:storage", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const handleDismiss = useCallback((row: DisplayRow) => {
    // The correction and the rule it produces are written together, so a
    // dismissed row can never exist without a visible reason for it.
    const rule = ruleFromRejection({
      id: row.id,
      what: row.what,
      counterparty: row.counterparty,
      counterpartyName: row.counterpartyName,
      confidence: row.confidence,
    });
    addRule(rule);
    dismissRow(row.id);
    setDismissed(loadDismissed());
    setLast({ rowId: row.id, what: row.what, ruleId: rule.id, ruleText: rule.rule });
  }, []);

  const handleRestore = useCallback((row: DisplayRow) => {
    restoreRow(row.id);
    setDismissed(loadDismissed());
  }, []);

  const handleUndo = useCallback(() => {
    if (!last) return;
    restoreRow(last.rowId);
    saveRules(loadRules().filter((r) => r.id !== last.ruleId));
    setDismissed(loadDismissed());
    setLast(null);
  }, [last]);

  const kept = (rows: DisplayRow[]) => rows.filter((r) => !dismissed.includes(r.id));

  // Once this viewer has run a reconciliation, the server's recomputed view
  // replaces the committed one wholesale. Taking the server's answer verbatim
  // rather than patching rows here is what keeps the client's idea of the ledger
  // from drifting out of step with the overdue arithmetic and the sort order.
  const live = applied.view ?? view;

  const owedByMe = kept(live.owedByMe);
  const owedToMe = kept(live.owedToMe);
  const needsReview = kept(live.needsReview);
  const everyRow = applied.view
    ? [...live.owedByMe, ...live.owedToMe, ...live.needsReview, ...live.closed]
    : allRows;
  const dropped = everyRow.filter((r) => dismissed.includes(r.id));

  // view.stats is the truth until the viewer corrects something; after that it
  // is recomputed so the sentence at the top can never contradict the columns
  // under it.
  const stats =
    dismissed.length === 0
      ? live.stats
      : {
          owedByMe: owedByMe.length,
          owedToMe: owedToMe.length,
          overdueByMe: owedByMe.filter((r) => r.overdue).length,
          overdueToMe: owedToMe.filter((r) => r.overdue).length,
          worstDaysLate: Math.max(0, ...[...owedByMe, ...owedToMe].map((r) => r.daysLate)),
        };

  return (
    <div className="space-y-10">
      {inbox.length > 0 ? (
        <InboxNotice inbox={inbox} applied={applied} onApplied={setApplied} />
      ) : null}

      <section>
        <BalanceLine owedByMe={owedByMe} owedToMe={owedToMe} />

        <p className="mt-7 max-w-[62ch] text-[1.0625rem] leading-relaxed text-ink">
          You owe <span className="tabular">{stats.owedByMe}</span>{" "}
          {plural(stats.owedByMe, "thing", "things")}
          {stats.overdueByMe > 0 ? (
            <>
              ,{" "}
              <span className="text-overdue">
                <span className="tabular">{stats.overdueByMe}</span> overdue
              </span>
            </>
          ) : (
            ", none overdue"
          )}
          . <span className="tabular">{stats.owedToMe}</span>{" "}
          {plural(stats.owedToMe, "thing is", "things are")} owed to you
          {stats.overdueToMe > 0 ? (
            <>
              ,{" "}
              <span className="text-overdue">
                <span className="tabular">{stats.overdueToMe}</span> overdue
              </span>
            </>
          ) : (
            ", none overdue"
          )}
          .
          {stats.worstDaysLate > 0 ? (
            <>
              {" "}
              The oldest has been waiting{" "}
              <span className="tabular text-overdue">{stats.worstDaysLate} days</span>.
            </>
          ) : null}
        </p>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-faint">
          Read from a ledger file committed to the repo — it renders with no API key at
          all, and every row opens to the sentence it was taken from. Reconciling new
          mail and drafting a chase are the two things here that call a model, and both
          say so when they do.
        </p>
      </section>

      {last ? (
        <section className="border-l-2 border-accent bg-surface py-3 pl-4 pr-4">
          <p className="text-sm text-ink-soft">
            Dropped <span className="text-ink">{last.what}</span>. Kept wrote itself a
            rule:
          </p>
          <p className="mt-1.5 text-sm leading-snug text-ink">{last.ruleText}</p>
          <p className="mt-2 text-xs">
            <Link href="/memory" className="text-accent underline underline-offset-2">
              See it in Memory
            </Link>
            <span aria-hidden="true" className="text-ink-faint">
              {" · "}
            </span>
            <button
              type="button"
              onClick={handleUndo}
              className="text-ink-faint underline underline-offset-2 hover:text-ink"
            >
              Undo
            </button>
          </p>
        </section>
      ) : null}

      <div className="grid gap-x-12 gap-y-10 md:grid-cols-2">
        <Column
          title="You owe"
          rows={owedByMe}
          empty="Nothing outstanding on your side."
          ctx={ctx}
          onDismiss={handleDismiss}
        />
        <Column
          title="Owed to you"
          rows={owedToMe}
          empty="Nobody currently owes you anything."
          ctx={ctx}
          onDismiss={handleDismiss}
        />
      </div>

      {/*
        The low-confidence bucket is shown even when it is empty. It is how the
        precision/recall tradeoff stays visible rather than hidden, and an empty
        one still tells the reader where uncertain rows would go.
      */}
      <Drawer
        title="Needs review"
        count={needsReview.length}
        note="Rows the extractor scored below 0.60. They are held out of the ledger above rather than stated as fact, because a row that might be wrong is worse than a row that is missing."
      >
        {needsReview.length === 0 ? (
          <p className="py-3 text-sm text-ink-soft">
            Nothing in this mailbox is under the threshold right now.
          </p>
        ) : (
          needsReview.map((row) => (
            <CommitmentRow key={row.id} row={row} ctx={ctx} onDismiss={handleDismiss} />
          ))
        )}
      </Drawer>

      <Drawer
        title="Settled"
        count={live.closed.length}
        note="Delivered, cancelled, or abandoned. Kept rather than deleted, because the receipt is what proves it closed."
      >
        {live.closed.length === 0 ? (
          <p className="py-3 text-sm text-ink-soft">Nothing has closed yet.</p>
        ) : (
          live.closed.map((row) => <CommitmentRow key={row.id} row={row} ctx={ctx} />)
        )}
      </Drawer>

      {dropped.length > 0 ? (
        <Drawer
          title="You said these were not commitments"
          count={dropped.length}
          note="Your corrections. Each one wrote a rule in Memory; putting a row back here does not delete that rule."
        >
          {dropped.map((row) => (
            <CommitmentRow key={row.id} row={row} ctx={ctx} onRestore={handleRestore} />
          ))}
        </Drawer>
      ) : null}
    </div>
  );
}

function Column({
  title,
  rows,
  empty,
  ctx,
  onDismiss,
}: {
  title: string;
  rows: DisplayRow[];
  empty: string;
  ctx: RowContext;
  onDismiss: (row: DisplayRow) => void;
}) {
  return (
    <section>
      <h2 className="flex items-baseline justify-between border-b border-rule-strong pb-2 text-sm font-semibold tracking-tight text-ink">
        {title}
        <span className="tabular text-xs font-normal text-ink-faint">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-ink-faint">{empty}</p>
      ) : (
        <div>
          {rows.map((row) => (
            <CommitmentRow key={row.id} row={row} ctx={ctx} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </section>
  );
}

function Drawer({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count: number;
  note: string;
  children: ReactNode;
}) {
  return (
    <details className="group border-t border-rule pt-4">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold tracking-tight text-ink">
          {title}
          <span className="ml-2 tabular text-xs font-normal text-ink-faint">{count}</span>
        </span>
        <span className="text-xs text-accent underline-offset-2 group-hover:underline">
          <span className="group-open:hidden">Open</span>
          <span className="hidden group-open:inline">Close</span>
        </span>
      </summary>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-faint">{note}</p>
      <div className="mt-3">{children}</div>
    </details>
  );
}
