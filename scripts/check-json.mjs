#!/usr/bin/env node
/**
 * Second half of the Day 0 gate: prove that strict structured output and the
 * reasoning_effort dial actually work on the Nemotron models this account has,
 * using a commitment-extraction prompt shaped like the real pipeline.
 *
 * If strict json_schema fails on every model, the whole design changes - you
 * would fall back to json_object plus validation. Better to learn that in
 * minute five than on day four.
 *
 * Usage:  npm run check:json
 */

const BASE_URL = (
  process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1"
).replace(/\/+$/, "");

const key = process.env.NEBIUS_API_KEY;
if (!key) {
  console.error("NEBIUS_API_KEY is not set. cp .env.example .env.local and add your key.");
  process.exit(1);
}

const SAMPLE = `From: marcus@acme.com
Date: Fri, 12 Sep 2026 09:14:00 -0700
Subject: Re: vendor shortlist

Thanks for the walkthrough yesterday. I'll get you the full vendor list by
end of day Friday so you can start scoring them. Happy to loop in Priya as
well if that's useful. Let's maybe sync sometime next month about the
renewal.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["commitments"],
  properties: {
    commitments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["direction", "counterparty", "what", "due_text", "confidence", "evidence_quote"],
        properties: {
          direction: { type: "string", enum: ["owed_by_me", "owed_to_me"] },
          counterparty: { type: "string" },
          what: { type: "string" },
          due_text: { type: "string" },
          confidence: { type: "number" },
          evidence_quote: { type: "string" },
        },
      },
    },
  },
};

const PROMPT = `Extract only FIRM commitments - a specific thing someone committed to do.
Do NOT extract conditional offers ("happy to X if useful") or vague intentions
("let's maybe sync sometime"). The mailbox owner is the recipient.
Quote the exact sentence from the message as evidence_quote.

MESSAGE:
${SAMPLE}`;

async function tryModel(model, effort) {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 2048,
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: [{ role: "user", content: PROMPT }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "commitments", schema: SCHEMA, strict: true },
      },
    }),
  });

  const ms = Date.now() - started;
  if (!res.ok) {
    return { ok: false, ms, error: `${res.status} ${(await res.text()).slice(0, 200)}` };
  }
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(raw);
    return { ok: true, ms, parsed, usage: json.usage };
  } catch {
    return { ok: false, ms, error: `unparseable: ${raw.slice(0, 200)}` };
  }
}

const chains = {
  extract: (process.env.MODEL_EXTRACT ?? "nvidia/nemotron-3-nano-30b-a3b").split(","),
  reconcile: (process.env.MODEL_RECONCILE ?? "nvidia/nemotron-3-super-120b-a12b").split(","),
};

const efforts = [undefined, "none", "high"];
let anySuccess = false;

for (const [role, chain] of Object.entries(chains)) {
  for (const model of chain.map((m) => m.trim()).filter(Boolean)) {
    console.log(`\n=== ${role}: ${model} ===`);
    for (const effort of efforts) {
      const label = `reasoning_effort=${effort ?? "(omitted)"}`;
      const r = await tryModel(model, effort);
      if (!r.ok) {
        console.log(`  ${label.padEnd(30)} FAIL  ${r.error}`);
        continue;
      }
      anySuccess = true;
      const n = r.parsed.commitments?.length ?? 0;
      const firm = r.parsed.commitments?.map((c) => c.what).join(" | ") ?? "";
      console.log(
        `  ${label.padEnd(30)} ok    ${r.ms}ms  ${n} commitment(s)  ${
          r.usage ? `${r.usage.completion_tokens}tok` : ""
        }`,
      );
      if (n) console.log(`  ${" ".repeat(30)}       ${firm}`);
    }
  }
}

console.log(
  "\nExpected on a correct run: exactly 1 commitment (the vendor list).\n" +
    "If a model also returns the Priya offer or the 'maybe sync', that is the\n" +
    "precision problem the Day 1 eval measures - tighten the prompt, do not\n" +
    "loosen the definition.",
);

if (!anySuccess) {
  console.error("\nNo model accepted strict json_schema. Retry with response_format.type=json_object and validate client-side.");
  process.exit(1);
}
