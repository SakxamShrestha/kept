# Kept — multi-agent execution spec

How the remaining work gets built, by whom, and in what order. `SPEC.md` says
*what* to build; this file says *how the work is divided without the pieces
colliding*. Written 2026-09-30, 30 days before submission closes.

Read with [TASKS.md](./TASKS.md) (the board) and [SPEC.md](./SPEC.md) (the
acceptance criteria each package inherits).

---

## 0. The decision this file makes

The remaining work is small in file count but tightly coupled through three
shared artifacts: the committed ledger `data/ledger/baseline.json`, the existing
client components in `app/components/`, and the response cache in `data/cache/`.
Every package's definition of done is "`npm run build` passes and
`npm run test:ledger` is green" — which means concurrent agents in one working
tree invalidate each other's verification, and a package that rebuilds the ledger
moves the ground under every other package's assertions.

So the division is **not** "one agent per remaining task". It is:

1. A serial gate the main thread does alone, because it changes the artifact
   everything else reads.
2. One parallel wave of packages that are genuinely disjoint — net-new files
   only, no edits to anything another package touches.
3. A second wave the main thread does alone, because it edits three existing
   components at once and parallelising it would buy nothing but merge pain.
4. A serial tail: deploy, verify, submit.

Parallelism is applied where the files are disjoint and the work is substantial.
It is deliberately *not* applied to the API routes, and the reason is stated in
§3 rather than left implicit.

---

## 1. Gate 0 — main thread, alone, before any agent is spawned

Blocking. Nothing else starts until `test:ledger` is green again.

The direction fix in `lib/extract.ts` (`correctDirection()`, uncommitted) is
correct, but `data/ledger/baseline.json` was never rebuilt against it. One row
(`c003`) was hand-patched in the artifact instead. Six rows in the committed
ledger still record the owner's own first-person promises as `owed_to_me`, which
inverts both columns of the product:

| Row | Recorded | Origin | Quote |
|---|---|---|---|
| c000 | `owed_to_me` | `brightpath-silence-0@okaforconsulting.com` | "I'll put together the integration spec…" |
| c002 | `owed_to_me` | `northwind-renegotiation-0@…` | "I'll send you the staffing model draft…" |
| c004 | `owed_to_me` | `vendor-shortlist-1@…` | "I'll get you the full vendor list…" |
| c005 | `owed_to_me` | `mercer-satisfied-0@…` | "I'll confirm the cold chain audit dates…" |
| c007 | `owed_to_me` | `vague-but-real-1@…` | "I'll look into it with our finance team…" |
| c009 | `owed_to_me` | `vendor-shortlist-3@…` | "I will get you those two by Thursday." |

Steps, in order:

1. `npm run build:ledger` — rebuild from the pipeline, never by hand. Confirm all
   six rows come back `owed_by_me` and that no row names the owner as its own
   counterparty.
2. Fix `evals/reconcile.test.mts` — the `marcusRows` filter (~line 56) selects
   vendor-thread rows by counterparty alone. Now that `c003` legitimately has
   Marcus as its counterparty, `remainder` picks the owner's satisfied row
   instead of the open one. Scope the filter to `direction === "owed_to_me"`.
   This is a test bug the correct fix exposed, not a pipeline regression.
3. Add `"test:rot": "tsx scripts/test-rot.mts"` to `package.json`.
   `scripts/test-rot.mts` exists and has no script entry.
4. Green the four gates: `npm run test:ledger`, `npm run test:rot`,
   `npx tsc --noEmit`, `npm run build`.
5. Commit the week of uncommitted work in three commits, in this order, so the
   history reads as reasoning rather than a dump:
   - direction correction in `lib/extract.ts` + rebuilt baseline + the two new
     direction assertions
   - Day 4 ledger and memory UI (`app/page.tsx`, `app/components/`, `app/memory/`)
   - durability: `lib/mbox.ts`, `app/upload/`, `lib/draft.ts`, `scripts/test-rot.mts`

**Why this cannot be delegated or parallelised:** it rewrites the artifact that
every package below reads, and it makes live Token Factory calls that write to the
shared cache. Two writers there is how the committed demo cache gets orphaned.

---

## 2. Wave 1 — four packages in parallel

Each package below is net-new files plus reads of already-frozen interfaces. The
intersection of their owned-file sets is empty. That claim is checkable and was
checked: `app/layout.tsx` already links `/skills` and `/access` (both currently
dead), and `lib/policy.ts` already holds the localStorage schema, the four
default playbooks, the scope defaults and the call log — so no package needs to
edit a shared file to land.

### Rules every Wave 1 agent follows

These exist to prevent the failure this shape actually has, which is not merge
conflicts but four pages that each invented their own version of the same thing.

