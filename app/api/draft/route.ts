/**
 * POST /api/draft — generate a chase for one ledger row.
 *
 * This is the first runtime Token Factory call in the project. Everything before
 * it happened at build time: the ledger is a committed artifact and every screen
 * renders from disk with no API key. That was deliberate, and it stays true for
 * the ledger - but a judge clicking through the demo should be able to watch a
 * Nemotron call happen, and this is where it happens.
 *
 * All the work is already in lib/draft.ts. This route is the thin part: validate
 * the input, call it, and hand back the result including the parts the UI would
 * rather not show.
 *
 * Nothing sends. There is no send path anywhere in this project, so the response
 * is a draft the viewer can edit and copy, and the Access screen's "draft only"
 * default is true rather than decorative.
 */

import { generateDraft, prepareDraft, type DraftPlaybook } from "@/lib/draft";
import { loadLedger } from "@/lib/ledger";

/** The playbook arrives from the client because the viewer can edit it - the
 *  prompt is partly user-authored at request time, which is the point of the
 *  Skills screen. So it is validated here rather than trusted. */
function readPlaybook(value: unknown): DraftPlaybook | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string).trim() : "");

  const id = str("id");
  const name = str("name");
  const tone = str("tone");
  const instruction = str("instruction");
  if (!id || !name || !instruction) return null;

  // Capped because this text goes straight into the system turn. A runaway
  // instruction would push the evidence quotes out of the model's attention,
  // and the quotes are the only reason a chase is trustworthy.
  return {
    id: id.slice(0, 64),
    name: name.slice(0, 120),
    tone: tone.slice(0, 240),
    instruction: instruction.slice(0, 2000),
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { rowId, playbook } = (body ?? {}) as { rowId?: unknown; playbook?: unknown };

  if (typeof rowId !== "string" || !rowId.trim()) {
    return Response.json({ error: "rowId is required." }, { status: 400 });
  }

  const pb = readPlaybook(playbook);
  if (!pb) {
    return Response.json(
      { error: "playbook must carry an id, a name and an instruction." },
      { status: 400 },
    );
  }

  // Checked against the committed ledger before prepareDraft, which throws on a
  // miss. A 404 is the honest answer for a row that does not exist; a 500 is not.
  const rows = await loadLedger();
  const row = rows.find((r) => r.id === rowId);
  if (!row) {
    return Response.json({ error: `No ledger row "${rowId}".` }, { status: 404 });
  }

  try {
    const input = await prepareDraft(rowId, pb);
    const result = await generateDraft(input);

    // `quoted` is returned as-is. A draft that does not carry its receipt is
    // still shown - the UI says so - because hiding it would mean presenting an
    // ungrounded chase as if it had evidence behind it.
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // A missing key is the expected failure in a judging window months after
    // submission, and it deserves a readable answer rather than a stack trace.
    const noKey = /NEBIUS_API_KEY/.test(message);
    return Response.json(
      {
        error: noKey
          ? "This draft was not in the committed cache and there is no API key to generate it live."
          : message,
        rowId,
        playbook: pb.id,
      },
      { status: noKey ? 503 : 500 },
    );
  }
}
