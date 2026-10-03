"use client";

import { useEffect, useState } from "react";
import { Ban, Check } from "lucide-react";
import {
  DEFAULT_SCOPES,
  loadCallLog,
  loadDemoToken,
  loadScopes,
  saveDemoToken,
  saveScopes,
  type CallLogEntry,
  type ScopeState,
} from "@/lib/policy";
import { fmtWhen } from "@/app/components/format";

/**
 * What this can reach, and what it has done with it.
 *
 * The track asks that the user decides what the assistant can touch. Two of the
 * four scopes here are switched off and cannot be switched on, because they are
 * genuinely not built - there is no send path and no calendar code anywhere in
 * the project. Offering a toggle that silently does nothing would be worse than
 * showing a locked one and saying why.
 *
 * Below the scopes is every model call this browser has made. It is the cheapest
 * honest answer to "what is this thing doing with my mail", and unlike the
 * scopes it cannot be staged - the log only has entries because calls happened.
 */

interface Scope {
  key: keyof ScopeState;
  name: string;
  granted: string;
  locked?: string;
}

const SCOPES: Scope[] = [
  {
    key: "read",
    name: "Read your mail",
    granted:
      "Reads the seeded mailbox committed to the repo, and any .mbox you open yourself — that one is parsed in this browser and never uploaded.",
  },
  {
    key: "draft",
    name: "Draft a chase",
    granted:
      "Writes a reply you can edit and copy. Every draft is logged below with the model that wrote it.",
  },
  {
    key: "send",
    name: "Send mail",
    granted: "",
    locked:
      "Not built. There is no SMTP, no Gmail API and no send path in the codebase, so this cannot be turned on. A chase leaves here as text you copy.",
  },
  {
    key: "calendar",
    name: "Write to your calendar",
    granted: "",
    locked:
      "Not built. Deadlines are read out of the mail and shown on the ledger; nothing is ever written back to a calendar.",
  },
];

const ROLE_NAME: Record<string, string> = {
  gate: "Checked for a promise",
  extract: "Pulled out commitments",
  reconcile: "Reconciled new mail",
  draft: "Wrote a chase",
};

const shortModel = (id: string) =>
  /nano/i.test(id) ? "Nemotron Nano 30B" : /super/i.test(id) ? "Nemotron Super 120B" : id || "—";

export function AccessPanel() {
  const [scopes, setScopes] = useState<ScopeState>(DEFAULT_SCOPES);
  const [log, setLog] = useState<CallLogEntry[]>([]);
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      setScopes(loadScopes());
      setLog(loadCallLog());
      setToken(loadDemoToken());
      setReady(true);
    };
    sync();
    window.addEventListener("kept:storage", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("kept:storage", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function toggle(key: keyof ScopeState) {
    const next = { ...scopes, [key]: !scopes[key] };
    setScopes(next);
    saveScopes(next);
  }

  return (
    <>
      <ul className="border-t border-rule-strong">
        {SCOPES.map((s) => {
          const locked = !!s.locked;
          const on = !locked && scopes[s.key];
          return (
            <li key={s.key} className="border-b border-rule py-5">
              <div className="ledger-row">
                <div className="min-w-0">
                  <h3
                    className={`text-[0.9375rem] font-medium ${
                      locked ? "text-ink-faint" : "text-ink"
                    }`}
                  >
                    {s.name}
                  </h3>
                  <p className="mt-1 max-w-[58ch] text-[0.8125rem] leading-relaxed text-ink-faint">
                    {locked ? s.locked : s.granted}
                  </p>
                </div>

                {locked ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-[0.75rem] text-ink-faint">
                    <Ban size={12} strokeWidth={1.8} aria-hidden="true" />
                    Unavailable
                  </span>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => toggle(s.key)}
                    disabled={!ready}
                    className={`flex shrink-0 items-center gap-1.5 border px-2.5 py-1 text-[0.75rem] transition-colors ${
                      on
                        ? "border-settled text-settled"
                        : "border-rule-strong text-ink-faint hover:border-ink-faint hover:text-ink-soft"
                    }`}
                  >
                    {on ? <Check size={12} strokeWidth={2.2} aria-hidden="true" /> : null}
                    {on ? "Allowed" : "Off"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <section className="mt-12">
        <h2 className="text-[1.0625rem] font-semibold tracking-tight">
          Live model calls
        </h2>
        <p className="mt-2 max-w-[58ch] text-[0.8125rem] leading-relaxed text-ink-faint">
          Every path this demo walks through is already answered from a response cache
          committed to the repo, so it costs nothing and works for everyone. A request
          that is not in that cache — an edited playbook, say — has to go to Token Factory,
          and that spends real credits. Token Factory offers no way to cap that: a budget
          there alerts but, in their words, does not stop or cap usage. So the one
          capability held back from the open internet is permission to spend. Paste the
          token from the submission&apos;s testing instructions and live calls work from
          this browser.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <label htmlFor="demo-token" className="sr-only">
            Demo token
          </label>
          <input
            id="demo-token"
            type="text"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              saveDemoToken(e.target.value);
            }}
            placeholder="Demo token"
            autoComplete="off"
            spellCheck={false}
            className="w-56 border-b border-rule bg-transparent pb-1 font-mono text-[0.8125rem] text-ink outline-none focus:border-accent"
          />
          <span className="text-[0.75rem] text-ink-faint">
            {token.trim()
              ? "Stored in this browser. Live calls allowed."
              : "Empty — cached answers only."}
          </span>
        </div>
      </section>

      <section className="mt-12">
        <div className="ledger-row">
          <h2 className="text-[1.0625rem] font-semibold tracking-tight">
            Every model call this browser has made
          </h2>
          <p className="shrink-0 text-[0.8125rem] text-ink-faint tabular">
            {ready ? log.length : "—"}
          </p>
        </div>

        {!ready ? (
          <p className="mt-4 py-4 text-sm text-ink-faint">Reading the log from this browser…</p>
        ) : log.length === 0 ? (
          <div className="mt-4 border border-dashed border-rule px-5 py-6">
            <p className="max-w-[58ch] text-sm leading-relaxed text-ink-soft">
              Nothing yet. The ledger itself makes no calls — it is a file. Reconcile the
              new message at the top of the ledger, or draft a chase from any row, and
              each call will appear here with the model that answered and whether it came
              from the shipped cache or over the wire.
            </p>
          </div>
        ) : (
          <ul className="mt-4 border-t border-rule-strong">
            {log.map((e, i) => (
              <li key={`${e.at}-${i}`} className="border-b border-rule py-3.5">
                <div className="ledger-row">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      {ROLE_NAME[e.role] ?? e.role}
                      <span className="text-ink-faint"> — {shortModel(e.model)}</span>
                    </p>
                    {e.note ? (
                      <p className="mt-0.5 truncate text-[0.75rem] text-ink-faint">{e.note}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[0.75rem] text-ink-faint tabular">{fmtWhen(e.at)}</p>
                    <p className="text-[0.75rem] tabular">
                      <span className={e.source === "live" ? "text-accent" : "text-ink-faint"}>
                        {e.source === "live" ? "over the wire" : "from cache"}
                      </span>
                      {e.tokens ? (
                        <span className="text-ink-faint"> · {e.tokens.toLocaleString()} tokens</span>
                      ) : null}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
