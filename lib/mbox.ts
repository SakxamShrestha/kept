/**
 * Client-side `.mbox` parsing — bring your own mail.
 *
 * This is a TypeScript port of `scripts/normalize.py`, and the port has to be
 * faithful rather than merely similar: both paths feed the same extractor, so a
 * message normalized in the browser must come out byte-identical to the same
 * message normalized on the server. Where the two could plausibly diverge —
 * quote stripping, subject normalization, the SHA-1 thread key, the ISO date
 * format — this file matches Python's behaviour deliberately, including its
 * quirks. Comments call out each of those places.
 *
 * Why it runs in the browser at all: a Google Takeout mailbox is the single
 * most sensitive file most people own. Parsing it here means it never leaves
 * the machine, there is no upload endpoint to secure, no payload limit to hit,
 * and no server-side copy to delete afterwards. "Your data stays under your
 * control" is then a fact about the architecture rather than a promise in a
 * privacy policy.
 *
 * Everything here is pure and isomorphic except `parseMboxFile`, which needs a
 * `Blob`. The file is read as a stream of bytes and cut into messages as they
 * arrive, so a 4 GB Takeout does not have to be held in memory to read the
 * first 200 messages out of it.
 */

import PostalMime, { type Address, type Email } from "postal-mime";
// Type-only: erased at compile time, so the client bundle never pulls in
// lib/extract.ts (which reaches node:crypto through lib/nebius.ts).
import type { Message } from "./extract";

export type { Message };

/**
 * Hard cap on messages taken from an uploaded mailbox. Every message costs a
 * Nano gate call and possibly a Super extraction call downstream, and this is a
 * demo, not an ingestion service.
 */
export const MAX_MESSAGES = 200;

/**
 * Upper bound on messages *scanned*, as opposed to kept. A Takeout archive is
 * mostly newsletters and receipts, all of which are dropped for having no
 * usable body; without this bound a mailbox with no qualifying mail in it would
 * read to the end of the file before reporting nothing.
 */
const MAX_SCANNED = 5000;

// ---------------------------------------------------------------- text cleanup

/**
 * A quoted-reply header: "On Tue, Sep 8, 2026 at 9:14 AM Marcus <m@acme.com> wrote:"
 *
 * Port note: Python's `re.match` anchors at the start only, but the pattern
 * itself ends in `$`, so it is a full-line match either way. `.` excludes
 * newlines in both languages and these are tested one line at a time.
 */
const QUOTE_HEADER =
  /^\s*(On .{6,120}wrote:|-{2,}\s*Original Message\s*-{2,}|From:\s.+)\s*$/i;

/** Enron-era forward/reply separators. */
const ENRON_SEP = /^\s*-{3,}\s*Forwarded by .+$|^\s*={10,}\s*$/i;

/** `__{2,}` is three-or-more underscores in Python too — one, then two more. */
const SIGNATURE = /^\s*(--\s*|__{2,}|Sent from my \w+)\s*$/;

const BLANK_RUN = /\n{3,}/g;

/**
 * Drop quoted history and signatures, keeping only what this sender wrote.
 *
 * This is not cosmetic. A commitment extractor that reads quoted reply history
 * happily re-extracts a promise that was already logged three messages ago, and
 * the ledger then shows the same obligation twice with two different dates —
 * which is exactly the kind of error that makes a ledger untrustworthy.
 */
export function cleanBody(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (QUOTE_HEADER.test(line) || ENRON_SEP.test(line) || SIGNATURE.test(line)) {
      break;
    }
    if (line.replace(/^\s+/, "").startsWith(">")) continue;
    kept.push(line.replace(/\s+$/, "")); // Python's str.rstrip()
  }
  return kept.join("\n").replace(BLANK_RUN, "\n\n").trim();
}

/** "Re: Fwd: Vendor shortlist" -> "vendor shortlist". */
export function normalizeSubject(subject: string): string {
  return (subject || "")
    .replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}

