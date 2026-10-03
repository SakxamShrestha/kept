import type { Metadata } from "next";
import { Archivo, Geist_Mono } from "next/font/google";
import "./globals.css";
import { buildView, decorate, loadLedger, loadMeta } from "@/lib/ledger";
import { Rail } from "@/app/components/Rail";
import { CommandSearch } from "@/app/components/CommandSearch";

/**
 * Archivo was cut for print and its figures are properly tabular, which a dense
 * ledger needs more than it needs a neutral UI grotesque. Geist Mono stays for
 * one job only: verbatim receipts and figures. If something on this site is set
 * in mono, it was either quoted or counted.
 */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Kept — a commitment ledger for your inbox",
  description:
    "Every promise in your mail, both directions, with a dated verbatim receipt on every row.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const meta = await loadMeta();
  const rows = decorate(await loadLedger(), meta);
  const view = buildView(rows);
  const overdue = view.stats.overdueByMe + view.stats.overdueToMe;

  const today = new Date(meta.today).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  // The search index is built on the server because it needs the decorated rows
  // and the people table. It is small enough to hand over whole.
  const index = [...view.owedByMe, ...view.owedToMe, ...view.needsReview, ...view.closed].map(
    (r) => ({
      id: r.id,
      what: r.what,
      counterparty: r.counterpartyName,
      org: meta.people.find((p) => p.email === r.counterparty)?.org ?? "",
      state: r.state,
      stateLabel: r.state.replace(/_/g, " "),
      direction: r.direction,
      due: r.due_text,
      overdue: r.overdue,
      quote: r.origin.quote,
    }),
  );

  return (
    <html
      lang="en"
      className={`${archivo.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="flex">
          <Rail overdue={overdue} />

          <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
            <header className="border-b border-rule">
              <div className="mx-auto flex w-full max-w-5xl flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-6 py-5 lg:px-10">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {/* Not an h1 - each page owns its own heading, and two per
                      document is a worse outline than none. */}
                  <p className="text-[1.0625rem] font-semibold tracking-tight">
                    {meta.owner.name}
                  </p>
                  <p className="text-[0.8125rem] text-ink-faint">{meta.owner.role}</p>
                </div>

                <div className="flex items-baseline gap-4">
                  <CommandSearch index={index} />
                  {/*
                    The demo clock, stated openly. Overdue is counted against
                    this date, not the wall clock, so someone opening the demo
                    months from now sees a live mailbox rather than one that
                    looks abandoned. Hiding it would be dishonest and it costs
                    nothing to show.
                  */}
                  <p
                    className="text-[0.8125rem] text-ink-faint tabular"
                    title="This demo runs on a fixed date so the mailbox stays coherent over time."
                  >
                    {today}
                  </p>
                </div>
              </div>
            </header>

            <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-9 lg:px-10">{children}</main>

            <footer className="border-t border-rule px-6 py-6 text-[0.8125rem] text-ink-faint lg:px-10">
              <div className="mx-auto w-full max-w-5xl">
                Commitments extracted and reconciled with NVIDIA Nemotron 3 on{" "}
                <a
                  className="underline underline-offset-2 hover:text-ink-soft"
                  href="https://tokenfactory.nebius.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  Nebius Token Factory
                </a>
                . Nothing here sends mail. Your corrections stay in this browser.
              </div>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
