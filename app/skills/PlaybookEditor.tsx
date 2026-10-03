"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  DEFAULT_PLAYBOOKS,
  loadPlaybooks,
  savePlaybooks,
  type Playbook,
} from "@/lib/policy";

/**
 * The four playbooks, editable.
 *
 * These are not settings. The text in each field is sent to the model verbatim
 * when a chase is drafted, so editing one changes what the next draft actually
 * says - and that is the point of showing them rather than burying them. A
 * reusable skill you cannot read is indistinguishable from a hardcoded prompt.
 */

export function PlaybookEditor() {
  // Seeded with the shipped playbooks rather than with nothing, so they are in
  // the HTML and readable before any script runs. A viewer who has edited one
  // sees the default for an instant and then their own text; holding the page
  // back until localStorage answers would mean the page's whole subject - the
  // text that actually gets sent - is absent from the document.
  const [books, setBooks] = useState<Playbook[]>(DEFAULT_PLAYBOOKS);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setBooks(loadPlaybooks());
    sync();
    window.addEventListener("kept:storage", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("kept:storage", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function update(id: string, patch: Partial<Playbook>) {
    const next = books.map((b) => (b.id === id ? { ...b, ...patch } : b));
    setBooks(next);
    savePlaybooks(next);
    setSavedId(id);
  }

  function reset(id: string) {
    const original = DEFAULT_PLAYBOOKS.find((b) => b.id === id);
    if (!original) return;
    const next = books.map((b) => (b.id === id ? { ...original } : b));
    setBooks(next);
    savePlaybooks(next);
    setSavedId(null);
  }

  const edited = (b: Playbook) => {
    const original = DEFAULT_PLAYBOOKS.find((d) => d.id === b.id);
    return !!original && (original.tone !== b.tone || original.instruction !== b.instruction);
  };

  return (
    <ul className="border-t border-rule-strong">
      {books.map((b) => (
        <li key={b.id} className="border-b border-rule py-6">
          <div className="ledger-row">
            <div className="min-w-0">
              <h2 className="text-[0.9375rem] font-semibold text-ink">{b.name}</h2>
              <p className="mt-0.5 text-[0.8125rem] text-ink-faint">
                {edited(b) ? "Edited in this browser" : "As shipped"}
              </p>
            </div>
            {edited(b) ? (
              <button
                type="button"
                onClick={() => reset(b.id)}
                className="flex shrink-0 items-center gap-1.5 text-[0.8125rem] text-ink-faint underline underline-offset-2 hover:text-ink"
              >
                <RotateCcw size={12} strokeWidth={1.8} aria-hidden="true" />
                Restore the original
              </button>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
            <label
              htmlFor={`tone-${b.id}`}
              className="text-[0.8125rem] leading-6 text-ink-faint"
            >
              Tone
            </label>
            <input
              id={`tone-${b.id}`}
              value={b.tone}
              onChange={(e) => update(b.id, { tone: e.target.value })}
              className="w-full border-b border-rule bg-transparent pb-1 text-sm leading-6 text-ink outline-none focus:border-accent"
            />

            <label
              htmlFor={`instruction-${b.id}`}
              className="text-[0.8125rem] leading-6 text-ink-faint"
            >
              What to write
            </label>
            <textarea
              id={`instruction-${b.id}`}
              value={b.instruction}
              onChange={(e) => update(b.id, { instruction: e.target.value })}
              rows={4}
              className="w-full resize-y border-b border-rule bg-transparent pb-1 text-sm leading-relaxed text-ink outline-none focus:border-accent"
            />
          </div>

          {savedId === b.id ? (
            <p className="mt-3 text-[0.75rem] text-settled">
              Saved. The next chase drafted with {b.name} uses this.
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
