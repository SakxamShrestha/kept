# Kept — implementation spec

Covers Days 3–6. Days 0–2 are built and pushed. This is the document to argue
with before code gets written; once it is locked, development proceeds against
the acceptance criteria at the end of each section.

**Invariants that override anything below.** If a decision here conflicts with
one of these, these win:

1. Every ledger row carries a verbatim evidence quote from a real message. A row
   without a receipt is a guess, and the product's premise is that the ledger can
   be trusted without re-reading the thread.
2. No database, no OAuth, no live mail on the demo path. Judging is Dec 1–15,
   twelve weeks after submission closes.
3. Never pass the whole ledger to a model. Retrieve candidates. All Nemotrons
   misread exact facts past ~100k tokens.
4. Model IDs come from env fallback chains, never literals.
5. Nothing invents a date. `resolveDue()` returns null rather than guessing.

---

## 1. The reconciliation state machine (Day 3)

The thing that makes this a ledger instead of a list.

### States

| State | Meaning | Terminal |
|---|---|---|
| `open` | Promised, not yet delivered | no |
| `partially_satisfied` | Some of it delivered, remainder still owed | no |
| `renegotiated` | Both sides agreed a new deadline | no |
| `satisfied` | Delivered | yes |
| `superseded` | Cancelled or replaced before delivery | yes |
| `abandoned` | Explicitly dropped, or dead past a threshold | yes |

`superseded` vs `satisfied` is the distinction that earns the model split — Nano
conflated them in the Day 1 eval, Super did not.

**`abandoned` is never inferred from silence alone.** Tomas going quiet for six
weeks leaves the row `open` and overdue. Silence is the thing the user needs to
see, not a state the system resolves on their behalf.

### Transition call

Input per new message, in chronological order:

- the message (sender, date, body)
- **candidate rows only**: every open row on the same `thread_id`, plus the top-k
  (k=6) open rows by cosine similarity between the message text and the row's
  `what` + `counterparty`. Hard cap 8 rows.
- for each candidate: id, direction, counterparty, what, due_text, due_iso,
  current state, and its originating evidence quote

Output, strict `json_schema`:

```
{ transitions: [{
    commitment_id, new_state,
    evidence_quote,        // verbatim from THIS message, grounded in code
    rationale,             // one sentence, shown in the UI
    new_due_text           // only for renegotiated; "" otherwise
  }],
  new_commitments: []      // promises this message makes that no row covers
}
```

Model: Super, `reasoning_effort: "high"`. Same quote-grounding and `cleanDue()`
guards as extraction — a transition whose quote is not in the message is dropped,
and `new_due_text` runs through `resolveDue()`.

History is append-only: every transition pushes `{state, at, evidence_message_id,
evidence_quote, rationale}` onto the row. Nothing is overwritten, so the UI can
always show how a row got where it is.

### Acceptance (runs against the committed demo corpus)

| Thread | Required outcome |
|---|---|
| `vendor-shortlist` | Marcus's row → `partially_satisfied` on the Sept 22 message, rationale naming Delacroix and Halvorsen; a *new* row for the two missing vendors due Thursday |
| `northwind-renegotiation` | Dana's row → `renegotiated`, new due resolving to Sept 29. **Not** `abandoned` |
| `ridgeline-superseded` | Ana's diligence-summary row → `superseded`. **Not** `satisfied`. New row for the comparables table |
| `mercer-satisfied` | Kwame's row → `satisfied` |
| `brightpath-silence` | Tomas's row stays `open`, overdue. **Not** `abandoned` |
| `owed-by-me-overdue` | Sam's process-map row stays `open`, overdue 11 days |
| `noise-conditionals` | Zero transitions, zero new rows |

These are a test file (`evals/reconcile.test.mts`), not a manual check.

---

## 2. The cascade (Day 3)

Day 1 measured Super at ~95% precision and Nano at ~60% on identical prompts,
and found only ~11% of messages contain any commitment. Nano's failure mode is
*over*-extraction, which is what stage 1 of a cascade wants.

