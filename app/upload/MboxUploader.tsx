"use client";

/**
 * The bring-your-own-mail surface.
 *
 * Client component out of necessity, not preference: the whole point is that
 * the file is read by the browser and never sent anywhere. There is no upload
 * endpoint behind this page, which is why there is also no payload limit and
 * nothing to delete afterwards.
 */

import { useCallback, useRef, useState, type DragEvent } from "react";
import { MAX_MESSAGES, parseMboxFile, type Message, type ParseStats } from "@/lib/mbox";

type Status = "idle" | "parsing" | "done" | "error";

interface Parsed {
  fileName: string;
  fileSize: number;
  messages: Message[];
  stats: ParseStats;
  elapsedMs: number;
}

/** Column template, shared by the header and every row so they actually line up. */
const COLS = "grid grid-cols-[7rem_14rem_minmax(0,1fr)_5rem]";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function MboxUploader() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ kept: 0, scanned: 0 });
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setStatus("parsing");
    setError(null);
    setParsed(null);
    setExpanded(null);
    setProgress({ kept: 0, scanned: 0 });

    const startedAt = performance.now();
    try {
      const { messages, stats } = await parseMboxFile(file, {
        limit: MAX_MESSAGES,
        onProgress: (kept, scanned) => {
          // Throttled: a setState per message is 200 renders of a table nobody
          // is looking at yet.
          if (kept % 10 === 0) setProgress({ kept, scanned });
        },
      });
      setParsed({
        fileName: file.name,
        fileSize: file.size,
        messages,
        stats,
        elapsedMs: performance.now() - startedAt,
      });
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const download = useCallback(() => {
    if (!parsed) return;
    const blob = new Blob([JSON.stringify(parsed.messages, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "messages.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [parsed]);

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------ the picker */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-sm border border-dashed bg-surface px-5 py-8 text-center transition-colors ${
          dragging ? "border-rule-strong" : "border-rule"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".mbox,application/mbox,message/rfc822,text/plain"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={status === "parsing"}
          className="rounded-sm border border-rule-strong px-4 py-2 text-sm text-ink transition-colors hover:border-ink-faint disabled:text-ink-faint"
        >
          {status === "parsing" ? "Parsing…" : "Choose an .mbox file"}
        </button>
        <p className="mt-3 text-sm text-ink-soft">
          or drop it here. Google Takeout gives you one <code>.mbox</code> per label, under Mail.
        </p>
        {status === "parsing" && (
          <p className="mt-3 text-sm text-ink-faint tabular">
            {progress.kept} kept · {progress.scanned} scanned
          </p>
        )}
      </div>

      {status === "error" && error && (
        <div className="rounded-sm border border-rule bg-overdue-bg px-4 py-3 text-sm text-overdue">
          {error}
        </div>
      )}

      {/* ----------------------------------------------------- the summary */}
      {parsed && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold tracking-tight">Parse summary</h2>

          <dl className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
            <Figure label="Messages" value={String(parsed.stats.kept)} />
            <Figure label="Threads" value={String(parsed.stats.threads)} />
            <Figure
              label="Date range"
              value={
                parsed.stats.dateFrom && parsed.stats.dateTo
                  ? `${formatDay(parsed.stats.dateFrom)} – ${formatDay(parsed.stats.dateTo)}`
                  : "—"
              }
            />
            <Figure
              label="Read from disk"
              value={`${formatBytes(parsed.stats.bytesRead)} of ${formatBytes(parsed.fileSize)}`}
            />
          </dl>

          <p className="text-sm leading-relaxed text-ink-soft">
            <span className="text-ink">{parsed.fileName}</span> — {parsed.stats.scanned} messages
            framed in {(parsed.elapsedMs / 1000).toFixed(1)}s.{" "}
            {parsed.stats.skippedNoBody > 0 && (
              <>
                {parsed.stats.skippedNoBody} dropped for having no body left once quoted replies and
                signatures were stripped.{" "}
              </>
            )}
            {parsed.stats.skippedNoDate > 0 && (
              <>
                {parsed.stats.skippedNoDate} dropped for an unreadable <code>Date</code> header — an
                undated promise can never go overdue, so it cannot become a ledger row.{" "}
              </>
            )}
            {parsed.stats.skippedUnparseable > 0 && (
              <>{parsed.stats.skippedUnparseable} dropped as unparseable MIME. </>
            )}
            {parsed.stats.truncated && (
              <>Stopped at the {MAX_MESSAGES}-message cap; the rest of the file was never read.</>
            )}
          </p>
        </section>
      )}

      {/* ----------------------------------------------------- the preview */}
      {parsed && parsed.messages.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight">What was parsed</h2>
            <button
              type="button"
              onClick={download}
              className="text-sm text-accent underline underline-offset-2"
            >
              Export as messages.json
            </button>
          </div>

          <div className="overflow-x-auto border border-rule bg-surface">
            <div className="min-w-[44rem]">
              <div
                className={`${COLS} border-b border-rule-strong text-xs uppercase tracking-wide text-ink-faint`}
              >
                <span className="px-3 py-2">Date</span>
                <span className="px-3 py-2">From</span>
                <span className="px-3 py-2">Subject</span>
                <span className="px-3 py-2 text-right">Thread</span>
              </div>

              <ul>
                {parsed.messages.map((m) => {
                  const open = expanded === m.id;
                  return (
                    <li key={m.id} className="border-b border-rule last:border-b-0">
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : m.id)}
                        aria-expanded={open}
                        className={`${COLS} w-full items-baseline text-left`}
                      >
                        <span className="px-3 py-2 text-ink-soft tabular">
                          {formatDay(m.date_iso)}
                        </span>
                        <span className="truncate px-3 py-2 text-ink-soft">
                          {m.from || "(no sender)"}
                        </span>
                        <span className="truncate px-3 py-2 text-ink">
                          {m.subject || "(no subject)"}
                        </span>
                        <span className="px-3 py-2 text-right text-xs text-ink-faint tabular">
                          {m.thread_id.slice(0, 8)}
                        </span>
                      </button>

                      {open && (
                        <div className="space-y-3 border-t border-rule px-4 py-4">
                          <div className="text-xs text-ink-faint">
                            to {m.to.join(", ") || "—"}
                            {m.cc.length > 0 && <> · cc {m.cc.join(", ")}</>}
                          </div>
                          <p className="receipt">{m.body_text}</p>
                          <div className="text-xs text-ink-faint">
                            This is the cleaned body the extractor would see. Quoted reply history
                            and signatures are gone, so a promise made once is not logged twice.
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------- the honest stop */}
      {parsed && (
        <section className="space-y-3 border-t border-rule pt-6">
          <h2 className="text-sm font-semibold tracking-tight">
            What happens next — and why it does not happen here
          </h2>
          <p className="text-sm leading-relaxed text-ink-soft">
            Turning these messages into ledger rows is a live model call, and this deployment runs
            with no Nebius API key on purpose: the seeded ledger renders entirely from a committed
            response cache, so the demo still works months after it was built. Rather than let you
            sit through a parse and then hand you an authentication error, the page stops at the
            parse and says so.
          </p>
          <p className="text-sm leading-relaxed text-ink-soft">
            The export above is the same record shape{" "}
            <code className="text-ink">scripts/normalize.py</code> produces. Drop it at{" "}
            <code className="text-ink">data/corpus/messages.json</code> in a local checkout, add
            your own key, and run <code className="text-ink">npm run build:ledger</code>. Every
            message meets the Nemotron 3 Nano gate first — measured at 100% recall over 150 real
            Enron messages, avoiding 55.3% of the Super calls — and whatever the gate passes goes to
            Nemotron 3 Super for extraction, then through date resolution, dedupe, and the
            reconciliation pass.
          </p>
        </section>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-1 text-sm text-ink tabular">{value}</dd>
    </div>
  );
}
