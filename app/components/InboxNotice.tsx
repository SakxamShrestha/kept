"use client";

import { useState } from "react";
import { appendCallLog, clearApplied, saveApplied, type AppliedReconciliation } from "@/lib/policy";
import { fmtDate } from "./format";

/**
 * New mail, and the button that reconciles it.
 *
 * Everything else on the ledger was reconciled before the page was built. This is
 * where a viewer watches it happen: one message arrives, Nemotron decides what it
 * does to the open rows, and the columns change underneath with a dated verbatim
 * quote on every state change.
 *
 * Deliberately not auto-run on load. The point being demonstrated is that the
 * ledger reconciles itself as mail arrives, and that is only visible if someone
 * sees the before and then the after.
 */

export interface InboxMessage {
  id: string;
  from: string;
  fromName: string;
  subject: string;
  date_iso: string;
}

type Status = "idle" | "running" | "done" | "error";

export function InboxNotice({
  inbox,
  applied,
  onApplied,
}: {
  inbox: InboxMessage[];
  applied: AppliedReconciliation;
  onApplied: (next: AppliedReconciliation) => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const pending = inbox.filter((m) => !applied.messageIds.includes(m.id));
  const hasApplied = applied.messageIds.length > 0;

  if (pending.length === 0 && !hasApplied) return null;

  async function run(messageId: string) {
    setStatus("running");
    setError(null);

    try {
      const res = await fetch("/api/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const payload = await res.json();

      if (!res.ok) {
        setError(
          typeof payload?.error === "string" ? payload.error : `Request failed (${res.status}).`,
        );
        setStatus("error");
        return;
      }

      // Both stages of the cascade are logged, including the gate that answered
      // "no commitment here" and saved the expensive call. The Access screen is
      // meant to show what this thing actually did, and a call that was avoided
      // is part of that.
      appendCallLog({
        at: new Date().toISOString(),
        role: "gate",
        model: payload.gate?.model ?? "",
        source: "live",
        note: payload.gate?.hasCommitment
          ? `${messageId} may contain a commitment`
          : `${messageId} carries no new promise — extraction skipped`,
      });
      if (payload.model) {
        appendCallLog({
          at: new Date().toISOString(),
          role: "reconcile",
          model: payload.model,
          source: payload.source,
          note: `${messageId} → ${payload.changed.length} transition(s)`,
        });
      }

      const next: AppliedReconciliation = {
        messageIds: [...applied.messageIds, messageId],
        view: payload.view,
        changed: (payload.changed ?? []).map(
          (r: {
            id: string;
            what: string;
            state: string;
            history: { evidence_quote: string; rationale: string }[];
          }) => ({
            id: r.id,
            what: r.what,
            state: r.state,
            quote: r.history.at(-1)?.evidence_quote ?? "",
            rationale: r.history.at(-1)?.rationale ?? "",
          }),
        ),
        newRowIds: (payload.newRows ?? []).map((r: { id: string }) => r.id),
        at: new Date().toISOString(),
      };

      saveApplied(next);
      onApplied(next);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  function reset() {
    clearApplied();
    onApplied({ messageIds: [], view: null, changed: [], newRowIds: [], at: "" });
    setStatus("idle");
    setError(null);
  }

  return (
    <section className="border-l-2 border-accent bg-surface py-3 pl-4 pr-4">
      {pending.length > 0 ? (
        <>
          <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-ink-faint">
            New mail · not yet reconciled
          </p>
          {pending.map((m) => (
            <div key={m.id} className="mt-2">
              <p className="text-sm text-ink">
                <span className="font-medium">{m.fromName}</span>
                <span className="text-ink-faint"> · {fmtDate(m.date_iso)}</span>
              </p>
              <p className="text-sm text-ink-soft">{m.subject}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                <button
                  type="button"
                  onClick={() => run(m.id)}
                  disabled={status === "running"}
                  className="border border-rule-strong px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-ink-faint hover:text-ink disabled:text-ink-faint"
                >
                  {status === "running" ? "Reconciling…" : "Run now"}
                </button>
                {status === "running" ? (
                  <span className="text-xs text-ink-faint">
                    Nano is checking it for promises, then Super decides what it settles…
                  </span>
                ) : (
                  <span className="text-xs text-ink-faint">
                    Reads it against the open rows and updates whatever it settles.
                  </span>
                )}
              </div>
            </div>
          ))}
        </>
      ) : null}

      {error ? (
        <p className="mt-3 border border-rule bg-overdue-bg px-4 py-3 text-sm text-overdue">
          {error}
        </p>
      ) : null}

      {hasApplied ? (
        <div className={pending.length > 0 ? "mt-4 border-t border-rule pt-3" : ""}>
          <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-ink-faint">
            Reconciled in this browser
          </p>
          {applied.changed.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              Nothing in the open rows was settled by it. The ledger is unchanged, which is
              the correct answer when mail carries no news.
            </p>
          ) : (
            <ol className="mt-2 space-y-2.5">
              {applied.changed.map((c) => (
                <li key={c.id}>
                  <p className="text-sm text-ink">
                    <span className="text-ink-soft">{c.what}</span> → {c.state}
                  </p>
                  <p className="receipt mt-1 pl-3 text-xs text-ink-soft">{c.quote}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-faint">{c.rationale}</p>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs">
            <button
              type="button"
              onClick={reset}
              className="text-ink-faint underline underline-offset-2 hover:text-ink"
            >
              Reset to the committed ledger
            </button>
          </p>
        </div>
      ) : null}
    </section>
  );
}
