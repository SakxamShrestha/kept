# Kept — a commitment ledger for your inbox

Your inbox tells you what to **read**. It never tells you what you **owe**.

Every "I'll send the deck Friday" and "we'll circle back after the board meeting"
evaporates into a thread nobody re-reads. The cost doesn't show up in your unread
count — it shows up in your reputation.

**Kept** extracts every promise in a mailbox, in both directions, into an auditable
ledger. Each row carries a dated verbatim quote as its receipt. As new mail arrives,
rows reconcile themselves: `open → satisfied | partially_satisfied | superseded |
renegotiated | abandoned`. Overdue rows get a one-click drafted chase.

Built for the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/),
**Personal AI track**.

> **Status: in development.** The sections marked _TBD_ below are filled in as the
> build progresses. Nothing in this README reports a number that has not been measured.

## Demo

_TBD — hosted URL and demo credentials._

The demo opens on a seeded mailbox and needs no login and no Google account. You can
also drop in your own Google Takeout `.mbox`; it is parsed **in your browser** and
never uploaded.

## How it uses NVIDIA models and Nebius Token Factory

Every model call goes to Nebius Token Factory at `https://api.tokenfactory.nebius.com/v1`
through the OpenAI-compatible API, using NVIDIA Nemotron 3 open models.

| Stage | Model | `reasoning_effort` | Why this size |
|---|---|---|---|
| **Extract** commitments from each message | Nemotron 3 **Nano** | `none` | High-fanout structured extraction — hundreds of calls, one tight JSON schema each. This is what a small MoE is for. |
| **Reconcile** new mail against open rows | Nemotron 3 **Super** | `high` | A genuinely different task shape: multi-step, evidence-bearing state transitions over ledger history. |
| **Draft** a chase for overdue rows | Nemotron 3 **Super** | `medium` | Tone-matched drafting against a named playbook. |

**Ultra is deliberately not used.** _TBD — cost and latency numbers backing that call._

Also used:
- **`response_format: json_schema`** with `strict: true` at every stage. Structured
  output isn't a convenience here; the ledger's evidence pointers are only trustworthy
  because the shape is enforced.
- **`/v1/embeddings` + `/v1/rerank`** to retrieve the candidate ledger rows a new
  message might affect. Every Nemotron misreads exact facts past ~100k tokens, so
  retrieval is a correctness requirement, not an optimization — we never stuff the
  whole ledger into context.
- **Nebius Serverless Jobs** for the nightly reconciliation pass. _TBD._
- **Tavily** for counterparty enrichment. _TBD._

## Evaluation

Most projects assert their model routing is principled. This one measures it.

_TBD — extraction precision/recall on a hand-labeled set, and a Nano-vs-Super
confusion matrix on reconciliation states._

The eval runs against real business email (the public Enron corpus) rather than
synthetic fixtures, because LLM-written test mail is easy for an LLM and would make
the precision number a lie. The corpus is fetched locally by script and is **never
committed** — it's licensed for non-commercial research use, and this repo is
Apache-2.0.

## Setup

Requires Node.js 20.9+ (tested on 22).

```bash
git clone <repo-url>
cd kept
npm install
cp .env.example .env.local     # then add your NEBIUS_API_KEY
```

Confirm your account's model catalog before anything else. The Token Factory docs
currently list no Nemotron models and are stale, so your own account is the only
authoritative source:

```bash
npm run check:models   # lists NVIDIA models + feature flags, prints .env lines to paste
npm run check:json     # proves strict json_schema + reasoning_effort work on them
```

Then:

```bash
npm run dev            # http://localhost:3000
```

### Why model IDs live in env vars

`MODEL_EXTRACT` and `MODEL_RECONCILE` are comma-separated **fallback chains**, tried
left to right. Token Factory runs scheduled model deprecations and does not reroute
requests from a retired ID — an NVIDIA batch was deprecated in August 2026. A
hardcoded model is a demo that dies silently between submission and judging.

For the same reason, responses for the canonical demo flows are cached to
`data/cache/` **keyed by pipeline role rather than by model ID**, so swapping or
losing a model does not orphan the cache. The demo still demonstrates itself with no
API key at all.

## Design notes

**No database, no OAuth, no live mail connection.** Not a simplification — a
survival requirement. Submissions close Oct 30; judging runs Dec 1–15. Anything that
expires in that twelve-week gap (free Postgres tiers at 30 days, Google OAuth
test-mode consent at 7 days, trial credits at 30 days) is a demo that is dead when it
matters. Seeded corpus is committed JSON; your own mutations live in browser
localStorage, which also makes "your data stays under your control" literally true
rather than a marketing line.

**Why judges can't connect their own Gmail — and don't need to.** Every Gmail read
scope, including `gmail.metadata`, is a Google *restricted* scope requiring a CASA
Tier 2 third-party security assessment (weeks, $540–$5,000+). Testing-mode consent
expires after 7 days. So the demo never touches Google at runtime, and the
bring-your-own-data path is a local `.mbox` parse instead.

## License

[Apache-2.0](./LICENSE)
