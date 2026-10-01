# PROJECT.md — the guardrails

Human-authored. **No agent may edit this file.** It defines what is being
optimized, what must never move, and when to stop.

The rule the whole harness rests on: **the system that generates the work and the
system that evaluates it are never the same.** An optimizer that can edit its own
scorer does not optimize, it cheats — and it will, because weakening a check is
always cheaper than improving a prompt. So the generator is one narrow directory
and everything else is read-only.

---

## 1. File ownership

| You may edit | You may never edit |
|---|---|
| `loop/generate/**` | `loop/PROJECT.md` (this file) |
| `loop/memory.md` (append only) | `loop/evaluate/**` |
| | `evals/**` — the labels above all |
| | `lib/**`, `scripts/**`, `app/**` |
| | `data/**` |
| | `package.json`, `tsconfig.json` |

If you believe a change outside `loop/generate/` is required, **stop and say so**.
Do not make it. A hypothesis that needs the verifier changed is not a hypothesis
about the prompts, and it may be a correct observation about the harness — which
is worth hearing, and is a human's call.

`evals/labeled/**` is the hard case, so it is stated separately: **no model writes
the labels, ever, not even to reformat them.** A model labeling its own test set
makes every number downstream circular, and the circularity is invisible once it
is in the file.

---

## 2. What is being optimized

**The score is extraction precision** on the labeled Enron set (metric S1), until
recall labels exist and F1 (S3) replaces it.

Precision only. Recall is not in the score — it is held from below by gate G6
(gate recall ≥ 0.98), because precision bought by dropping commitments is not an
improvement, it is the product failing quietly. If an experiment raises precision
and drops gate recall below the floor, that is a regression, not a trade.

Tie-break: equal score, fewer tokens wins (S4).

### Scope

In the sandbox:

- **gate** — `loop/generate/gate.ts`. Scored, and the main target: it is cheap,
  high-fanout, and its only job is to not hide anything from the precise model.
- **extract** — `loop/generate/extract.ts`. Scored.
- **reconcile** — `loop/generate/reconcile.ts`. **Ratchet-only.** There is no
  labeled eval for reconciliation, so no metric rewards improving it. Changes here
  are allowed but are judged solely by gate G1 staying green. Do not claim an
  improvement to reconcile; there is nothing to measure it with.

Not in the sandbox:

- **draft** — `lib/draft.ts` stays frozen. It has no external callers and no eval,
  so nothing would catch a regression. It also holds a measured floor disguised as
  a tunable (`maxTokens: 3000`; at 1400 the model returned empty content and
  `chat()` read that as a dead model and fell through to Ultra). Revisit when
  drafting has an eval of its own.

---

## 3. The hard gates

Pass/fail. Never part of the score. **A red gate means revert, always.** A gate is
never the thing to fix — if a gate is wrong, that is a human's decision, recorded
here, not a step in an iteration.

| | Gate |
|---|---|
| G1 | 24 ledger acceptance assertions (`evals/reconcile.test.mts`) |
| G2 | 18 rot checks with no `NEBIUS_API_KEY` present (`scripts/test-rot.mts`) |
| G3 | `npx tsc --noEmit` clean |
| G4 | `npm run build` passes |
| G5 | every ledger row carries a verbatim quote; 0 transitions dropped as ungrounded |
| G6 | gate recall ≥ 0.98 |
| G7 | the measured invariants are still in place |
| G8 | prompt text and the code that verifies it have not desynced |

`npm run loop:check` runs G1–G4, G7 and G8 with no model calls, in under a minute.
G5 and G6 need live calls and run inside `npm run loop:eval`.

`loop/baseline/scorecard.json` pins the **count** of assertions in each suite, not
just the result. Running fewer assertions than the baseline is itself a failure.
Without that, the cheapest way to green this command is to delete whichever
assertion was red. Raise those numbers when assertions are added. Never lower one
to make a run pass.

### What G7 and G8 protect, and why they are not negotiable

Each of these is in the harness because it was measured, and most of them cost a
day to find:

- **Nano's reasoning_effort is clamped to `low`.** At `none` it returns empty
  content with `finish_reason: "stop"`. At `high` it emits one valid JSON field
  then degenerates into a whitespace loop that eats the entire token budget
  (16k tokens / 71s observed). Both arrive as HTTP 200.
