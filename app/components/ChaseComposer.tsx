"use client";

import { useEffect, useState } from "react";
import type { DisplayRow } from "@/lib/ledger";
import {
  appendCallLog,
  DEFAULT_PLAYBOOKS,
  demoHeaders,
  loadPlaybooks,
  type Playbook,
} from "@/lib/policy";

/**
 * Draft a chase for one row.
 *
 * This is the only place in the app that calls a model at request time. The
 * ledger itself is a committed artifact and renders with no API key, which is
 * deliberate - but a chase is written for a specific person on a specific day
 * against a playbook the viewer can edit, so there is nothing to precompute.
 *
 * Nothing sends. There is no send path in this project, so the draft is editable
 * and copyable and that is the end of it.
 */

type Status = "idle" | "drafting" | "done" | "error";

interface DraftResponse {
  subject: string;
  body: string;
  model: string;
  source: "live" | "cache";
  tokens: number;
  quoted: boolean;
  playbook: string;
  sources: string[];
}

const shortModel = (id: string) =>
  /nano/i.test(id) ? "Nemotron Nano 30B" : /super/i.test(id) ? "Nemotron Super 120B" : id;

export function ChaseComposer({ row }: { row: DisplayRow }) {
  // Starts from the builtins so the server render and the first client render
  // agree; the viewer's edited playbooks arrive after mount. Without this the
  // picker would hydrate with different options than it rendered with.
  const [playbooks, setPlaybooks] = useState<Playbook[]>(DEFAULT_PLAYBOOKS);
  const [playbookId, setPlaybookId] = useState(DEFAULT_PLAYBOOKS[0].id);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftResponse | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sync = () => setPlaybooks(loadPlaybooks());
    sync();
    const onStore = () => sync();
    window.addEventListener("kept:storage", onStore);
    window.addEventListener("storage", onStore);
    return () => {
      window.removeEventListener("kept:storage", onStore);
      window.removeEventListener("storage", onStore);
    };
  }, []);

  const playbook = playbooks.find((p) => p.id === playbookId) ?? playbooks[0];

  async function draft() {
    setStatus("drafting");
    setError(null);
    setCopied(false);

    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "content-type": "application/json", ...demoHeaders() },
        body: JSON.stringify({ rowId: row.id, playbook }),
      });
      const payload = await res.json();

      if (!res.ok) {
        setError(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status}).`);
        setStatus("error");
        return;
      }

      const data = payload as DraftResponse;
      setResult(data);
      setSubject(data.subject);
      setBody(data.body);

      // What makes the Access screen's claim checkable rather than asserted:
      // every model call this session leaves a record the viewer can read.
      appendCallLog({
        at: new Date().toISOString(),
        role: "draft",
        model: data.model,
        source: data.source,
        tokens: data.tokens,
        note: `chase for ${row.id} · ${data.playbook}`,
      });

      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("Could not reach the clipboard. Select the text and copy it manually.");
    }
  }

  return (
    <div className="mt-5 border-t border-rule pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[0.6875rem] uppercase tracking-[0.14em] text-ink-faint">Chase</span>

        <label className="sr-only" htmlFor={`playbook-${row.id}`}>
          Playbook
        </label>
        <select
          id={`playbook-${row.id}`}
          value={playbookId}
          onChange={(e) => setPlaybookId(e.target.value)}
          disabled={status === "drafting"}
          className="border border-rule-strong bg-surface px-2 py-1 text-xs text-ink-soft"
        >
          {playbooks.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={draft}
          disabled={status === "drafting"}
          className="border border-rule-strong px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-ink-faint hover:text-ink disabled:text-ink-faint"
        >
          {status === "drafting" ? "Writing…" : result ? "Draft again" : "Draft a chase"}
        </button>

        {status === "drafting" ? (
          <span className="text-xs text-ink-faint">
            Nemotron Super is reading the thread and the track record…
          </span>
        ) : null}
      </div>

      {status === "idle" && !result ? (
        <p className="mt-2 max-w-prose text-xs leading-relaxed text-ink-faint">
          Written against this row&apos;s evidence and {row.counterpartyName}&apos;s delivery
          history. Nothing is sent — the draft is yours to edit and copy.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 border border-rule bg-overdue-bg px-4 py-3 text-sm text-overdue">{error}</p>
      ) : null}

      {result ? (
        <div className="mt-3 border border-rule bg-surface">
          <div className="border-b border-rule px-4 py-2">
            <label className="sr-only" htmlFor={`subject-${row.id}`}>
              Subject
            </label>
            <input
              id={`subject-${row.id}`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-transparent text-sm text-ink outline-none"
            />
          </div>

          <label className="sr-only" htmlFor={`body-${row.id}`}>
            Draft body
          </label>
          <textarea
            id={`body-${row.id}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.min(18, body.split("\n").length + 2)}
            className="w-full resize-y bg-transparent px-4 py-3 text-sm leading-relaxed text-ink outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rule px-4 py-2">
            <p className="text-xs text-ink-faint tabular">
              {/* Reported, never hidden. A chase that does not carry the promise
                  and its date is not a receipt, and saying so is the whole
                  difference between this and a generated nag. */}
              {result.quoted ? (
                <span className="text-settled">Carries the receipt</span>
              ) : (
                <span className="text-overdue">
                  Does not quote the promise — check it before you send
                </span>
              )}
              {" · "}
              {shortModel(result.model)} · {result.source} · {result.tokens.toLocaleString()} tokens
            </p>
            <button
              type="button"
              onClick={copy}
              className="border border-rule-strong px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {result.sources.length ? (
            <p className="border-t border-rule px-4 py-2 text-xs text-ink-faint">
              Background from{" "}
              {result.sources.map((s, i) => (
                <span key={s}>
                  {i > 0 ? ", " : ""}
                  <a
                    href={s}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline underline-offset-2"
                  >
                    {new URL(s).hostname}
                  </a>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