/**
 * Prefer text/plain; fall back to a crude de-tagged text/html.
 *
 * postal-mime has already decoded transfer encodings and charsets per part, so
 * unlike the Python version there is no second decode step here.
 *
 * One deliberate divergence from `normalize.py`: that script only de-tags HTML
 * reached through the multipart walk, so a single-part `text/html` message
 * falls through to `get_content()` and lands in the corpus as raw markup. This
 * de-tags both. Feeding `<div style=...>` to the extractor wastes context and
 * puts tag soup inside evidence quotes, and quote grounding then fails on rows
 * that are perfectly real. The record shape, the quote/signature stripping and
 * the thread key are all still identical — verified by diffing this parser's
 * output against `normalize.py` over the same mbox.
 */
function bestText(email: Email): string {
  if (email.text && email.text.trim()) return email.text;
  if (email.html) {
    return email.html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }
  return "";
}

// ---------------------------------------------------------------- sha1

/**
 * SHA-1 over UTF-8 bytes, hex encoded.
 *
 * Hand-rolled rather than `crypto.subtle.digest`, for two reasons: the Web
 * Crypto version is only available in a secure context (so a plain-http preview
 * build would throw), and it is async, which would push an await into the
 * middle of the hot parse loop for no benefit. The output is checked against
 * Python's `hashlib.sha1` — thread IDs have to match across the two
 * normalizers or the same thread splits in two depending on where it was
 * parsed.
 */
