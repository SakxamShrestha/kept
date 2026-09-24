#!/usr/bin/env python3
"""Fetch a slice of the public Enron corpus for the extraction eval.

Why real mail and not our own fixtures: an LLM-written test mailbox is easy for
an LLM to parse, so precision measured on it is flattering and meaningless. Real
business email is full of conditional offers, rhetorical near-promises, and
renegotiations - which is exactly what the extractor has to get right.

The corpus is licensed for non-commercial research use, so it is fetched to
evals/enron/ (gitignored) and NEVER committed. This repo is Apache-2.0.

The archive is ~423MB. We stream it and stop as soon as we have enough
messages, so a small --limit finishes in well under a full download.

Usage:
  python3 scripts/fetch_enron.py --limit 400
  python3 scripts/normalize.py --maildir evals/enron/maildir --limit 400 \
      -o evals/enron/messages.json
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import tarfile
import urllib.request

URL = "https://www.cs.cmu.edu/~enron/enron_mail_20150507.tar.gz"
DEST = os.path.join("evals", "enron")

# Both directions matter: sent_items holds promises the owner made, inbox holds
# promises made to them. A ledger that only reads one folder only sees half.
WANTED = ("/sent_items/", "/sent/", "/inbox/")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=400, help="messages to extract")
    ap.add_argument("--url", default=URL)
    ap.add_argument("--dest", default=DEST)
    args = ap.parse_args()

    maildir = os.path.join(args.dest, "maildir")
    os.makedirs(maildir, exist_ok=True)

    print(f"Streaming {args.url}\nStopping after {args.limit} messages from {', '.join(WANTED)}\n")

    extracted = 0
    scanned = 0
    try:
        with urllib.request.urlopen(args.url) as resp:
            # Stream-mode tar: sequential access only, which is what lets us
            # bail out early instead of downloading all 423MB.
            with tarfile.open(fileobj=resp, mode="r|gz") as tar:
                for member in tar:
                    scanned += 1
                    if scanned % 20000 == 0:
                        print(f"  scanned {scanned} entries, kept {extracted}", file=sys.stderr)
                    if not member.isfile():
                        continue
                    if not any(w in member.name for w in WANTED):
                        continue

                    fh = tar.extractfile(member)
                    if fh is None:
                        continue
                    data = fh.read()
                    if len(data) < 200:
                        continue

                    # Flatten user/folder/123 -> user__folder__123 so the
                    # normalizer's directory walk stays cheap.
                    flat = member.name.split("maildir/", 1)[-1].replace("/", "__")
                    with open(os.path.join(maildir, flat), "wb") as out:
                        out.write(data)

                    extracted += 1
                    if extracted >= args.limit:
                        break
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
    except Exception as exc:
        print(f"\nDownload failed: {exc}", file=sys.stderr)
        print(
            "Mirrors if CMU is down:\n"
            "  https://archive.org/details/2011_04_02_enron_email_dataset\n"
            "  https://www.kaggle.com/datasets/wcukierski/enron-email-dataset\n"
            "Download manually, then point the normalizer at the extracted maildir.",
            file=sys.stderr,
        )
        return 1

    if extracted == 0:
        print("Nothing extracted.", file=sys.stderr)
        return 1

    print(f"\n{extracted} raw messages -> {maildir}")
    print(f"Next:\n  python3 scripts/normalize.py --maildir {maildir} --limit {args.limit} -o {os.path.join(args.dest, 'messages.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
