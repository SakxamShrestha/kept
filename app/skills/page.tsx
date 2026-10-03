import Link from "next/link";
import { PlaybookEditor } from "./PlaybookEditor";

/**
 * Skills.
 *
 * The track asks for reusable skills the assistant can invoke. These are them,
 * and they are deliberately legible: four ways to chase a promise, each one a
 * tone and a set of instructions that go to the model as written. Kept has no
 * hidden prompt for this - what is on this page is what gets sent.
 */
export default function SkillsPage() {
  return (
    <>
      <header className="max-w-[62ch]">
        <h1 className="text-[1.3125rem] font-semibold tracking-tight">
          Four ways to chase a promise
        </h1>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-soft">
          Pick one when you draft a chase from any row in the{" "}
          <Link href="/" className="text-accent underline underline-offset-2">
            ledger
          </Link>
          . Each is sent to the model word for word alongside the row&apos;s receipt and the
          counterparty&apos;s delivery history, so editing one changes what the next draft
          says. There is no prompt behind these.
        </p>
      </header>

      <div className="mt-8">
        <PlaybookEditor />
      </div>

      <p className="mt-6 max-w-[62ch] text-[0.8125rem] leading-relaxed text-ink-faint">
        Edits live in this browser, like every other change you make here. One thing
        worth knowing: a chase written from an edited playbook is a request nobody has
        made before, so it cannot come from the shipped cache and needs a live
        connection. The four originals are cached and work offline.
      </p>
    </>
  );
}