export function sha1Hex(text: string): string {
  const msg = new TextEncoder().encode(text);
  const ml = msg.length;
  const padded = new Uint8Array((((ml + 8) >> 6) + 1) << 6);
  padded.set(msg);
  padded[ml] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(ml / 0x20000000), false);
  view.setUint32(padded.length - 4, ((ml % 0x20000000) << 3) >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (n << 1) | (n >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = t;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
}

// ---------------------------------------------------------------- record shape

/** Flatten `Address[]`, which may contain RFC 5322 groups, to lowercase addresses. */
function addresses(list: Address[] | undefined): string[] {
  const out: string[] = [];
  for (const entry of list ?? []) {
    if (entry.address) out.push(entry.address.toLowerCase());
    else for (const member of entry.group ?? []) {
      if (member.address) out.push(member.address.toLowerCase());
    }
  }
  return out;
}

/**
 * Python emits `datetime.isoformat()` on a UTC-aware datetime, which is
 * `2001-05-29T16:00:00+00:00` — not `Z`, and not `.000`. Matching it exactly
 * keeps a browser-parsed corpus diff-clean against a server-parsed one.
 */
function isoUtc(d: Date): string {
  const p = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+00:00`
  );
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  let d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d;
  // "Tue, 5 Jun 2001 17:48:00 -0700 (PDT)" — the trailing comment is legal
  // RFC 5322 and Python's parser drops it. Some engines choke on it.
  d = new Date(value.replace(/\s*\([^)]*\)\s*$/, ""));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Python's `str.strip("<> ")` — a character set, not a prefix. */
function stripAngles(s: string): string {
  return s.replace(/^[<> ]+/, "").replace(/[<> ]+$/, "");
}

export type SkipReason = "no_body" | "no_date" | "unparseable";

/**
 * Build the flat record the rest of the app reads, or explain why not.
 *
 * Both rejection rules are deliberate and match `normalize.py`:
 *   - a body under 20 characters has nowhere for a commitment to live;
 *   - an undated message can never be overdue, so a ledger row built from it
 *     could never do anything useful.
 */
export function toRecord(email: Email, fallbackId: string): Message | SkipReason {
  const body = cleanBody(bestText(email));
  if (!body || body.length < 20) return "no_body";

  const date = parseDate(email.date);
  if (!date) return "no_date";

  // Thread on the normalized subject first. Threading on References instead
  // splits a conversation in two: the root message has no References header, so
  // it hashes differently from every reply to it — the thread ends up detached
  // from the message that started it, which is the one carrying the original
  // promise.
  const refs = `${email.references ?? ""} ${email.inReplyTo ?? ""}`.split(/\s+/).filter(Boolean);
  const threadSeed = normalizeSubject(email.subject ?? "") || refs[0] || fallbackId;

  const from = email.from?.address?.toLowerCase() ?? "";

  return {
    id: stripAngles((email.messageId ?? fallbackId).trim()),
    thread_id: sha1Hex(threadSeed).slice(0, 16),
    from,
    to: addresses(email.to),
    cc: addresses(email.cc),
    subject: (email.subject ?? "").trim(),
    date_iso: isoUtc(date),
    body_text: body.slice(0, 8000),
  };
}

// ---------------------------------------------------------------- mbox framing

const FROM_LINE = [0x46, 0x72, 0x6f, 0x6d, 0x20]; // "From "

/**
 * An mbox message boundary: the literal bytes `From ` at the very start of a
 * line. This is the same naive rule Python's `mailbox.mbox` uses, including its
 * known weakness — a body line beginning "From " splits a message in two.
 * Matching the weakness is the point: `>From `-escaped lines are deliberately
 * *not* unescaped here either, because `cleanBody` drops every `>`-prefixed
 * line anyway and unescaping would make the two normalizers disagree.
 */
function isBoundary(buf: Uint8Array, i: number): boolean {
  if (i !== 0 && buf[i - 1] !== 0x0a) return false;
  for (let k = 0; k < FROM_LINE.length; k++) {
    if (buf[i + k] !== FROM_LINE[k]) return false;
  }
  return true;
}

/** Drop the `From ` envelope line; it is not a header and postal-mime would choke. */
function stripEnvelope(bytes: Uint8Array): Uint8Array {
  if (!isBoundary(bytes, 0)) return bytes;
  const nl = bytes.indexOf(0x0a);
  return nl === -1 ? bytes.subarray(0, 0) : bytes.subarray(nl + 1);
}

export interface ParseStats {
  /** Messages the framer found before it stopped. */
  scanned: number;
  /** Messages that produced a usable record. */
  kept: number;
  /** Dropped for having no body, or one too short to hold a commitment. */
  skippedNoBody: number;
  /** Dropped for an unparseable or missing Date header. */
  skippedNoDate: number;
  /** Dropped because the MIME structure could not be parsed at all. */
  skippedUnparseable: number;
  /** True when the cap stopped the read before the end of the file. */
  truncated: boolean;
  threads: number;
  dateFrom: string | null;
  dateTo: string | null;
  bytesRead: number;
}

export interface ParseResult {
  messages: Message[];
  stats: ParseStats;
}

export interface ParseOptions {
  limit?: number;
  /** Called as messages are kept, so a large file can show progress. */
  onProgress?: (kept: number, scanned: number) => void;
  signal?: AbortSignal;
}

function summarize(messages: Message[], partial: Omit<ParseStats, "threads" | "dateFrom" | "dateTo" | "kept">): ParseResult {
  messages.sort((a, b) => a.date_iso.localeCompare(b.date_iso));
  return {
    messages,
    stats: {
      ...partial,
      kept: messages.length,
      threads: new Set(messages.map((m) => m.thread_id)).size,
      dateFrom: messages.length ? messages[0].date_iso.slice(0, 10) : null,
      dateTo: messages.length ? messages[messages.length - 1].date_iso.slice(0, 10) : null,
    },
  };
}

/** Read window. Chosen over `Blob.stream()` because stream chunk sizes are an
 *  implementation detail — Node hands back the entire blob in one chunk, which
 *  would defeat the early stop below. A fixed slice size behaves the same
 *  everywhere. */
const CHUNK_BYTES = 1 << 20;

/**
 * Parse an `.mbox` from a `Blob`, incrementally.
 *
 * The file is read a window at a time and cut into messages as the bytes
 * arrive, and the read stops as soon as the cap is met. A Google Takeout
 * mailbox is routinely several gigabytes; reading it whole to take 200
 * messages off the front would be slow at best and an out-of-memory crash on a
 * laptop at worst.
 *
 * Raw bytes are passed to postal-mime rather than a decoded string, so each
 * part is decoded with the charset its own headers declare. Decoding the whole
 * file as UTF-8 first would mangle every legacy Latin-1 message in an old
 * archive.
 */
export async function parseMboxFile(
  file: Blob,
  opts: ParseOptions = {},
): Promise<ParseResult> {
  const limit = opts.limit ?? MAX_MESSAGES;
  const messages: Message[] = [];

  let scanned = 0;
  let skippedNoBody = 0;
  let skippedNoDate = 0;
  let skippedUnparseable = 0;
  let bytesRead = 0;
  let stopped = false;

  const take = async (raw: Uint8Array): Promise<void> => {
    scanned++;
    const body = stripEnvelope(raw);
    if (body.length === 0) return;

    let email: Email;
    try {
      // A fresh copy: postal-mime may retain the buffer, and ours is about to
      // be compacted underneath it.
      email = await PostalMime.parse(new Uint8Array(body));
    } catch {
      skippedUnparseable++;
      return;
    }

    const rec = toRecord(email, `mbox-${scanned - 1}`);
    if (rec === "no_body") skippedNoBody++;
    else if (rec === "no_date") skippedNoDate++;
    else if (rec === "unparseable") skippedUnparseable++;
    else {
      messages.push(rec);
      opts.onProgress?.(messages.length, scanned);
    }
  };

  let buf = new Uint8Array(0);
  let msgStart = -1;
  let scanPos = 0;
  let checkedHeader = false;
  let offset = 0;

  for (;;) {
    if (opts.signal?.aborted) {
      stopped = true;
      break;
    }
    if (offset >= file.size) break;

    const windowEnd = Math.min(offset + CHUNK_BYTES, file.size);
    const value = new Uint8Array(await file.slice(offset, windowEnd).arrayBuffer());
    offset = windowEnd;

    bytesRead += value.length;
    const merged = new Uint8Array(buf.length + value.length);
    merged.set(buf);
    merged.set(value, buf.length);
    buf = merged;

    // A real mbox opens with a `From ` envelope line. Checking once, up
    // front, turns "someone picked the wrong file" into a sentence instead of
    // a silent read of several gigabytes that reports zero messages.
    if (!checkedHeader && buf.length >= FROM_LINE.length) {
      checkedHeader = true;
      if (!isBoundary(buf, 0)) {
        throw new Error(
          'This does not look like an .mbox file — an mbox begins with a "From " line. ' +
            "Google Takeout gives you one .mbox per label under Mail.",
        );
      }
    }

    // Scan for boundaries. The final four bytes are left unscanned because a
    // boundary could straddle the chunk edge.
    const end = buf.length - FROM_LINE.length;
    for (let i = scanPos; i <= end; i++) {
      if (!isBoundary(buf, i)) continue;
      if (msgStart >= 0) await take(buf.subarray(msgStart, i));
      msgStart = i;
      if (messages.length >= limit || scanned >= MAX_SCANNED) {
        stopped = true;
        break;
      }
    }
    scanPos = Math.max(0, end + 1);

    if (stopped) break;

    // Compact: nothing before the current message start is needed again, so
    // the buffer stays roughly one message plus one chunk regardless of how
    // large the file is.
    if (msgStart > 0) {
      buf = buf.slice(msgStart);
      scanPos = Math.max(0, scanPos - msgStart);
      msgStart = 0;
    }
  }

  // The tail: the last message has no boundary after it.
  if (!stopped && msgStart >= 0 && messages.length < limit) {
    await take(buf.subarray(msgStart));
  }

  return summarize(messages, {
    scanned,
    skippedNoBody,
    skippedNoDate,
    skippedUnparseable,
    truncated: stopped,
    bytesRead,
  });
}

/**
 * String entry point. Convenient for tests and small pasted fixtures; the file
 * picker uses `parseMboxFile` so it never materializes a whole Takeout in
 * memory.
 */
export async function parseMboxText(
  text: string,
  opts: ParseOptions = {},
): Promise<ParseResult> {
  return parseMboxFile(new Blob([new TextEncoder().encode(text)]), opts);
}
