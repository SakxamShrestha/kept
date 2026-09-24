/**
 * Stage 0 of the cascade: a cheap binary "does this message contain any
 * commitment at all?" before the expensive structured extraction runs.
 *
 * Day 1 measured Nano at ~60% precision on full extraction versus Super's ~95%,
 * because Nano cannot hold the negative constraints the task is made of. But
 * its failure mode is over-extraction, and over-extraction is exactly what you
 * want from stage 1 of a cascade: high recall, cheap, with a precise model
 * behind it. Only ~11% of real messages contain a commitment, so most Super
 * calls are spent confirming there is nothing there.
 *
 * The asymmetry drives the prompt: a false yes costs one Super call, a false no
 * loses a commitment permanently. When unsure, say yes.
 */

import { chat } from "./nebius";
import type { Message } from "./extract";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["has_commitment"],
  properties: {
    has_commitment: {
      type: "boolean",
      description: "true if any sentence might be someone promising to do something",
    },
  },
} as const;

const SYSTEM = `Does this email contain ANY sentence where someone says they will do
something in the future? Answer true or false.

Say TRUE for anything resembling a promise, even a weak or conditional one:
  "I'll send it Friday" / "we'll take a look" / "I can get you that next week"

Say FALSE only when the email clearly contains nothing of the kind: pure
acknowledgements, forwarded articles, meeting invitations, automated notices,
questions with no answer attached.

When you are unsure, say TRUE. Missing a commitment is far worse than flagging
an email that turns out to have none - a later, more careful model re-reads
everything you pass through, but nothing re-reads what you reject.`;

export async function shouldExtract(
  msg: Message,
  opts: { noCache?: boolean } = {},
): Promise<{ hasCommitment: boolean; model: string }> {
  try {
    const res = await chat<{ has_commitment: boolean }>({
      role: "gate",
      reasoningEffort: "low",
      maxTokens: 512,
      noCache: opts.noCache,
      schema: { name: "gate", schema: SCHEMA as unknown as Record<string, unknown> },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `From: ${msg.from}\nSubject: ${msg.subject}\n\n${msg.body_text.slice(0, 4000)}`,
        },
      ],
    });
    return { hasCommitment: res.data.has_commitment !== false, model: res.model };
  } catch {
    // A broken gate must never silently drop mail. Fail open: send it on to the
    // precise model and pay for the call.
    return { hasCommitment: true, model: "gate-failed-open" };
  }
}
