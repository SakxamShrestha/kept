"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

/**
 * Search the ledger.
 *
 * A ledger is a thing you interrogate - "what does Marcus owe me", "what is
 * late", "where did I promise a process map" - and until now the only way to
 * answer that was to read all of it. So this searches commitments rather than
 * pages: counterparty, what was promised, state, and the verbatim quote.
 *
 * Opening a result scrolls to the row and expands its receipt, because the
 * answer to every one of those questions is the receipt.
 */

export interface SearchRow {
  id: string;
  what: string;
  counterparty: string;
  org: string;
  state: string;
  stateLabel: string;
  direction: "owed_by_me" | "owed_to_me";
  due: string;
  overdue: boolean;
  quote: string;
}

const isMac = () =>
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

function score(row: SearchRow, q: string): number {
  const needle = q.toLowerCase();
  const name = row.counterparty.toLowerCase();
  const what = row.what.toLowerCase();

  // Ranked by where the match landed, not by how many times it occurred. A name
  // match is almost always what someone meant.
  if (name.startsWith(needle)) return 100;
  if (name.includes(needle)) return 80;
  if (what.startsWith(needle)) return 60;
  if (what.includes(needle)) return 50;
  if (row.stateLabel.includes(needle)) return 40;
  if (row.org.toLowerCase().includes(needle)) return 30;
  if (row.quote.toLowerCase().includes(needle)) return 20;
  if (needle === "late" || needle === "overdue") return row.overdue ? 70 : 0;
  return 0;
}

export function CommandSearch({ index }: { index: SearchRow[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mac, setMac] = useState(false);

  useEffect(() => setMac(isMac()), []);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return index.filter((r) => r.overdue).slice(0, 6);
    return index
      .map((r) => ({ r, s: score(r, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.r);
  }, [index, query]);

  const jump = useCallback((id: string) => {
    setOpen(false);
    setQuery("");
    // The receipt is a <details>, so there is a real element to open rather than
    // a piece of React state to set.
    const el = document.getElementById(`row-${id}`);
    if (!el) {
      window.location.href = `/#row-${id}`;
      return;
    }
    if (el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    (el.querySelector("summary") as HTMLElement | null)?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, results.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      }
      if (e.key === "Enter" && results[cursor]) {
        e.preventDefault();
        jump(results[cursor].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, cursor, jump]);

  useEffect(() => {
    setCursor(0);
    if (open) inputRef.current?.focus();
  }, [open, query]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 border border-rule-strong px-2.5 py-1 text-[0.8125rem] text-ink-faint transition-colors hover:border-ink-faint hover:text-ink-soft"
      >
        <Search size={13} strokeWidth={1.8} aria-hidden="true" />
        Search commitments
        <kbd className="border border-rule px-1 text-[0.6875rem] text-ink-faint">
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-4 pt-[12vh]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-xl border border-rule-strong bg-surface shadow-lg"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Search commitments"
          >
            <div className="flex items-center gap-2.5 border-b border-rule px-4 py-3">
              <Search size={15} strokeWidth={1.8} className="text-ink-faint" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="A name, a promise, or “late”"
                aria-label="Search commitments"
                className="w-full bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-ink-faint"
              />
            </div>

            {results.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-faint">
                Nothing matches {`“${query}”`}. Try a counterparty, a word from the promise,
                or “late”.
              </p>
            ) : (
              <>
                {!query.trim() ? (
                  <p className="px-4 pt-3 text-[0.75rem] text-ink-faint">
                    {results.length > 0 ? "Overdue right now" : ""}
                  </p>
                ) : null}
                <ul className="max-h-[22rem] overflow-y-auto py-1.5">
                  {results.map((r, i) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => jump(r.id)}
                        className={`ledger-row w-full px-4 py-2 text-left ${
                          i === cursor ? "bg-select" : ""
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink">{r.what}</span>
                          <span className="block truncate text-[0.75rem] text-ink-faint">
                            {r.direction === "owed_by_me"
                              ? `you owe ${r.counterparty}`
                              : `${r.counterparty} owes you`}
                            {r.org ? ` at ${r.org}` : ""}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 text-[0.75rem] tabular ${
                            r.overdue ? "text-overdue" : "text-ink-faint"
                          }`}
                        >
                          {r.overdue ? "late" : r.due || r.stateLabel}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="border-t border-rule px-4 py-2 text-[0.75rem] text-ink-faint">
              Enter opens the receipt. Esc closes.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