```
message → Nano binary gate ("does this contain any commitment at all?")
        → if yes: Super structured extraction
        → resolveDue() → dedupe → reconcile
```

The gate is a yes/no schema at `reasoning_effort: "low"`. It must be tuned for
**recall**, not accuracy — a false yes costs one Super call, a false no silently
loses a commitment forever. Target ≥98% recall on the Enron set; report the
measured Super-call reduction in the README.

If measured gate recall is below 95%, **drop the gate** and send everything to
Super. The saving is not worth losing rows. This is a real possible outcome, not
a formality.

### Dedupe

A promise restated three times in a thread is one row. Two rows collapse when
they share `thread_id` and `direction`, the counterparty matches, and cosine
similarity of `what` exceeds 0.85. The earliest message wins as the origin —
the receipt should point at where the promise was first made.

---

## 3. Build pipeline (Day 3)

`scripts/build-ledger.mts`, run offline, output committed:

```
data/corpus/messages.json
  → gate → extract → resolveDue → dedupe
  → chronological reconcile pass
  → data/ledger/baseline.json     (committed, renders with zero API calls)
  → data/cache/*.json             (committed, keyed by pipeline role)
```

Every model call during this build runs with `NEBIUS_CACHE_WRITE=1`, so the
committed cache covers the entire demo path. The app must render the full ledger,
and replay the money shot, with `NEBIUS_API_KEY` unset.

### Demo clock

`data/corpus/meta.json` carries `today: "2026-09-23"`. **The UI reads overdue
against that frozen date, not `Date.now()`.** A judge opening this in December
must see "11 days overdue", not "94 days overdue" — the latter makes the corpus
look abandoned rather than live. A small "demo date" indicator in the header
makes this honest rather than hidden.

---

## 4. App architecture (Day 4)

Next.js 16 App Router. Server components read the committed JSON directly; no
data fetching on the render path.

```
app/page.tsx              Ledger (server component, reads baseline.json)
app/memory/page.tsx       Policy rules + counterparty reliability
app/skills/page.tsx       Chase playbooks
app/access/page.tsx       Scope toggles + outbound log
app/api/reconcile/route.ts   POST - "Run now" on a held-back message
app/api/draft/route.ts       POST - generate a chase for one row
lib/ledger.ts             load, filter, sort, overdue math
lib/policy.ts             localStorage schema + rule application
```

**Persistence split:** committed JSON is the baseline everyone sees;
`localStorage` holds everything the viewer changes (accepted/rejected rows,
learned policy rules, edited playbooks). Two consequences worth stating plainly —
each judge gets their own clean session, and "your data stays under your control"
is literally true rather than a claim.

### Ledger screen

Two columns, `You owe` / `Owed to you`, overdue first, then by due date, undated
last. Each row: counterparty, what, due phrasing, days late, state chip.

Row expands to the receipt: the verbatim quote, its date, the sender, and the
full state history with each transition's rationale. **The expanded receipt is
the product.** It gets the design attention.

Low-confidence rows (< 0.6) live in a separate collapsed "needs review" bucket
rather than polluting the main ledger — a visible low-confidence bucket is how
the precision/recall tradeoff stays honest instead of hidden.

---

## 5. Memory (Day 4)

The track requires persistent memory. Ours is visible and editable, not a hidden
vector store.

**Policy rules** — each carries the correction that created it, the date, and how
many times it has fired:

```
{ id, rule, created_from: { action, row_id, at }, fire_count, enabled }
```

Created when the user rejects or edits a row: rejecting Marcus's low-confidence
row writes *"Don't track informal 'happy to' offers from Marcus"*. The rule list
is plain English, editable, exportable as JSON, deletable.

**Counterparty reliability** — derived from ledger history, not stored
separately: promises made, kept, slipped, average days late. "Marcus has slipped
3 of 5." Derived means it cannot drift out of sync with the ledger.

