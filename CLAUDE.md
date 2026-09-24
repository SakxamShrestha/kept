# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repo is a submission to the **Nebius x NVIDIA Global AI Hackathon**, **Personal AI track**.

## Hard constraints (breaking these disqualifies the submission)

- The project **must make a runtime call to the Nebius Token Factory inference API**, or run on Nebius AI Cloud (Serverless Jobs, Serverless Endpoints, or DevPods).
- The project **must use at least one NVIDIA open source model**.
- Do not substitute OpenAI, Anthropic, Gemini, or a locally-run non-NVIDIA model for core inference — not even as a temporary development fallback. If Token Factory is unreachable, fix the connection or stub the response; do not swap providers.

## Track requirements: Personal AI

The project is an always-on private assistant. It must demonstrate:

- **Persistent memory** across sessions.
- **Reusable skills** the assistant can invoke.
- **User-chosen tool and data access** — the user decides what it can reach.
- **Tasks carried across daily workflows**, not a single-shot chat.
- **Data under the user's control** — default to local-first storage. Do not send user data to third-party services without an explicit, stated reason.

## Calling Token Factory

OpenAI-compatible API. Key comes from `NEBIUS_API_KEY`.

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.tokenfactory.nebius.com/v1/",
    api_key=os.environ["NEBIUS_API_KEY"],
)
```

```javascript
const client = new OpenAI({
  baseURL: 'https://api.tokenfactory.nebius.com/v1/',
  apiKey: process.env.NEBIUS_API_KEY,
});
```

Regional host alternate, if the generic one fails: `https://api.tokenfactory.us-central1.nebius.com/v1/`

## Model selection

| Need | Model |
|---|---|
| Heavy reasoning, long-running autonomous work | Nemotron 3 Ultra 550b |
| Default workhorse, multi-agent | Nemotron 3 Super 120b — `nvidia/nemotron-3-super-120b-a12b` |
| Fast, cheap, high-volume calls | Nemotron 3 Nano 30b |
| Multimodal | Nemotron 3 Nano Omni |

Only the Super ID above is confirmed. **Resolve exact model IDs with `GET /v1/models` before hardcoding any other one** — do not guess an ID from the marketing name.

Route cheap calls to Nano and reserve Ultra for real reasoning; credits are finite.

## Secrets

`NEBIUS_API_KEY` lives in `.env`, and `.env` is gitignored. Never inline the key in source, config, or a commit. The repo must be public for judging, so a committed key is a published key.

## Submission gates

Deadline: **Friday, October 30, 2026, 10:00 AM PT**.

- Public repo with an OSS license file (Apache-2.0, MIT, or MPL-2.0) detectable at the top of the repo page.
- README with setup and run instructions, explicitly stating which NVIDIA model is used and where Token Factory accelerated the work.
- Working demo URL.
- Public YouTube video, 3 minutes or less, with audio covering Token Factory and Nemotron usage.
- Written feedback on Nebius Token Factory, AI Cloud, and NVIDIA tooling.

## This project: "Kept"

A commitment ledger. Extracts every promise in a mailbox, both directions, with a dated
verbatim quote as the receipt on each row; reconciles rows as new mail arrives. The ledger
*is* the persistent memory and it is the product surface — do not add a hidden vector store
and call that memory.

Next.js 16 (App Router) + TypeScript + Tailwind 4, deployed to Vercel. `lib/nebius.ts` is the
only place that talks to Token Factory.

```bash
npm run check:models   # Day-0 gate: authoritative model IDs + feature flags from your account
npm run check:json     # proves strict json_schema + reasoning_effort work
npm run dev            # http://localhost:3000
npm run build          # must pass before any commit that touches app/
npx tsc --noEmit       # typecheck
```

Next.js 16 breaking changes that bite: `cookies()`, `headers()`, `params`, and `searchParams`
are **async-only**; `middleware.ts` is renamed to `proxy.ts`. This version postdates the
training cutoff — read `node_modules/next/dist/docs/` before writing App Router code.

## Architecture rules (these exist for reasons that aren't obvious from the code)

- **Never hardcode a model ID.** Use the `MODEL_*` env fallback chains via `modelChain()`.
  Token Factory deprecates IDs with no automatic rerouting; an NVIDIA batch went in Aug 2026.
- **Cache keys are namespaced by pipeline role, not model ID** (`lib/nebius.ts`). Swapping a
  model must not orphan the committed demo cache.
- **No database, no OAuth, no live mail on the demo path.** Judging is Dec 1–15, twelve weeks
  after submission closes. Free Postgres tiers expire at 30 days, Google OAuth test-mode
  consent at 7. Seeded corpus is committed JSON; user mutations go to browser localStorage.
- **Retrieve, never stuff context.** All Nemotrons misread exact facts past ~100k tokens. Use
  `embed()` + `/v1/rerank` to pull candidate ledger rows; never pass the whole ledger.
- **Every ledger row needs a verbatim evidence quote.** A row without a receipt is a guess,
  and the product's premise is that the ledger can be trusted.
- Extraction is Nano at `reasoning_effort: "none"`; reconciliation is Super at `"high"`.
  Ultra stays unused on purpose — say so in the README rather than adding a token call.

## Where things are written down

- `docs/TASKS.md` — the task board. What is done, what is next, submission checklist.
- `docs/SPEC.md` — implementation spec and acceptance criteria.
- `docs/FINDINGS.md` — measured platform findings. Source for the required feedback submission.

## Repo state

Day 0 scaffold. No corpus, no pipeline, no UI yet. Next: Day 1 extraction-precision eval
against hand-labeled Enron messages — that gate decides whether the ledger tracks both
directions or retreats to outbound-only.
