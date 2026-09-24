#!/usr/bin/env python3
"""Turn raw RFC822 mail into the flat JSON shape the app reads.

One normalizer serves all three corpus sources, so the MIME work is written once:

  * Enron maildir (eval only, never committed)   -> --maildir evals/enron/maildir
  * Google Takeout .mbox (your own mail)         -> --mbox ~/Downloads/All\\ mail.mbox
  * hand-written fixtures                        -> already JSON, skips this

Output: {id, thread_id, from, to[], cc[], subject, date_iso, body_text}

Body text is aggressively cleaned - quoted replies and signatures stripped -
because a commitment extractor that reads a quoted reply will happily re-extract
a promise that was already logged three messages ago.

Usage:
  python3 scripts/normalize.py --maildir evals/enron/maildir --limit 400 -o evals/enron/messages.json
  python3 scripts/normalize.py --mbox "All mail.mbox" -o data/corpus/messages.json
"""

from __future__ import annotations

import argparse
import email
import email.policy
import hashlib
import json
import mailbox
import os
import re
import sys
from datetime import timezone
from email.utils import getaddresses, parsedate_to_datetime

# A quoted-reply header: "On Tue, Sep 8, 2026 at 9:14 AM Marcus <m@acme.com> wrote:"
QUOTE_HEADER = re.compile(
    r"^\s*(On .{6,120}wrote:|-{2,}\s*Original Message\s*-{2,}|From:\s.+)\s*$",
    re.IGNORECASE,
)
# Enron-era forward/reply separators.
ENRON_SEP = re.compile(r"^\s*-{3,}\s*Forwarded by .+$|^\s*={10,}\s*$", re.IGNORECASE)
SIGNATURE = re.compile(r"^\s*(--\s*|__{2,}|Sent from my \w+)\s*$")
WHITESPACE = re.compile(r"\n{3,}")


def clean_body(raw: str) -> str:
    """Drop quoted history and signatures, keeping only what this sender wrote."""
    lines = raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    kept: list[str] = []
    for line in lines:
        if QUOTE_HEADER.match(line) or ENRON_SEP.match(line) or SIGNATURE.match(line):
            break
        if line.lstrip().startswith(">"):
            continue
        kept.append(line.rstrip())
    return WHITESPACE.sub("\n\n", "\n".join(kept)).strip()


def best_text(msg: email.message.Message) -> str:
    """Prefer text/plain; fall back to a crude de-tagged text/html."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                try:
                    return part.get_content()
                except Exception:
                    payload = part.get_payload(decode=True) or b""
                    return payload.decode("utf-8", "replace")
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                payload = part.get_payload(decode=True) or b""
                html = payload.decode("utf-8", "replace")
                html = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
                return re.sub(r"(?s)<[^>]+>", " ", html)
        return ""
    try:
        return msg.get_content()
    except Exception:
        payload = msg.get_payload(decode=True) or b""
        return payload.decode("utf-8", "replace")


def addrs(msg: email.message.Message, header: str) -> list[str]:
    values = msg.get_all(header, [])
    return [a.lower() for _, a in getaddresses(values) if a]


def norm_subject(subject: str) -> str:
    return re.sub(r"(?i)^\s*((re|fwd?|aw|sv)\s*:\s*)+", "", subject or "").strip().lower()


def to_record(msg: email.message.Message, fallback_id: str) -> dict | None:
    body = clean_body(best_text(msg))
    if not body or len(body) < 20:
        return None  # nothing a commitment could live in

    try:
        dt = parsedate_to_datetime(msg.get("Date", ""))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        date_iso = dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return None  # an undated commitment cannot be overdue, so it is useless here

    # Thread on the normalized subject first. Threading on References instead
    # splits a conversation in two: the root message has no References header,
    # so it would hash differently from every reply to it.
    refs = (msg.get("References", "") + " " + msg.get("In-Reply-To", "")).split()
    thread_seed = norm_subject(msg.get("Subject", "")) or (refs[0] if refs else fallback_id)

    sender = addrs(msg, "From")
    return {
        "id": (msg.get("Message-ID") or fallback_id).strip("<> "),
        "thread_id": hashlib.sha1(thread_seed.encode("utf-8", "replace")).hexdigest()[:16],
        "from": sender[0] if sender else "",
        "to": addrs(msg, "To"),
        "cc": addrs(msg, "Cc"),
        "subject": (msg.get("Subject") or "").strip(),
        "date_iso": date_iso,
        "body_text": body[:8000],
    }


def from_maildir(root: str, limit: int) -> list[dict]:
    out: list[dict] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in sorted(filenames):
            if len(out) >= limit:
                return out
            path = os.path.join(dirpath, name)
            try:
                with open(path, "rb") as fh:
                    msg = email.message_from_binary_file(fh, policy=email.policy.default)
            except Exception:
                continue
            rec = to_record(msg, fallback_id=os.path.relpath(path, root))
            if rec:
                out.append(rec)
    return out


def from_mbox(path: str, limit: int) -> list[dict]:
    out: list[dict] = []
    box = mailbox.mbox(path, factory=None)
    for i, msg in enumerate(box):
        if len(out) >= limit:
            break
        # mailbox returns legacy Message objects; reparse under the modern policy
        # so get_content() handles encodings properly.
        try:
            msg = email.message_from_bytes(msg.as_bytes(), policy=email.policy.default)
        except Exception:
            continue
        rec = to_record(msg, fallback_id=f"mbox-{i}")
        if rec:
            out.append(rec)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--maildir", help="directory tree of raw RFC822 files (Enron)")
    src.add_argument("--mbox", help="path to an .mbox file (Google Takeout)")
    ap.add_argument("-o", "--out", required=True, help="output JSON path")
    ap.add_argument("--limit", type=int, default=1000, help="max messages to emit")
    args = ap.parse_args()

    if args.maildir:
        records = from_maildir(args.maildir, args.limit)
    else:
        records = from_mbox(args.mbox, args.limit)

    records.sort(key=lambda r: r["date_iso"])
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(records, fh, indent=2, ensure_ascii=False)

    if not records:
        print("No usable messages found. Check the source path.", file=sys.stderr)
        return 1

    threads = len({r["thread_id"] for r in records})
    print(f"{len(records)} messages across {threads} threads -> {args.out}")
    print(f"date range: {records[0]['date_iso'][:10]} .. {records[-1]['date_iso'][:10]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
