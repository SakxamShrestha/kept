/**
 * Build the committed demo corpus from the hand-authored seed threads.
 *
 * The narrative beats are hand-written rather than generated because the demo
 * depends on exact dates and exact wording - "Marcus promised the vendor list by
 * end of day Friday" has to still say that after every rebuild, or the money
 * shot stops landing. Generated filler can pad the volume; it cannot carry the
 * story.
 *
 * Output is data/corpus/messages.json in the same shape scripts/normalize.py
 * emits, so the demo corpus, a Google Takeout .mbox, and the Enron eval set are
 * interchangeable downstream.
 *
 * Usage:
 *   npx tsx scripts/build-corpus.mts
 *   npx tsx scripts/build-corpus.mts --filler 40   # pad with generated threads
 */

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Message } from "../lib/extract";

interface SeedMessage {
  from: string;
  to: string[];
  date: string;
  body: string;
}
interface SeedThread {
  id: string;
  subject: string;
  beat: string;
  messages: SeedMessage[];
}
interface Seed {
  owner: { name: string; email: string; role: string };
  today: string;
  people: { name: string; email: string; org: string; note: string }[];
  threads: SeedThread[];
}

const SEED_PATH = "data/corpus/threads.seed.json";
const OUT_PATH = "data/corpus/messages.json";
const META_PATH = "data/corpus/meta.json";

const seed: Seed = JSON.parse(await readFile(SEED_PATH, "utf8"));

const messages: Message[] = [];

for (const thread of seed.threads) {
  const threadId = createHash("sha1").update(thread.id).digest("hex").slice(0, 16);
  thread.messages.forEach((m, i) => {
    // Replies carry "Re:" so the corpus looks like real mail and the
    // subject-based threading in normalize.py would group it the same way.
    const subject = i === 0 ? thread.subject : `Re: ${thread.subject.replace(/^Re:\s*/i, "")}`;
    messages.push({
      id: `${thread.id}-${i}@okaforconsulting.com`,
      thread_id: threadId,
      from: m.from,
      to: m.to,
      cc: [],
      subject,
      date_iso: new Date(m.date).toISOString(),
      body_text: m.body.trim(),
    });
  });
}

messages.sort((a, b) => a.date_iso.localeCompare(b.date_iso));

await writeFile(OUT_PATH, JSON.stringify(messages, null, 2));
await writeFile(
  META_PATH,
  JSON.stringify(
    {
      owner: seed.owner,
      today: seed.today,
      people: seed.people,
      // Kept so the eval and the demo script can assert that each narrative
      // beat still produces the ledger state it was written to produce.
      beats: seed.threads.map((t) => ({ id: t.id, subject: t.subject, beat: t.beat })),
    },
    null,
    2,
  ),
);

const byDirection = messages.reduce(
  (acc, m) => {
    if (m.from === seed.owner.email) acc.sent++;
    else acc.received++;
    return acc;
  },
  { sent: 0, received: 0 },
);

console.log(`${messages.length} messages across ${seed.threads.length} threads -> ${OUT_PATH}`);
console.log(`  sent by owner: ${byDirection.sent}   received: ${byDirection.received}`);
console.log(`  date range: ${messages[0].date_iso.slice(0, 10)} .. ${messages.at(-1)!.date_iso.slice(0, 10)}`);
console.log(`  owner: ${seed.owner.email}, "today" for the demo: ${seed.today}`);
