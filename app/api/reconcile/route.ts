/**
 * POST /api/reconcile — apply one piece of held-back mail to the ledger, live.
 *
 * The rest of the demo shows a ledger that was already reconciled at build time.
 * This is the one place a viewer watches it happen: new mail arrives, Nemotron
 * decides what it does to the open rows, and a row changes state with a dated
 * verbatim quote as the reason.
 *
 * Three deliberate differences from scripts/build-ledger.mts, which does the same
 * job over the whole corpus:
 *
 *  1. CANDIDATES ARE SCOPED TO THE MESSAGE'S OWN THREAD. selectCandidates()
 *     short-circuits when every open row is same-thread (lib/reconcile.ts:161),
 *     which means no embeddings call happens. That matters because embed() has no
 *     disk cache and throws without an API key, so a cross-thread candidate
 *     ranking could never be replayed in a judging window months from now. A
 *     reply inside a thread is also the strongest signal there is, which is why
 *     same-thread rows are included unconditionally in the first place. The cost
 *     is real and worth naming: a reply that settles a promise made in a
 *     DIFFERENT thread will not be matched here, where the build would catch it.
 *
 *  2. NOTHING IS WRITTEN TO DISK. The build writes data/ledger/baseline.json;
 *     this must not. That file is the committed artifact 24 acceptance assertions
 *     and 18 rot checks are pinned to, and Vercel's filesystem is read-only
 *     anyway. The result goes back to the caller, which keeps it per-viewer.
 *
 *  3. NEW ROW IDS CONTINUE THE LEDGER. The build mints ids from its running
 *     array length; doing that here would start again at c000 and collide with
 *     an existing row.
 */

import { extractFromMessage, type Message } from "@/lib/extract";
import { shouldExtract } from "@/lib/gate";
import {
  buildView,
  decorate,
  loadLedger,
  loadMeta,
  type LedgerRow,
} from "@/lib/ledger";
import { applyTransition, reconcileMessage, rowFromCommitment, TERMINAL } from "@/lib/reconcile";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface HeldBack {
  messages: (Message & { beat?: string })[];
}

async function loadHeldBack(): Promise<HeldBack> {
  const file = path.join(process.cwd(), "data", "corpus", "held-back.json");
  return JSON.parse(await readFile(file, "utf8"));
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { messageId } = (body ?? {}) as { messageId?: unknown };
  if (typeof messageId !== "string" || !messageId.trim()) {
    return Response.json({ error: "messageId is required." }, { status: 400 });
  }

  const held = await loadHeldBack();
  const msg = held.messages.find((m) => m.id === messageId);
  if (!msg) {
    return Response.json(
      {
        error: `No held-back message "${messageId}".`,
        available: held.messages.map((m) => m.id),
      },
      { status: 404 },
    );
  }

  try {
    const [baseline, meta] = await Promise.all([loadLedger(), loadMeta()]);
    const owner = [meta.owner.email];

    // Stage 0 of the cascade, same as the build. Nano is cheap and fails open,
    // so a false yes costs one Super call and a false no would lose a promise.
    const gate = await shouldExtract(msg);

    // Any commitment the message makes in its own right. Ids continue from the
    // committed ledger rather than restarting - see note 3 above.
    const newRows: LedgerRow[] = [];
    let extractModel = "";
    if (gate.hasCommitment) {
      const extracted = await extractFromMessage(msg, owner);
      extractModel = extracted.model;
      extracted.commitments.forEach((c, i) => {
        newRows.push(rowFromCommitment(c, baseline.length + i));
      });
    }

    // Same-thread, still open, and originating before this message - a row cannot
    // be settled by the message that created it.
    const open = baseline.filter(
      (r) =>
        r.origin.thread_id === msg.thread_id &&
        !TERMINAL.has(r.state) &&
        r.origin.at < msg.date_iso,
    );

    const { applied, dropped, model, source } = open.length
      ? await reconcileMessage(msg, open)
      : { applied: [], dropped: [], model: "", source: "cache" as const };

    // Rebuild the ledger with the transitions applied. The baseline is left
    // alone; this is a copy the caller keeps.
    const byId = new Map(baseline.map((r) => [r.id, r]));
    const changedIds: string[] = [];
    for (const t of applied) {
      const row = byId.get(t.commitment_id);
      if (!row) continue;
      byId.set(t.commitment_id, applyTransition(row, t, msg));
      changedIds.push(t.commitment_id);
    }

    const nextRows = [...byId.values(), ...newRows];

    // Decorated and bucketed here, server-side, because decorate() needs the
    // frozen demo clock and the people table, and buildView sorts overdue first.
    // Handing the client a finished view means it does not have to reimplement
    // either, and cannot drift from what the server-rendered page shows.
    const decorated = decorate(nextRows, meta);
    const view = buildView(decorated);

    return Response.json({
      messageId: msg.id,
      subject: msg.subject,
      from: msg.from,
      date_iso: msg.date_iso,
      gate: { hasCommitment: gate.hasCommitment, model: gate.model },
      extractModel,
      changed: decorated.filter((r) => changedIds.includes(r.id)),
      newRows: decorated.filter((r) => newRows.some((n) => n.id === r.id)),
      // Reported so an unexplained or ungrounded transition is visible as a
      // number rather than silently absent.
      droppedCount: dropped.length,
      model,
      source,
      view,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const noKey = /NEBIUS_API_KEY/.test(message);
    return Response.json(
      {
        error: noKey
          ? "This reconciliation was not in the committed cache and there is no API key to run it live."
          : message,
        messageId,
      },
      { status: noKey ? 503 : 500 },
    );
  }
}
