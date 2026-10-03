/**
 * The memory layer. Client-side only.
 *
 * The Personal AI track asks for persistent memory. This is deliberately not a
 * hidden vector store: it is a list of plain-English rules the user can read,
 * edit, and delete, where every rule shows the correction that created it and
 * how many times it has fired since.
 *
 * It lives in localStorage rather than a database for two reasons. It makes
 * "your data stays under your control" literally true rather than a claim, and
 * it means the demo has nothing that can expire between submission and judging.
 */

import type { LedgerView } from "./ledger";

export const POLICY_KEY = "kept.policy.v1";
export const PLAYBOOK_KEY = "kept.playbooks.v1";
export const SCOPES_KEY = "kept.scopes.v1";
export const CALLLOG_KEY = "kept.calllog.v1";

export type PolicyAction = "rejected" | "edited" | "confirmed";

export interface PolicyRule {
  id: string;
  /** Plain English, shown verbatim in the UI and editable by the user. */
  rule: string;
  /** Provenance. A rule with no visible cause is indistinguishable from one the
   *  system invented, which is the thing that makes learned behavior feel
   *  untrustworthy. */
  created_from: {
    action: PolicyAction;
    row_id: string;
    row_what: string;
    counterparty: string;
    at: string;
  };
  fire_count: number;
  enabled: boolean;
}

export interface Playbook {
  id: string;
  name: string;
  tone: string;
  instruction: string;
  builtin: boolean;
}

export interface ScopeState {
  read: boolean;
  draft: boolean;
  /** Present but permanently false. There is no send path and no OAuth in this
   *  project, so offering a toggle that appears to enable one would be a lie. */
  send: false;
  calendar: false;
}

export interface CallLogEntry {
  at: string;
  role: string;
  model: string;
  source: "live" | "cache";
  tokens?: number;
  note?: string;
}

export const DEFAULT_PLAYBOOKS: Playbook[] = [
  {
    id: "gentle",
    name: "Gentle nudge",
    tone: "warm, brief, assumes good faith",
    instruction:
      "Remind them of the commitment without implying blame. Reference what they said and when, offer to help unblock it, and make it easy to reply with a short answer.",
    builtin: true,
  },
  {
    id: "escalate",
    name: "Escalate",
    tone: "direct, professional, names the cost",
    instruction:
      "State the commitment, how overdue it is, and the concrete consequence of further delay. Ask for a firm date. Stay civil but do not soften the facts.",
    builtin: true,
  },
  {
    id: "renegotiate",
    name: "Renegotiate the date",
    tone: "collaborative, pragmatic",
    instruction:
      "Acknowledge the original date has passed, propose a specific new one, and ask them to confirm or counter. Aim for one good delivery rather than repeated slippage.",
    builtin: true,
  },
  {
    id: "close",
    name: "Close it out",
    tone: "brief, final, no hard feelings",
    instruction:
      "Note that this appears to be no longer needed and say you are closing it out. Invite them to say otherwise if that is wrong.",
    builtin: true,
  },
];

export const DEFAULT_SCOPES: ScopeState = {
  read: true,
  draft: true,
  send: false,
  calendar: false,
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("kept:storage", { detail: { key } }));
  } catch {
    // Private browsing or a full quota. Losing a preference is acceptable;
    // throwing in the middle of a demo is not.
  }
}

export const loadRules = () => read<PolicyRule[]>(POLICY_KEY, []);
export const saveRules = (rules: PolicyRule[]) => write(POLICY_KEY, rules);

export const loadPlaybooks = () => read<Playbook[]>(PLAYBOOK_KEY, DEFAULT_PLAYBOOKS);
export const savePlaybooks = (p: Playbook[]) => write(PLAYBOOK_KEY, p);

export const loadScopes = () => read<ScopeState>(SCOPES_KEY, DEFAULT_SCOPES);
export const saveScopes = (s: ScopeState) => write(SCOPES_KEY, s);

export const loadCallLog = () => read<CallLogEntry[]>(CALLLOG_KEY, []);
export function appendCallLog(entry: CallLogEntry): void {
  const log = loadCallLog();
  write(CALLLOG_KEY, [entry, ...log].slice(0, 200));
}

