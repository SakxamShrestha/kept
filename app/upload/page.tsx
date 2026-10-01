import type { Metadata } from "next";
import { MAX_MESSAGES } from "@/lib/mbox";
import MboxUploader from "./MboxUploader";

export const metadata: Metadata = {
  title: "Bring your own mail — Kept",
  description:
    "Parse a Google Takeout .mbox entirely in your browser. Nothing is uploaded, and there is no server to upload it to.",
};

/**
 * The shell is a server component so the standing copy is plain HTML; only the
 * part that touches a file is client-side. Nothing on this route reads the
 * ledger, so it renders with no API key and no data directory.
 */
export default function UploadPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">Bring your own mail</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-soft">
          The seeded ledger is a hand-authored mailbox, which is a fair thing to be suspicious of.
          Point Kept at your own Google Takeout export instead and watch it do the same
          normalization on real mail: quoted reply history and signatures stripped, threads keyed on
          the normalized subject, one flat record per message.
        </p>
      </header>

      {/*
        The privacy claim is the first thing on the page because it is the
        reason the feature is shaped this way. It is also checkable: open the
        network tab, parse a file, and watch nothing leave.
      */}
      <section className="space-y-3 border border-rule bg-surface px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight">This file never leaves your machine</h2>
        <ul className="space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>
            <span className="text-ink">Parsing happens in this browser tab.</span> The file is read
            with the File API and decoded by a MIME parser bundled into the page. There is no upload
            endpoint behind this screen — open your network tab and watch: no request is made.
          </li>
          <li>
            <span className="text-ink">That is also why there is no size limit.</span> A Google
            Takeout mailbox is routinely several gigabytes. Nothing is transmitted, so nothing has
            to fit through a request body; the file is read a window at a time and the read stops
            once the cap is met.
          </li>
          <li>
            <span className="text-ink">The cap is {MAX_MESSAGES} messages.</span> Enough to see the
            normalizer work on real mail, small enough that it is a demonstration rather than an
            ingestion service.
          </li>
          <li>
            <span className="text-ink">Nothing is stored.</span> Reload the page and the parse is
            gone. Export the JSON if you want to keep it.
          </li>
        </ul>
      </section>

      <MboxUploader />
    </div>
  );
}