- **Direction comes from the envelope, not the model.** Whoever says "I'll do X"
  owes X, and that is checkable from the headers. Getting it backwards inverts the
  ledger and chases the wrong person.
- **Deadlines are parsed, never generated.** `lib/due.ts` imports no model client.
  A hallucinated date looks authoritative and is unrecoverable.
- **Quote grounding runs on every extraction.** A commitment whose quote is not in
  the message body is a guess wearing a citation.
- **The gate fails open.** A broken gate must never silently drop mail.
- **Cache keys are namespaced by pipeline role, not by model ID**, so a model
  deprecation cannot orphan the committed demo cache.
- **Prompt↔code couplings** (G8): the repair turn's wording is the textual half of
  `attributionOk()`; `MONTHS` feeds `formatDay()`, whose output `quotesEvidence()`
  matches with a date regex; the verify window and the repair window are the same
  number written twice. Reword any of these and the draft still generates — the
  grounding check just stops recognising its own evidence.

---

## 4. Running an iteration

1. **Read this file and `loop/memory.md` first.** Never repeat an experiment
   already logged there, even if you would do it differently. If it looks worth
   retrying, say why in the journal before running it.
2. **State the hypothesis in one sentence** before editing anything. One change
   per iteration. Two changes make the result uninterpretable.
3. **Edit only `loop/generate/**`.**
4. **Run `npm run loop:eval -- --runs 3`.** This uses the frozen 40-message smoke
   set by default.
5. **Any hard gate red → revert immediately** and log the failure. Do not attempt
   a fix in the same iteration.
6. **Compare the score against the noise band** in `loop/baseline/noise.json`:
   - Up by more than the band → promote with `--full`. If it holds on the full
     150-message set, keep it, commit, and log the delta.
   - Inside the band → this is noise, not an improvement. Revert and log it as
     noise so nobody retries it.
   - Down → revert and log why you think it failed.
7. **Three consecutive iterations with no improvement → stop and ask for human
   review.** Do not keep going. Three failures in a row usually means the
   hypothesis space is wrong, not that the next one will land.

### Measurement is noisy, and the band is not optional

`seed` is accepted by Token Factory and **does not give reproducibility**. The same
reconcile prompt produced a transition on one run and none on the next. So a
single run proves nothing: a scored result is the **median of three**, and a delta
smaller than the recorded noise band is noise no matter how plausible the
hypothesis.

Smoke-set precision is **not comparable to full-set precision** in absolute terms
— the smoke set is stratified toward commitment-bearing messages, so its base rate
is wrong on purpose. Use it only for run-to-run deltas. The full set is the arbiter
for anything that gets kept.

### Budget

- Smoke iteration: ~60 calls per run, ~180 per 3-run iteration.
- Full run: ~300 calls; ~900 for a 3-run median.
- **Ceiling: 2,000 calls per session.** Stop and report when you reach it.
- Loop runs write their response cache to `loop/.cache/` via `NEBIUS_CACHE_DIR`.
  Never set `NEBIUS_CACHE_WRITE=1` against `data/cache/` — that is the committed
  demo cache, and bloating it breaks G2.

---

## 5. Stopping criteria

Stop and hand back to a human when any of these is true:

- Three consecutive iterations with no improvement beyond the noise band.
- The call budget for the session is spent.
- A hard gate fails and reverting does not restore it (something outside the
  sandbox changed).
- The measured noise band is wide enough that the score cannot distinguish a real
  improvement. Say so plainly — that is a finding about the platform, worth more
  than another iteration.
- An experiment would require editing anything outside `loop/generate/`.

---

## 6. Journal format

Append to `loop/memory.md`. One block per iteration, newest at the bottom:

```
## Iteration N — YYYY-MM-DD

**Hypothesis:** one sentence.
**Changed:** files under loop/generate/, and what about them.
**Gates:** all green | which one went red.
**Score:** S1 before -> after (median of 3), noise band +/- X.
**Verdict:** kept (commit abc1234) | reverted — noise | reverted — worse | reverted — gate red.
**Why:** one or two sentences. If it failed, what the failure suggests about the
next hypothesis.
```

Write the verdict even when it is boring. The journal's value is that iteration 40
does not re-run iteration 7, and a null result is exactly as useful for that as a
win.