/**
 * Mail this viewer has reconciled with "Run now", and the ledger that resulted.
 *
 * The committed baseline stays the shared starting point and is never written -
 * it cannot be, on a read-only serverless filesystem, and it is the artifact the
 * acceptance tests are pinned to. So an applied reconciliation lives here, per
 * viewer, which also means one judge cannot spend the demo for the next one.
 *
 * The whole recomputed view is stored rather than a list of transitions, because
 * bucketing a row needs the frozen demo clock and the overdue arithmetic that
 * lib/ledger.ts does on the server. Keeping the server's answer verbatim is what
 * stops the client's idea of the ledger drifting from the rendered page's.
 */
export const APPLIED_KEY = "kept.applied.v1";

export interface AppliedReconciliation {
  messageIds: string[];
  /** lib/ledger's LedgerView. Imported as a type only - lib/ledger reads the
   *  filesystem, so its runtime cannot cross into a client component. */
  view: LedgerView | null;
  /** What to tell the viewer happened, kept so the summary survives a reload. */
  changed: { id: string; what: string; state: string; quote: string; rationale: string }[];
  newRowIds: string[];
  at: string;
}

const EMPTY_APPLIED: AppliedReconciliation = {
  messageIds: [],
  view: null,
  changed: [],
  newRowIds: [],
  at: "",
};

export const loadApplied = () => read<AppliedReconciliation>(APPLIED_KEY, EMPTY_APPLIED);
export const saveApplied = (a: AppliedReconciliation) => write(APPLIED_KEY, a);
export const clearApplied = () => write(APPLIED_KEY, EMPTY_APPLIED);

/**
 * The demo token, if the viewer has one.
 *
 * Not a credential and not a login - nothing here is authenticated. It is the
 * single capability the deployment withholds from the open internet: permission
 * to make a model call that is not already in the shipped cache, and therefore
 * costs money. Nebius offers no way to cap that from their side, so it is capped
 * here. Reviewers get the token with the submission; everything the demo walks
 * through is cached and needs nothing.
 */
export const DEMO_TOKEN_KEY = "kept.demotoken.v1";
export const loadDemoToken = () => read<string>(DEMO_TOKEN_KEY, "");
export const saveDemoToken = (token: string) => write(DEMO_TOKEN_KEY, token.trim());

/** Headers for a request that might need to spend. Omits the token when there
 *  is none, so an unguarded deployment behaves exactly as before. */
export function demoHeaders(): Record<string, string> {
  const token = loadDemoToken();
  return token ? { "x-kept-demo": token } : {};
}

/** Rows the user has dismissed. Kept separately from the rules so a dismissal
 *  survives even if its generated rule is later edited or deleted. */
export const DISMISSED_KEY = "kept.dismissed.v1";
export const loadDismissed = () => read<string[]>(DISMISSED_KEY, []);
export function dismissRow(rowId: string): void {
  const d = loadDismissed();
  if (!d.includes(rowId)) write(DISMISSED_KEY, [...d, rowId]);
}
export function restoreRow(rowId: string): void {
  write(DISMISSED_KEY, loadDismissed().filter((id) => id !== rowId));
}

/**
 * Turn a correction into a rule.
 *
 * Phrased from what the user actually did, not from a model's guess at intent,
 * so the rule text and its stated cause can never disagree.
 */
export function ruleFromRejection(row: {
  id: string;
  what: string;
  counterparty: string;
  counterpartyName: string;
  confidence: number;
}): PolicyRule {
  const vague = row.confidence < 0.8;
  return {
    id: `r-${row.id}-${Date.now().toString(36)}`,
    rule: vague
      ? `Don't track low-confidence promises from ${row.counterpartyName} like "${row.what}".`
      : `Don't track "${row.what}" from ${row.counterpartyName} as a commitment.`,
    created_from: {
      action: "rejected",
      row_id: row.id,
      row_what: row.what,
      counterparty: row.counterparty,
      at: new Date().toISOString(),
    },
    fire_count: 0,
    enabled: true,
  };
}

export function addRule(rule: PolicyRule): PolicyRule[] {
  const next = [rule, ...loadRules()];
  saveRules(next);
  return next;
}

/** Count a rule as having fired. Shown in the UI so a rule that never matches
 *  anything is visibly dead weight the user can delete. */
export function bumpFireCount(ruleId: string): void {
  saveRules(
    loadRules().map((r) => (r.id === ruleId ? { ...r, fire_count: r.fire_count + 1 } : r)),
  );
}

export function exportMemory(): string {
  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      rules: loadRules(),
      playbooks: loadPlaybooks(),
      scopes: loadScopes(),
      dismissed: loadDismissed(),
    },
    null,
    2,
  );
}
