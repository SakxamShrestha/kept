import type { LedgerState } from "@/lib/ledger";

/**
 * Color is information on this screen, so the chip stays quiet on purpose.
 *
 * `open` gets no color at all - an open row is the normal case, and the only
 * thing that makes it urgent is the days-late figure beside it, which is the
 * one place overdue red is spent. Chips that shout make the red mean nothing.
 */
const TONE: Record<LedgerState, string> = {
  open: "border-rule-strong text-ink-soft",
  partially_satisfied: "border-transparent bg-pending-bg text-pending",
  renegotiated: "border-transparent bg-pending-bg text-pending",
  satisfied: "border-transparent bg-settled-bg text-settled",
  superseded: "border-rule text-ink-faint",
  abandoned: "border-rule text-ink-faint",
};

export function StateChip({ state, label }: { state: LedgerState; label: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-[0.1875rem] text-[0.6875rem] leading-none ${TONE[state]}`}
    >
      {label}
    </span>
  );
}