- **Owned files only.** Create and edit only the paths listed under your package.
  If you believe you need to edit a file outside that list, stop and report it
  instead of editing.
- **Never edit**, under any circumstance: `package.json`, `package-lock.json`,
  `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `lib/**`, `data/**`,
  `docs/TASKS.md`, `evals/**`. The main thread owns all of them.
- **Reuse, do not re-create.** `lib/policy.ts` is the only localStorage layer —
  no second `read`/`write` helper, no second `PolicyRule` type. Reuse
  `app/components/StateChip.tsx` and `app/components/format.ts` rather than
  writing new formatting.
- **Design tokens only.** Colours come from the `@theme` tokens in
  `app/globals.css` (`paper`, `surface`, `ink`, `ink-soft`, `ink-faint`, `rule`,
  `rule-strong`, `overdue`, `settled`, `pending`, `accent`). No new hex values,
  no new font sizes outside the existing scale.
- **No model calls.** Do not call Token Factory. Do not run `npm run build:ledger`
  or `npm run build:corpus`. Do not set `NEBIUS_CACHE_WRITE`. WP-3 is the single
  exception and it calls Tavily, not Nebius.
- **Verify with `npx tsc --noEmit` only.** A peer may be mid-write, so
  `npm run build` in a shared tree proves nothing about your files. The main
  thread runs the authoritative build at the merge point.
- **Next.js 16:** `cookies()`, `headers()`, `params`, `searchParams` are
  async-only. Read `node_modules/next/dist/docs/` before writing App Router code;
  this version postdates the training cutoff.
- Report back: files created, what you verified, anything you wanted to touch and
  did not.

### WP-1 — Skills screen (playbook editor)

- **Owns:** `app/skills/page.tsx`, `app/skills/PlaybookEditor.tsx`
- **Reads:** `lib/policy.ts` (`DEFAULT_PLAYBOOKS`, `Playbook`, `loadPlaybooks`,
  `savePlaybooks`), `app/components/format.ts`, `app/memory/page.tsx` as the
  layout precedent to match
- **Spec:** `SPEC.md` §6. Four editable playbooks — Gentle nudge, Escalate,
  Renegotiate the date, Close it out — each a name, a tone and an instruction.
  Client component, because the store is localStorage. Per-playbook reset to
  default, and a visible note that these are the prompts the draft path actually
  sends, not decoration.
- **Acceptance:** four playbooks render from `DEFAULT_PLAYBOOKS` on a fresh
  browser; an edit survives reload; reset restores the default for one playbook
  without disturbing the others; `npx tsc --noEmit` clean.

### WP-2 — Access screen (scopes + call log)

- **Owns:** `app/access/page.tsx`, `app/access/ScopePanel.tsx`,
  `app/access/CallLog.tsx`
- **Reads:** `lib/policy.ts` (`ScopeState`, `DEFAULT_SCOPES`, `loadScopes`,
  `saveScopes`, `CallLogEntry`, `loadCallLog`)
- **Spec:** `SPEC.md` §8. Toggles for read mail / draft / send / calendar. `send`
  and `calendar` render **disabled with the reason on screen** — they are not
  implemented, and saying so is the point of the screen. Below them, the
  session's model calls: role, model ID, cached or live, token count.
- **Acceptance:** toggling `draft` off persists across reload; `send` and
  `calendar` cannot be enabled and each states why; the call log renders a
  truthful empty state on a fresh session (the writer lands in Wave 2, and the
  screen must not imply calls that did not happen); `npx tsc --noEmit` clean.

### WP-3 — Tavily enrichment at build time

- **Owns:** `scripts/build-enrichment.mts`, `data/enrichment.json`
- **Contract already frozen** by `lib/ledger.ts:59` — do not change the shape:
  `Record<counterpartyEmail, { summary: string; sources: string[] }>`
- **Spec:** `SPEC.md` §7. One Tavily search per counterparty org drawn from
  `meta.people`, stored as a two-line summary plus source URLs. Committed output,
  so it cannot rot between submission and judging. Absent `TAVILY_API_KEY`, skip
  gracefully with a clear log line and write nothing — `loadEnrichment()` already
  tolerates the file being missing, and the draft path already treats enrichment
  as optional.
- **May not** add the `npm` script entry; report the exact line and the main
  thread adds it to `package.json`.
- **Acceptance:** runs to completion with a key and without one; output parses
  against the frozen type; every summary carries at least one source URL; no key
  or secret in the committed JSON.

### WP-4 — README and the feedback submission

- **Owns:** `README.md`, `docs/FINDINGS.md`
- **Spec:** `SPEC.md` §9 and §12.6. README states setup and run, which NVIDIA
  model is used and where, the measured eval table (Super ~95% precision vs Nano
  ~60%; the Nano gate at 100% recall and 55% of Super calls avoided), cost per
  full corpus pass, and **why Ultra is deliberately unused** — argued, not
  apologised for. `FINDINGS.md` becomes the source for the required written
  feedback: five platform findings with repro steps, including the model-ID
  mismatch against published docs, `reasoning_effort` `none`/`high` breaking Nano,
  and `seed` not delivering reproducibility.
- **Constraint:** every number must come from `docs/FINDINGS.md` or a test run.
  No invented benchmarks. If a number is not written down anywhere, say so and
  leave a marked gap rather than estimating.
- **Acceptance:** a reader who has never seen the repo can clone, install and
  reach a rendered ledger with no API key; the Nemotron model IDs in the README
  match `lib/nebius.ts`'s chains; no secrets.

---

## 3. Wave 2 — main thread, alone: the runtime paths

`app/api/draft/route.ts`, `app/api/reconcile/route.ts`, and the client wiring
that reaches them.

**Why no agents here.** Both routes are thin — `lib/draft.ts` already exposes
`prepareDraft()` and `generateDraft()`, and `lib/reconcile.ts` exposes
`reconcileMessage()`. The work is not the routes; it is that the buttons, the
draft composer and the call-log writer all land inside the same two existing
files (`app/components/CommitmentRow.tsx`, `app/components/LedgerBoard.tsx`).
Three agents editing those two files is strictly worse than one thread doing it
in sequence, and the money shot — Marcus's row moving to `partially_satisfied`
and a draft naming the two missing vendors — is the single thing judging turns
on. It gets undivided attention.

Order:

1. `app/api/draft/route.ts` — POST `{ rowId, playbook }`, returns `DraftResult`.
   Surface `quoted: false` in the UI rather than hiding it; an ungrounded draft
   presented as a receipt is the one thing the product must never do.
2. Draft composer in the expanded row: playbook picker, editable subject and
   body, copy button, the enrichment line attributed to its source.
3. `app/api/reconcile/route.ts` — POST `{ messageId }`, the "Run now" path on the
   held-back message.
4. `appendCallLog()` on both routes' client callers, which is what makes WP-2's
   screen show real calls.
5. Full money-shot walkthrough with no `.env.local` present, then with one.

---

## 4. Wave 3 — serial tail

1. Deploy to Vercel, confirm the public URL.
2. Judge flow in a private window, no key, every screen and both routes.
3. `npm run test:rot` green against the deployed commit.
4. Update `docs/TASKS.md` to the real state.
5. Demo video ≤ 3 min, audio naming Token Factory and Nemotron.
6. Devpost: Personal AI track, demo URL, repo URL, testing instructions,
   feedback section from `FINDINGS.md`.

---

## 5. Merge and verification protocol

The main thread is the only writer of shared files and the only committer.

At each merge point, in this order: `npx tsc --noEmit`, `npm run test:ledger`,
`npm run test:rot`, `npm run build`. A wave is not done until all four are green
together in one tree.

Review every agent's output before committing it — specifically for a
re-implemented localStorage helper, a hardcoded model ID, a new colour value, or
a `Date.now()` where `meta.today` belongs. Those four are what this shape of
parallelism actually gets wrong.

Commit per package, not per wave, so a bad package can be reverted alone.

---

## 6. Risks specific to this plan

| Risk | Signal | Response |
|---|---|---|
| Four pages diverge stylistically | Review sees new colours or a second storage helper | Rules in §2; reject and re-issue the package rather than patching it after the fact |
| An agent edits a shared file anyway | `git status` shows a file outside its owned set | Revert that file, keep the rest, re-issue with the boundary restated |
| Ledger rebuild in Gate 0 changes row IDs | `test:ledger` fails on ID-pinned assertions | Assert on structure, not IDs or phrasing — the standing rule in CLAUDE.md |
| Tavily returns nothing useful for a fictional org | Empty or irrelevant summaries | Enrichment is optional by design; commit an empty object and let the draft path skip it rather than inventing copy |
| Wave 2 runs long and the tail gets squeezed | Past Oct 20 with no deployed URL | Deploy at the end of Wave 1 with dead routes, then redeploy. A live URL with fewer features beats a complete repo with no URL |
| Gate 0's rebuild costs unexpected tokens | Build log shows all-live calls | The cache covers the corpus; a full cold rebuild is one corpus pass, priced in `FINDINGS.md` |

---

## 7. What this plan gives up

Per-agent green builds. In a shared tree an agent cannot trust `npm run build`,
so verification is serialised into the main thread at each merge point. Isolated
worktrees would fix that, and they were considered and rejected: each worktree
needs its own `node_modules` and `.env.local`, and — the deciding reason — two
worktrees that both rebuild the ledger or write to `data/cache/` produce
divergent committed artifacts, which is the exact failure Gate 0 exists to clean
up. Four net-new-file packages do not need that much isolation.
