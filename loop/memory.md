# memory.md — the experiment journal

Append-only. One block per iteration, newest at the bottom. Format in
[PROJECT.md](./PROJECT.md) §6.

The point of this file is that iteration 40 does not re-run iteration 7. A null
result is exactly as valuable for that as a win, so write the boring ones down
too.

---

## Iteration 0 — 2026-09-30 — harness stood up

Not an optimization iteration. Recording the starting state so the first real one
has something to compare against.

**Built:** `loop/evaluate/invariants.ts` (gates G7 and G8, 21 assertions),
`loop/evaluate/check.mts` (the ratchet over G1–G4 + G7/G8),
`loop/baseline/scorecard.json`, this journal, and `PROJECT.md`.

**Baseline at commit `d352a31`:**

| Gate | |
|---|---|
| G1 ledger acceptance assertions | 24 / 24 |
| G2 rot checks, no API key present | 18 / 18 |
| G3 typecheck | clean |
| G4 production build | passes |
| G7 + G8 invariants and couplings | 21 / 21 |

**Score:** none yet. `evals/labeled/` is empty, so S1 does not exist. The
previously quoted figures — Super ~95% precision, Nano ~60% — were read off the
candidate dumps by eye, never computed; `evals/run-extract.mts:10` says in its own
comments that it scores nothing. Until labeling pass 1 lands, this harness is a
**ratchet only**: it can prove nothing regressed, and cannot find an improvement.

**Ratchet verified against two deliberate regressions**, both reverted:

- Lowered draft `maxTokens` from 3000 to its known-bad 1400 → G8 red, naming the
  number: `the draft token budget stays at or above its measured floor of 3000 —
  found 1400, 1400`.
- Deleted one assertion from `evals/reconcile.test.mts` → G1 red at 23/24. So the
  ratchet cannot be made green by removing whichever check is failing, which was
  the main thing worth testing.

**Open, in order:**

1. `evals/label.mts` + labeling pass 1 (human, ~50 candidates) → S1 becomes real.
2. Freeze `evals/smoke-40.json`.
3. Noise floor: `loop:eval --runs 3` on unchanged prompts → `loop/baseline/noise.json`.
   Until this exists, no result can be called an improvement. `seed` does not give
   reproducibility on this platform, so the band may be wide enough to make S1
   unusable on its own — that is a real possible outcome and worth finding out here
   rather than at iteration 40.
4. Sandbox split: `loop/generate/`, gate first, then extract. Reconcile moves in
   marked ratchet-only. Draft stays out — no eval, no external callers, and a
   measured floor that looks like a tunable.
