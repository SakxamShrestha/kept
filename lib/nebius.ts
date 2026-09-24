/**
 * Nebius Token Factory client.
 *
 * Two things here are load-bearing for surviving the gap between submission
 * (Oct 30) and judging (Dec 1-15):
 *
 *   1. Model IDs come from env as FALLBACK CHAINS. Token Factory runs scheduled
 *      deprecations and does not reroute requests from a retired ID, so a
 *      hardcoded model is a demo that dies silently in December.
 *   2. Responses are cached to disk keyed by ROLE, not by resolved model ID.
 *      If every model in a chain is gone, the committed cache still answers and
 *      the demo still demonstrates itself.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const BASE_URL = (
  process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1"
).replace(/\/+$/, "");

const CACHE_DIR = path.join(process.cwd(), "data", "cache");

/** Logical job a call performs. Cache keys are namespaced by this, so swapping
 *  the underlying model does not orphan a cached demo response. */
export type Role = "extract" | "reconcile" | "draft";

const CHAINS: Record<Role, string> = {
  extract: process.env.MODEL_EXTRACT ?? "nvidia/nemotron-3-nano-30b-a3b",
  reconcile: process.env.MODEL_RECONCILE ?? "nvidia/nemotron-3-super-120b-a12b",
  draft: process.env.MODEL_RECONCILE ?? "nvidia/nemotron-3-super-120b-a12b",
};

export function modelChain(role: Role): string[] {
  return CHAINS[role]
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

/**
 * Measured on 2026-09-23 against Token Factory (see docs/FINDINGS.md):
 *
 *   Nemotron 3 Nano, reasoning_effort="none"  -> empty content, finish_reason
 *     "stop", ~8 completion tokens. The call succeeds and returns nothing.
 *   Nemotron 3 Nano, reasoning_effort="high"  -> emits valid JSON for one field
 *     then degenerates into a whitespace loop, consuming the entire token
 *     budget (16k tokens / 71s observed) and finishing with "length".
 *   Nemotron 3 Nano, reasoning_effort="low"   -> correct, ~1.3s, ~250 tokens.
 *
 * So Nano is clamped to "low" regardless of what a caller asks for. Super and
 * Ultra are well-behaved at every level tested.
 */
function safeEffort(model: string, requested?: ReasoningEffort): ReasoningEffort | undefined {
  if (!/nano/i.test(model)) return requested;
  if (requested === "none" || requested === "high" || requested === "xhigh" || requested === "max") {
    return "low";
  }
  return requested ?? "low";
}

/** Nemotron reasoning budget. Token Factory exposes seven levels; we use the
 *  cheap end for high-fanout extraction and the expensive end for reconciliation. */
export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  role: Role;
  messages: ChatMessage[];
  /** JSON Schema for strict structured output. Strongly recommended over
   *  free-text parsing; every pipeline stage here uses it. */
  schema?: { name: string; schema: Record<string, unknown> };
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
  maxTokens?: number;
  /** Skip the disk cache for this call (used by "Run now" in the UI). */
  noCache?: boolean;
}

