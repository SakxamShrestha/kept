import {
  buildView,
  decorate,
  loadLedger,
  loadMeta,
  STATE_LABEL,
  TERMINAL_STATES,
} from "@/lib/ledger";
import { LedgerBoard } from "@/app/components/LedgerBoard";
import type { InboxMessage } from "@/app/components/InboxNotice";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Mail that has not been reconciled into the committed ledger, read here so the
 * notice can describe it before anything is called. Absent file is not an error -
 * it just means there is nothing held back and the notice renders nothing.
 */
async function loadInbox(meta: { people: { name: string; email: string }[] }): Promise<InboxMessage[]> {
  try {
    const raw = await readFile(path.join(process.cwd(), "data", "corpus", "held-back.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      messages: { id: string; from: string; subject: string; date_iso: string }[];
    };
    return parsed.messages.map((m) => ({
      id: m.id,
      from: m.from,
      fromName:
        meta.people.find((p) => p.email.toLowerCase() === m.from.toLowerCase())?.name ?? m.from,
      subject: m.subject,
      date_iso: m.date_iso,
    }));
  } catch {
    return [];
  }
}

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
  const inbox = await loadInbox(meta);

  // Resolved here rather than in the client component: lib/ledger reads the
  // filesystem, so it cannot cross the boundary. Plain data can.
  const orgs = Object.fromEntries(meta.people.map((p) => [p.email, p.org]));

  return (
    <>
      {/* The rail already says which section this is, so the heading spends
          itself naming the thing underneath it instead of repeating the nav. */}
      <h1 className="mb-6 text-[1.3125rem] font-semibold tracking-tight">
        Where you stand
      </h1>
      <LedgerBoard
        view={view}
        allRows={rows}
        inbox={inbox}
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