The demo must show a correction changing behavior on screen: reject a row, watch
the rule appear with its provenance, re-run, see the ledger differ.

---

## 6. Skills and chase drafts (Day 5)

Four playbooks, each an editable prompt plus tone, stored in localStorage and
reusable across every row:

`Gentle nudge` · `Escalate` · `Renegotiate the date` · `Close it out`

Draft generation: Super at `reasoning_effort: "medium"`, given the row, its full
evidence history, the counterparty's reliability stats, the selected playbook,
and any Tavily enrichment. Output is a subject and body, shown in an editable
composer.

**Nothing sends.** There is no send path, no OAuth, no SMTP. Drafts are copyable.
This is the honest position given the demo has no mail connection, and it makes
the Access screen's default (draft-only) true rather than decorative.

## 7. Tavily (Day 5)

Counterparty enrichment at build time, cached to `data/enrichment.json`: one
search per counterparty org, storing a two-line summary plus source URLs.

Used in chase drafts — "Acme just closed a funding round" legitimately changes
how you nudge. Satisfies the Best Use of Tavily bonus with a functional runtime
call. Cached so it cannot rot, and skipped gracefully when `TAVILY_API_KEY` is
absent.

## 8. Access screen (Day 5)

Per-scope toggles: read mail / draft / send / calendar. `send` and `calendar` are
present but **disabled with an explanation**, because they genuinely are not
implemented. Below the toggles, a log of every model call the session made: role,
model, cached-or-live, token count.

Showing that log is the cheapest credible answer to "what is this thing actually
doing with my email", and it doubles as the technical-implementation exhibit.

---

## 9. Day 6 — durability and the README

- **`.mbox` upload**, parsed client-side via `postal-mime`. Nothing uploads. Capped
  at 200 messages, `text/plain` preferred. This is both the bring-your-own-data
  story and what lets the video run on a real Google Takeout.
- **Rot test as a script**: `npm run test:rot` unsets the key, rebuilds, and
  asserts the ledger and the money shot still render from cache.
- **README** filled in: the measured eval table, the model-split argument with
  real numbers, cost per full corpus pass, and why Ultra is unused.

---

## 10. Explicitly out of scope

Named so they do not creep in:

- Sending mail. No OAuth, no SMTP, no Gmail API.
- Calendar writes.
- A database.
- Nebius Serverless Jobs nightly pass — **deferred to after submission.** It is
  the most rot-prone component and the "Run now" button demos identically. Build
  it in the Oct 30 window if time allows, not this week.
- Attachment OCR — Nano Omni is not in this account's catalog.
- `/v1/rerank` — no reranker in this account's catalog. Cosine over embeddings
  instead.

---

## 11. Risk register

| Risk | Signal | Response |
|---|---|---|
| Reconciliation confuses `superseded` with `satisfied` | Acceptance test fails on `ridgeline-superseded` | Few-shot the two cases explicitly; if still failing, try Ultra for reconcile only |
| Nano gate recall < 95% | Measured on Enron set | Drop the gate, send everything to Super |
| Transition quotes ungrounded | Grounding check drops > 20% | Loosen to sentence-level fuzzy match, never remove the check |
| Cache misses in production | Rot test fails | Every demo path must be exercised during the cached build |
| Corpus feels synthetic to judges | Subjective | The `.mbox` upload path and the Enron-based eval are the answer |

---

## 12. Definition of done for this week

1. `npm run build` passes; deployed to Vercel with a public URL.
2. Ledger renders from committed JSON with **no API key present**.
3. All seven reconciliation acceptance cases pass as automated tests.
4. Money shot works end to end: Marcus's row expands to a dated verbatim receipt,
   "Run now" moves it to `partially_satisfied`, a chase draft names the two
   missing vendors.
5. A correction creates a visible policy rule with provenance.
6. README carries the measured eval table and the model-split argument.
7. Repo public, Apache-2.0 detected, no secrets in any blob.
