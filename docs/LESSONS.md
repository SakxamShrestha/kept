# Lessons

Practice, not platform. Platform findings live in [FINDINGS.md](./FINDINGS.md) and
are the source for the required feedback submission; this file is what I would do
differently next time, and it is the raw material for a reusable starter kit after
this ships.

Each entry is something that actually happened in this repo, what it cost, and the
rule it suggests. Nothing here is general advice — if it is not traceable to a
commit or a test run, it does not belong in this file.

---

## Before writing any code

### Measure the platform. Never copy a fact out of its docs.

All four Nemotron model IDs on this account differ from the IDs in Nebius's own
documentation and marketing, and the docs listed no Nemotron models at all. A
hardcoded ID taken from a docs page would have been wrong on day 0 and would have
looked like a code bug.

`npm run check:models` and `npm run check:json` exist for exactly this, and they
are the reason the pipeline worked on the first real run.

**Rule:** day 0 of a project is a script that interrogates the actual account and
prints the facts. Put the facts in env vars, not in source. Re-run it before any
milestone.

### Find out what the provider cannot do, before designing around it.

I recommended a provider-side spend cap as the primary control for two public,
paid API routes. There isn't one. Nebius budgets alert but explicitly "do not stop
or cap your usage", their usage data lags by hours, a key's rate limit cannot be
lowered by its owner, and this account allows 100 requests per second. Ten minutes
of checking changed the design from "cap it upstream" to "gate the priced code
path".

**Rule:** before a safety design depends on a platform feature, confirm that
feature exists. State it as an assumption until you have.

---

## While building

### A test can be wrong in exactly the way the code can.

I reported that six ledger rows had their direction inverted, published it, and was
wrong. The check used `origin.message_id.includes("okaforconsulting")` as a proxy
for "the owner sent this" — but every message ID in the corpus carries the
mailbox's own domain regardless of sender. `brightpath-silence-0@okaforconsulting.com`
was sent by `tomas@brightpath.io`. Against the real `from` field, all ten rows were
already correct.

Cost: a false alarm in a status report, and a published page whose headline claim
had to be retracted.

**Rule:** when an assertion fails, audit the assertion's assumptions before the
data's. A proxy for a fact is a bug waiting for a coincidence.

### Pin the number of assertions, not only their result.

The cheapest way to make a failing suite pass is to delete the failing test.
`loop/baseline/scorecard.json` records how many assertions each suite should run,
and `npm run loop:check` fails if fewer ran. Verified by deleting one ledger
assertion and watching the gate go red at 23 of 24.

**Rule:** a regression gate that only checks pass/fail can be satisfied by
deletion. Record the count.

### Separate the thing that generates work from the thing that judges it.

An optimizer that can edit its own scorer does not optimize. Weakening a check is
always cheaper than improving the work, so it will weaken the check. In this repo
`loop/generate/` is the only writable directory and `loop/evaluate/` plus
`evals/labeled/` are off limits, which is the one rule the whole harness rests on.

**Rule:** before automating any improvement loop, make the verifier unreachable
from the thing being improved.

### Prompt text can be load-bearing for a code-level check.

Three places in `lib/draft.ts` have wording and a check that must change together:
the repair turn tells the model to write "I said", and `attributionOk()` rejects
"you wrote"; `MONTHS` feeds `formatDay()`, whose output `quotesEvidence()` matches
with a date regex; the verify window is written out a second time in the repair
path. Reword any of them and drafting still works — the grounding check just stops
recognising its own evidence.

Found by reading the pipeline looking for it, not by a failure. Nothing would have
failed.

**Rule:** where a prompt and a validator depend on the same string, assert the
coupling. Behaviourally if the functions are exported, by grep if not.

### Ground truth has to come from a person.

`evals/labeled/` is still an empty directory. The headline accuracy figures quoted
in `CLAUDE.md` and planned for the README — "Super ~95% precision, Nano ~60%" —
were read off candidate dumps by eye. `evals/run-extract.mts:10` says so in its own
comments: it scores nothing, because the ground truth has to come from a human.

