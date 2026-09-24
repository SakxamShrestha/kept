# Kept — task board

Survives sessions. Update as work lands. Spec lives in [SPEC.md](./SPEC.md),
measurements in [FINDINGS.md](./FINDINGS.md).

**Submission closes Fri Oct 30 2026, 10:00 PT. Judging Dec 1–15 2026.**

---

## Done

- [x] **Day 0 — scaffold + platform gate**
  Next.js 16 / TS / Tailwind 4, Apache-2.0, repo public at
  [SakxamShrestha/kept](https://github.com/SakxamShrestha/kept).
  `lib/nebius.ts`: env fallback chains, disk cache keyed by pipeline role.
  `npm run check:models` / `check:json` confirmed the real Nemotron IDs — all
  four differ from the published guesses.
- [x] **Day 1 — extraction + the eval that picked the model**
  Super ~95% precision vs Nano ~60% on 150 real Enron messages. Guards added in
  code for invented `due_text`, 0–100 confidence, and quote grounding.
- [x] **Day 2 — demo corpus + deadline resolution**
  8 hand-authored threads, one per ledger state, plus an adversarial noise
  thread. `resolveDue()` is a date parser, never a model call.
- [x] **Day 3 — reconciliation + cascade + tests**
  Full state machine, candidate retrieval, Nano gate at 100% recall / 55% call
  saving, 21 acceptance assertions green.

---

## Day 4 — ledger UI + memory *(next)*

- [ ] `lib/ledger.ts` — load, filter, sort, overdue math against the frozen demo date
- [ ] `app/page.tsx` — two columns (`You owe` / `Owed to you`), overdue first, undated last
- [ ] Expandable receipt: verbatim quote, date, sender, full state history with rationales
- [ ] Low-confidence (< 0.6) rows in a separate collapsed "needs review" bucket
- [ ] Demo-date indicator in the header — overdue is computed against
      `meta.today`, **not** `Date.now()`, or a judge in December sees "94 days overdue"
- [ ] `lib/policy.ts` — localStorage schema, rule application
- [ ] `app/memory/page.tsx` — policy rules with provenance (which correction
      created it, when, fire count) + counterparty reliability derived from ledger history
- [ ] Rejecting a row writes a visible rule

## Day 5 — skills, chase drafts, Tavily, access

- [ ] Four editable playbooks: Gentle nudge / Escalate / Renegotiate / Close it out
- [ ] `app/api/draft/route.ts` — Super at `reasoning_effort: "medium"`, fed the
      row, its history, counterparty reliability, playbook, enrichment
- [ ] `app/skills/page.tsx` — playbook editor
- [ ] Tavily enrichment at build time → `data/enrichment.json`, graceful skip
      without a key *(Best Use of Tavily, $3,000)*
- [ ] `app/access/page.tsx` — scope toggles (`send`/`calendar` disabled with an
      explanation, because they genuinely are not implemented) + per-session model call log
- [ ] `app/api/reconcile/route.ts` — "Run now" on a held-back message

## Day 6 — durability, README, deploy

- [ ] Client-side `.mbox` upload via `postal-mime`, capped at 200 messages, nothing uploaded
- [ ] `npm run test:rot` — unset the key, assert ledger and money shot still render from cache
- [ ] README: measured eval table, model-split argument, cost per corpus pass, why Ultra is unused
- [ ] Deploy to Vercel, confirm the public URL
- [ ] Verify the whole judge flow in a private window with no key present

---

## Before Oct 30

- [ ] **Demo video**, ≤ 3 min, public on YouTube, audio covering Token Factory
      and Nemotron usage
- [ ] **Devpost submission**: track = Personal AI, description, demo URL, repo
      URL, testing instructions **with demo credentials**
- [ ] **Feedback section** — [FINDINGS.md](./FINDINGS.md) is the source. Five
      genuine platform bugs with repro *(Most Valuable Feedback, $100 + swag)*
- [ ] Optional: Nebius Serverless Jobs nightly pass. Deferred deliberately —
      most rot-prone component, and "Run now" demos identically

## Before Dec 1 *(do not skip — this is how submissions score zero)*

- [ ] **Nov 25: open the demo URL in a private window and click the entire judge
      flow.** Model IDs get deprecated with no rerouting, free tiers expire,
      keys rotate. Fifteen minutes here is worth more than any feature.

---

## Deliberately out of scope

Sending mail · calendar writes · a database · attachment OCR (no Nano Omni in
this account) · `/v1/rerank` (no reranker in this account) · Google OAuth (every
Gmail read scope is restricted; consent expires in 7 days)
