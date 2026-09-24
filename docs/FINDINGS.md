# Platform findings — Nebius Token Factory + NVIDIA Nemotron

Measured, not recalled. Everything here came from running against a live Token
Factory account. This doubles as the source material for the hackathon's
required feedback submission.

Account catalog pulled `2026-09-23` via `GET /v1/models?verbose=true`.
Reproduce with `npm run check:models` and `npm run check:json`.

## 1. The docs do not list any Nemotron model

`https://docs.tokenfactory.nebius.com/llms.txt`, the quickstart, and the
list-of-models page all use Llama / DeepSeek / Qwen examples. No Nemotron ID
appears anywhere in the documentation, and the one ID published on Nebius's own
Nemotron product page (`nvidia/nemotron-3-super-120b-a12b`) is only one of four
models the account actually exposes — and it is the *only* one whose published
casing matches the API.

**Actual IDs on this account:**

| Model | ID | Context |
|---|---|---|
| Nemotron 3 Nano 30B | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | 262,144 |
| Nemotron 3 Super 120B | `nvidia/nemotron-3-super-120b-a12b` | 262,144 |
| Nemotron 3 Ultra 550B | `nvidia/Nemotron-3-Ultra-550b-a55b` | 1,048,576 |
| Nemotron 3.5 Lightning | `nvidia/Nemotron-3_5-Lightning` | 1,048,576 |

Note the inconsistent casing across the four — `nvidia/NVIDIA-…`,
`nvidia/nemotron-…`, `nvidia/Nemotron-…`. A developer guessing IDs from the
marketing names gets 404s, and 404s from a deprecated-or-misspelled model look
identical.

**Suggestion:** list model IDs in the docs, and normalize the casing.

## 2. Nemotron 3 Super is 262K context here, not 1M

Nebius's launch post for Nemotron 3 Super says "up to 1M token context."
`/v1/models?verbose=true` reports **262,144** for it on this account. Ultra and
Lightning do report 1,048,576. Third-party aggregators that said 262K were
right; the blog copy is misleading for Super specifically.

## 3. `reasoning_effort` on Nano is broken at two of seven levels

The API accepts seven levels (`none | minimal | low | medium | high | xhigh | max`).
Same prompt, same strict `json_schema`, `temperature: 0`, on
`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`:

| `reasoning_effort` | `max_tokens` | Result | Latency | Completion tokens |
|---|---|---|---|---|
| `none` | 2048 | **empty content**, `finish_reason: stop` | 675ms | 29 |
| `none` | 8000 | **empty content**, `finish_reason: stop` | 261ms | 8 |
| `low` | 8000 | correct | 1352ms | 246 |
| `high` | 16000 | **degenerate whitespace loop**, `finish_reason: length` | 71,667ms | 16,000 |

At `none` the call *succeeds* and returns nothing — no content, no
`reasoning_content`, no error. A caller that doesn't check for an empty string
gets a silent data-loss bug rather than an exception.

At `high` the model emits valid JSON for the first field, then collapses into
repeated `\n \n \n` until it exhausts the token budget. Raising `max_tokens`
only makes it burn more; this is not truncation.

Super and Ultra behaved correctly at every level tested.

**Workaround in this repo:** `safeEffort()` in `lib/nebius.ts` clamps any Nano
call to `low`.

**Suggestion:** `none` should either work or return an error. Silently returning
an empty successful completion is the worst of the three options.

## 4. Ultra is faster than Super

Counterintuitive and worth documenting, since the natural assumption is that the
550B model is the slow one. Same prompt and schema:

| Model | `none` | `high` |
|---|---|---|
| Super 120B | 1574ms / 93 tok | 5741ms / 820 tok |
| Ultra 550B | 930ms / 96 tok | 1371ms / 303 tok |

Ultra was faster at every effort level, and roughly 4x faster at `high`. Likely
a serving/capacity artifact rather than an architectural property, but it means
"use the small model for speed" is not automatically true here.

## 5. No reranker, no Nano Omni on this account

`/v1/rerank` is documented and the Qwen3 Reranker models are referenced, but no
reranker appears in this account's catalog — only one embedding model
(`Qwen/Qwen3-Embedding-8B`, 40,960 context). Nemotron 3 Nano Omni is listed on
the Nemotron product page but is not in the catalog either.

Consequence for this project: retrieval uses embeddings + cosine similarity
only, and attachment OCR was dropped from scope.

**Suggestion:** the model catalog and the marketing pages should agree, or the
docs should say which models are region- or tier-gated.

## 6. What worked well

- **Strict `json_schema` is reliable.** Every Nemotron that returned content
  returned schema-valid JSON on the first try. The spec's prose claiming only
  `json_object` and `text` are supported is stale — `json_schema` with
  `strict: true` is in the live OpenAPI enum and works.
- **Precision out of the box was better than expected.** Given a message
  containing one firm promise, one conditional offer ("happy to loop in Priya if
  useful"), and one vague intention ("let's maybe sync next month"), all four
  models extracted exactly the firm promise and rejected the other two, with no
  few-shot examples.
- **OpenAI-compatible surface meant zero client work** — the stock `fetch`
  shape, `tools`, and `response_format` all behaved as documented.
