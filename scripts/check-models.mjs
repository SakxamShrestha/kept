#!/usr/bin/env node
/**
 * Day 0 gate. Run this before writing any pipeline code.
 *
 * The Token Factory docs currently mention zero Nemotron models and are stale
 * relative to the catalog, so `GET /v1/models?verbose=true` on your own account
 * is the only authoritative source for:
 *   - the exact Nemotron model IDs
 *   - whether each one supports tool calling and structured JSON output
 *
 * Usage:  npm run check:models
 */

const BASE_URL = (
  process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1"
).replace(/\/+$/, "");

const key = process.env.NEBIUS_API_KEY;
if (!key) {
  console.error(
    "NEBIUS_API_KEY is not set.\n" +
      "  cp .env.example .env.local   then paste your key\n" +
      "  Get one at https://tokenfactory.nebius.com\n" +
      "  Claim hackathon credits first: https://nebiusglobalaihackathon.devpost.com/resources",
  );
  process.exit(1);
}

const res = await fetch(`${BASE_URL}/models?verbose=true`, {
  headers: { Authorization: `Bearer ${key}` },
});

if (!res.ok) {
  console.error(`GET /models failed: ${res.status}\n${await res.text()}`);
  process.exit(1);
}

const { data = [] } = await res.json();
console.log(`${data.length} models visible on this account.\n`);

const features = (m) => {
  const f = m.supported_features ?? m.features ?? [];
  return Array.isArray(f) ? f : Object.keys(f).filter((k) => f[k]);
};
const has = (m, re) => features(m).some((f) => re.test(String(f)));

const show = (m) => {
  const ctx = m.context_length ?? m.max_context_length ?? m.context_window ?? "?";
  const flags = [
    has(m, /tool|function/i) ? "tools" : null,
    has(m, /json|structured/i) ? "json" : null,
    has(m, /reasoning/i) ? "reasoning" : null,
    has(m, /vision|image|audio|omni|multimodal/i) ? "multimodal" : null,
  ].filter(Boolean);
  console.log(
    `  ${m.id.padEnd(48)} ctx=${String(ctx).padEnd(9)} ${flags.join(",") || "(no feature flags reported)"}`,
  );
};

const nvidia = data.filter((m) => /nvidia|nemotron/i.test(m.id));
const embedding = data.filter((m) => /embed/i.test(m.id));
const rerank = data.filter((m) => /rerank/i.test(m.id));

console.log("NVIDIA / Nemotron:");
nvidia.length ? nvidia.forEach(show) : console.log("  none found - check your account region");
console.log("\nEmbeddings:");
embedding.forEach(show);
console.log("\nRerankers:");
rerank.forEach(show);

// Suggest env lines using whatever actually exists, smallest-first for
// extraction and largest-first for reconciliation.
const pick = (re) => nvidia.filter((m) => re.test(m.id)).map((m) => m.id);
const nano = pick(/nano(?!.*omni)/i);
const omni = pick(/omni/i);
const super_ = pick(/super/i);
const ultra = pick(/ultra/i);

const chain = (...groups) => groups.flat().filter(Boolean).join(",");
const extract = chain(nano, super_);
const reconcile = chain(super_, ultra, nano);

if (extract || reconcile) {
  console.log("\nPaste into .env.local:\n");
  if (extract) console.log(`MODEL_EXTRACT=${extract}`);
  if (reconcile) console.log(`MODEL_RECONCILE=${reconcile}`);
  if (embedding.length) console.log(`MODEL_EMBED=${embedding.map((m) => m.id).join(",")}`);
  if (rerank.length) console.log(`MODEL_RERANK=${rerank.map((m) => m.id).join(",")}`);
}

if (omni.length) {
  console.log(`\nNano Omni is available (${omni[0]}) if you later want attachment OCR.`);
}

const unclear = nvidia.filter((m) => !has(m, /json|structured/i));
if (unclear.length) {
  console.log(
    `\nNote: ${unclear.length} NVIDIA model(s) report no JSON/structured-output flag.\n` +
      "Verify with a real strict-schema call before building on them:\n" +
      "  npm run check:json",
  );
}
