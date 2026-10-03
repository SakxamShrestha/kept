import {
  decorate,
  loadLedger,
  loadMeta,
  reliability,
  TERMINAL_STATES,
  type DisplayRow,
  type Reliability,
} from "@/lib/ledger";
import { overdueAs } from "@/lib/due";
import { MemoryRules } from "@/app/components/MemoryRules";
import { plural } from "@/app/components/format";

/**
 * `decorate()` marks a row overdue by comparing its deadline to today, which is
 * the right question for the ledger and the wrong one for a track record: a
 * promise delivered on the day it was due is still "past its date" a week
 * later. Before deriving reliability, closed rows are re-judged against the
 * date they actually closed, so delivering on time counts as delivering on
 * time. Live rows are untouched.
 */
function judgeAtClose(rows: DisplayRow[]): DisplayRow[] {
  return rows.map((r) => {
    if (!TERMINAL_STATES.includes(r.state)) return r;
    const closedAt = r.history.at(-1)?.at;
    if (!r.due_iso || !closedAt) return { ...r, overdue: false, daysLate: 0 };
    return { ...r, ...overdueAs(r.due_iso, closedAt) };
  });
}

/**
 * Memory, made legible.
 *
 * Two halves, and neither is a vector store. The rules are plain sentences the
 * viewer caused and can delete. The reliability figures are derived from the
 * ledger on every render rather than stored, so they cannot drift out of sync
 * with the rows they describe.
 */
export default async function MemoryPage() {
  const meta = await loadMeta();
  const rows = decorate(await loadLedger(), meta);
  const parties = reliability(judgeAtClose(rows), meta);

  const names: Record<string, string> = Object.fromEntries([
    ...meta.people.map((p) => [p.email, p.name]),
    [meta.owner.email, meta.owner.name],
  ]);
  const orgs = Object.fromEntries(meta.people.map((p) => [p.email, p.org]));

  return (
    <>
      <h1 className="text-[1.3125rem] font-semibold tracking-tight">
        What Kept has learned from you
      </h1>
      <p className="mt-2 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-soft">
        Memory here takes two forms: rules you taught it by correcting a row, and what
        the ledger has worked out about who actually delivers. Both are readable and
        both are yours to delete.
      </p>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-faint">
        No hidden embeddings, no profile you cannot read. Everything on the left is a
        sentence you can rewrite or delete; everything on the right is recomputed from
        the ledger each time this page loads.
      </p>

      <div className="mt-10 grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <MemoryRules names={names} />

        <section>
          <h2 className="flex items-baseline justify-between border-b border-rule-strong pb-2 text-sm font-semibold tracking-tight text-ink">
            Who keeps their word
            <span className="tabular text-xs font-normal text-ink-faint">
              {parties.length}
            </span>
          </h2>

          {parties.length === 0 ? (
            <p className="py-4 text-sm text-ink-faint">
              Nobody has promised you anything yet.
            </p>
          ) : (
            <ul>
              {parties.map((r) => (
                <li key={r.counterparty} className="border-b border-rule py-4 last:border-b-0">
                  <p className="text-sm leading-snug text-ink">
                    {phrase(r)}
                    {r.openOverdue > 0 ? (
                      <span className="text-overdue">
                        {" "}
                        {r.openOverdue === 1 ? "One is" : `${r.openOverdue} are`} still
                        open and past the date.
                      </span>
                    ) : null}
                  </p>
                  {orgs[r.counterparty] ? (
                    <p className="mt-0.5 text-xs text-ink-faint">{orgs[r.counterparty]}</p>
                  ) : null}

                  <dl className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                    <Figure label="Promised" value={String(r.promised)} />
                    <Figure label="Kept" value={String(r.kept)} />
                    <Figure label="Slipped" value={String(r.slipped)} />
                    <Figure
                      label="Avg days late"
                      value={r.avgDaysLate > 0 ? String(r.avgDaysLate) : "—"}
                    />
                  </dl>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 max-w-prose text-xs leading-relaxed text-ink-faint">
            Counted from rows owed to you. Slipped means it went past its date —
            delivered late, or still waiting. Derived from the ledger rather than
            stored, so it can never claim something the receipts do not.
          </p>
        </section>
      </div>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] uppercase tracking-[0.1em] text-ink-faint">
        {label}
      </dt>
      <dd className="tabular mt-0.5 text-sm text-ink-soft">{value}</dd>
    </div>
  );
}

/** Numbers are easy to skim past; a sentence is not. */
function phrase(r: Reliability): string {
  if (r.slipped > 0) {
    const tail =
      r.avgDaysLate > 0
        ? `, running ${r.avgDaysLate} ${plural(r.avgDaysLate, "day", "days")} late on average`
        : "";
    return `${r.name} has slipped ${r.slipped} of ${r.promised}${tail}.`;
  }
  if (r.kept === r.promised) {
    return r.promised === 1
      ? `${r.name} promised one thing and delivered it.`
      : `${r.name} has delivered all ${r.promised}, none of them late.`;
  }
  if (r.kept === 0) {
    return `${r.name} has ${r.promised} open with you and nothing late yet.`;
  }
  return `${r.name} has delivered ${r.kept} of ${r.promised}, with the rest still open and nothing late.`;
}