Everything downstream of an unmeasured number is also unmeasured. A model labeling
its own test set makes the circularity invisible once it is in the file.

**Rule:** the eval set is human work and cannot be delegated. Budget the hours
explicitly, early, or every accuracy claim stays an estimate.

### Estimate after reading the code, not before.

I quoted the demo-token gate at "about ten lines across two routes". It came to
roughly 200 lines across thirteen files, because a token nobody can enter is
useless — it needed a storage layer, a UI field, and threading through four
pipeline functions.

**Rule:** an estimate given before reading the call sites is a guess. Say so, or
read first.

---

## Before shipping

### A requirement satisfied in code is not satisfied on the demo path.

The hackathon requires a runtime call to the inference API. The whole pipeline
called it correctly — at build time. `app/api/` was an empty directory and nothing
under `app/` called `fetch`, so a judge could click through the entire deployed
demo and trigger zero calls. Everything looked finished and the requirement was
unmet.

**Rule:** for every requirement, name the exact user action that demonstrates it.
If you cannot, it is not demonstrated.

### A document that describes demo behaviour needs something asserting it.

`docs/SPEC.md` promised "Run now on a held-back message". No message was ever held
back — the corpus held 21 and the build reconciled all 21, so the route had nothing
to apply and the transition it was meant to show had already happened at build
time. Nothing failed, because no test asserted the spec's narrative.

**Rule:** if a doc describes what the demo does, a test should assert it. Prose
drifts from artifacts silently and in the direction that flatters you.

### Serverless reads the filesystem differently from a build.

`lib/ledger.ts` resolves data through `path.join(process.cwd(), "data", ...)`.
Pages get away with it because they read at build time and prerender. A route
handler reads at request time, where Next's file tracing cannot follow a dynamic
path — so the routes would have worked locally and 500'd in production, which is
the worst shape a bug can take. Fixed with `outputFileTracingIncludes`.

**Rule:** anything that reads a file at request time gets tested against the
deployed URL, not localhost.

### Cache the demo before you need it, and test it with the key removed.

Submissions close nine weeks before judging ends. In that window a model ID can be
retired with no rerouting, a key can rotate, credits can hit zero — none of which
announce themselves. `npm run prewarm` makes the exact calls the demo path makes
and commits the responses; `npm run test:rot` deletes the key from its own
environment and asserts 18 things still answer.

Both routes were verified answering `source=cache` with an empty `NEBIUS_API_KEY`,
locally and in production.

**Rule:** the question is not "does it work", it is "does it work in eight weeks
with no credentials". Answer it with a script, not a hope.

### Deploy early with gaps rather than late with everything.

A live URL with four features beats a complete repo nobody can open. The first
deploy also surfaced two things nothing local would have: a project name the CLI
rejected for having uppercase letters, and a CLI version too old for the endpoint.

**Rule:** deploy on the first day there is anything to deploy, then redeploy.

### A week of uncommitted work is a week of risk, not a week of progress.

Last commit was 23 September; by 30 September there were 7 modified files and 13
new ones, all building and typechecking clean, none of it in git. One disk failure
would have cost the entire UI, the mbox parser and the rot test.

**Rule:** commit at every green gate. The gate is the commit signal.

---

## What this suggests for a reusable kit

Of the seven things worth templating, only four want to be documents — the brief,
the feature spec, the debugging approach, and this file. The other three are
checklists, and a checklist nobody re-reads on commit forty is decoration.

Code review, testing and deployment belong in one command that exits non-zero.
`npm run loop:check` is that command here: five gates, assertion counts pinned,
and it caught its own first bug on its first run.

The starter kit should therefore ship **the measuring, not the measurements** — a
day-0 probe script and a gate harness, with a `CLAUDE.md` that carries no version
numbers, model IDs or API shapes. Those are the facts that go stale and then get
cited as authority.
