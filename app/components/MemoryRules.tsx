"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  exportMemory,
  loadRules,
  saveRules,
  type PolicyRule,
} from "@/lib/policy";
import { fmtWhen, plural } from "./format";

const VERB: Record<PolicyRule["created_from"]["action"], string> = {
  rejected: "rejected",
  edited: "edited",
  confirmed: "confirmed",
};

/**
 * The memory the track asks for, written out in full.
 *
 * Every rule here was caused by something the viewer did, and the cause is
 * printed under the rule rather than stored out of sight. A rule whose origin
 * cannot be read is indistinguishable from one the system invented, and that is
 * exactly what makes learned behaviour feel untrustworthy.
 */
export function MemoryRules({ names }: { names: Record<string, string> }) {
  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      setRules(loadRules());
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

  const commit = useCallback((next: PolicyRule[]) => {
    setRules(next);
    saveRules(next);
  }, []);

  const edit = (id: string, text: string) =>
    commit(rules.map((r) => (r.id === id ? { ...r, rule: text } : r)));

  const toggle = (id: string) =>
    commit(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));

  const remove = (id: string) => commit(rules.filter((r) => r.id !== id));

  const handleExport = () => {
    const blob = new Blob([exportMemory()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kept-memory-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <h2 className="flex items-baseline justify-between gap-4 border-b border-rule-strong pb-2 text-sm font-semibold tracking-tight text-ink">
        <span>
          Rules you taught it
          <span className="ml-2 tabular text-xs font-normal text-ink-faint">
            {ready ? rules.length : 0}
          </span>
        </span>
        <button
          type="button"
          onClick={handleExport}
          className="text-xs font-normal text-accent underline underline-offset-2"
        >
          Export my data
        </button>
      </h2>

      {!ready ? (
        <p className="py-4 text-sm text-ink-faint">Reading rules from this browser…</p>
      ) : rules.length === 0 ? (
        <div className="mt-4 border border-dashed border-rule px-4 py-5">
          <p className="text-sm text-ink">Nothing learned yet, because nothing has
            been corrected.</p>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">
            Rules are written by correcting the ledger, never in the background. Open a
            row on the{" "}
            <Link href="/" className="text-accent underline underline-offset-2">
              Ledger
            </Link>
            , read the sentence it was taken from, and choose{" "}
            <span className="text-ink">Not a commitment</span>. Kept drops the row,
            writes the correction as one plain English sentence, and records which row
            caused it. Whatever appears here you can edit, switch off, or delete.
          </p>
        </div>
      ) : (
        <ul>
          {rules.map((rule) => {
            const from = rule.created_from;
            const who = names[from.counterparty] ?? from.counterparty;
            return (
              <li key={rule.id} className="border-b border-rule py-4 last:border-b-0">
                <label className="sr-only" htmlFor={`rule-${rule.id}`}>
                  Rule text
                </label>
                <textarea
                  id={`rule-${rule.id}`}
                  value={rule.rule}
                  rows={2}
                  onChange={(e) => edit(rule.id, e.target.value)}
                  className={`w-full resize-none bg-transparent text-sm leading-snug outline-none focus:bg-surface ${
                    rule.enabled ? "text-ink" : "text-ink-faint line-through"
                  }`}
                />

                <p className="mt-1 max-w-prose text-xs leading-relaxed text-ink-faint">
                  Created when you {VERB[from.action]} the row{" "}
                  <span className="text-ink-soft">{from.row_what}</span> from {who} on{" "}
                  <span className="tabular">{fmtWhen(from.at)}</span>.
                </p>
                <p className="mt-0.5 font-mono text-[0.6875rem] text-ink-faint">
                  {from.row_id}
                </p>

                <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                  <span className="tabular text-ink-faint">
                    {rule.fire_count === 0
                      ? "has not fired yet"
                      : `fired ${rule.fire_count} ${plural(rule.fire_count, "time", "times")}`}
                  </span>
                  <label className="flex items-center gap-1.5 text-ink-soft">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => toggle(rule.id)}
                      className="accent-accent"
                    />
                    Active
                  </label>
                  <button
                    type="button"
                    onClick={() => remove(rule.id)}
                    className="text-ink-faint underline underline-offset-2 hover:text-ink"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 max-w-prose text-xs leading-relaxed text-ink-faint">
        These rules live in this browser only. Export writes them to a JSON file you
        keep, along with your playbooks, scopes, and dismissed rows. Nothing is uploaded.
      </p>
    </section>
  );
}