export interface ChatResult<T = unknown> {
  data: T;
  raw: string;
  model: string;
  /** Where the answer came from. Surfaced in the UI so the demo can honestly
   *  say "this one was cached" rather than pretending it was live. */
  source: "live" | "cache";
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function cacheKey(opts: ChatOptions): string {
  const material = JSON.stringify({
    role: opts.role,
    messages: opts.messages,
    schema: opts.schema?.name ?? null,
    reasoningEffort: opts.reasoningEffort ?? null,
    temperature: opts.temperature ?? null,
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

async function readCache<T>(key: string): Promise<ChatResult<T> | null> {
  try {
    const buf = await readFile(path.join(CACHE_DIR, `${key}.json`), "utf8");
    const hit = JSON.parse(buf) as ChatResult<T>;
    return { ...hit, source: "cache" };
  } catch {
    return null;
  }
}

async function writeCache(key: string, value: ChatResult): Promise<void> {
  if (process.env.NEBIUS_CACHE_WRITE !== "1") return;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      path.join(CACHE_DIR, `${key}.json`),
      JSON.stringify(value, null, 2),
    );
  } catch {
    // Read-only filesystem in production is expected; the committed cache is
    // what matters there.
  }
}

/** True when the failure means "try the next model" rather than "give up". */
function isModelUnavailable(status: number, body: string): boolean {
  if (status === 404) return true;
  if (status === 400 && /model/i.test(body) && /(not found|not exist|deprecat|unsupported|invalid)/i.test(body)) {
    return true;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Chat completion with strict JSON output, model fallback, and disk cache.
 *
 * Cache is consulted first so a demo click costs nothing and works offline.
 * On a live call, each model in the chain is tried in order; 429s are retried
 * with backoff, model-gone errors advance to the next model.
 */
export async function chat<T = unknown>(opts: ChatOptions): Promise<ChatResult<T>> {
  const key = cacheKey(opts);

  if (!opts.noCache) {
    const hit = await readCache<T>(key);
    if (hit) return hit;
  }

  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NEBIUS_API_KEY is not set and this call was not in data/cache. " +
        "Copy .env.example to .env.local and add your key.",
    );
  }

  const chain = modelChain(opts.role);
  let lastError = "";

  for (const model of chain) {
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0,
      max_tokens: opts.maxTokens ?? 4096,
    };
    const effort = safeEffort(model, opts.reasoningEffort);
    if (effort) body.reasoning_effort = effort;
    if (opts.schema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: opts.schema.name,
          schema: opts.schema.schema,
          strict: true,
        },
      };
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const json = await res.json();
        const raw: string = json.choices?.[0]?.message?.content ?? "";

        // Nano returns HTTP 200 with empty content at some reasoning_effort
        // levels, and degenerates into an unterminated whitespace loop on some
        // inputs even at "low". Both arrive as successful responses, so they
        // have to be caught here rather than by status code. Treat them like a
        // dead model and fall through to the next one in the chain.
        let data: T;
        if (opts.schema) {
          if (!raw.trim()) {
            lastError = `${model} returned empty content (finish_reason: ${json.choices?.[0]?.finish_reason})`;
            break;
          }
          try {
            data = JSON.parse(raw) as T;
          } catch {
            lastError = `${model} returned unparseable JSON (${raw.length} chars, finish_reason: ${json.choices?.[0]?.finish_reason})`;
            break;
          }
        } else {
          data = raw as T;
        }

        const result: ChatResult<T> = { data, raw, model, source: "live", usage: json.usage };
        await writeCache(key, result as ChatResult);
        return result;
      }

      const text = await res.text();
      lastError = `${res.status} ${text.slice(0, 300)}`;

      if (res.status === 429 || res.status >= 500) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      if (isModelUnavailable(res.status, text)) break; // next model in chain
      throw new Error(`Token Factory ${model}: ${lastError}`);
    }
  }

  throw new Error(
    `All models failed for role "${opts.role}" (chain: ${chain.join(", ")}). ` +
      `Last error: ${lastError}. Run \`npm run check:models\` to refresh the IDs in .env.local.`,
  );
}

/** Embeddings, used to retrieve candidate ledger rows rather than stuffing the
 *  whole ledger into context. Every Nemotron misreads exact facts past ~100k
 *  tokens, so retrieval is a correctness requirement here, not an optimization. */
export async function embed(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new Error("NEBIUS_API_KEY is not set");

  const chain = (process.env.MODEL_EMBED ?? "Qwen/Qwen3-Embedding-8B")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  let lastError = "";
  for (const model of chain) {
    const res = await fetch(`${BASE_URL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: texts }),
    });
    if (res.ok) {
      const json = await res.json();
      return json.data.map((d: { embedding: number[] }) => d.embedding);
    }
    const text = await res.text();
    lastError = `${res.status} ${text.slice(0, 200)}`;
    if (!isModelUnavailable(res.status, text)) {
      throw new Error(`Embeddings ${model}: ${lastError}`);
    }
  }
  throw new Error(`All embedding models failed. Last error: ${lastError}`);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
