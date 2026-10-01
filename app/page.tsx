import {
  buildView,
  decorate,
  loadLedger,
  loadMeta,
  STATE_LABEL,
  TERMINAL_STATES,
} from "@/lib/ledger";
import { LedgerBoard } from "@/app/components/LedgerBoard";

/**
 * The ledger.
 *
 * A server component that reads the committed baseline off disk. There is no
 * fetch and no model call on this path by design: judging happens twelve weeks
 * after submission closes, and this page has to render identically with
 * NEBIUS_API_KEY absent. Everything the viewer changes lives in their browser.
 */
export default async function LedgerPage() {
  const meta = await loadMeta();
  const rows = decorate(await loadLedger(), meta);
  const view = buildView(rows);

  // Resolved here rather than in the client component: lib/ledger reads the
  // filesystem, so it cannot cross the boundary. Plain data can.
  const orgs = Object.fromEntries(meta.people.map((p) => [p.email, p.org]));

  return (
    <>
      <h1 className="mb-3 text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
        Ledger
      </h1>
      <LedgerBoard
        view={view}
        allRows={rows}
        ctx={{
          stateLabels: STATE_LABEL,
          terminalStates: TERMINAL_STATES,
          orgs,
          ownerName: meta.owner.name,
          ownerEmail: meta.owner.email,
        }}
      />
    </>
  );
}
