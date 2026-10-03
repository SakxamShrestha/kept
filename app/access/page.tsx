import { AccessPanel } from "./AccessPanel";

/**
 * Access.
 *
 * Two of the four scopes are locked off because they are not implemented, and
 * saying so is the whole value of the screen. The other half of it is the call
 * log, which is the only claim on this site that cannot be staged: it has
 * entries only if calls actually happened.
 */
export default function AccessPage() {
  return (
    <>
      <header className="max-w-[62ch]">
        <h1 className="text-[1.3125rem] font-semibold tracking-tight">
          What Kept can reach
        </h1>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-soft">
          Two of these are switched off and cannot be switched on. They are not held back
          as a precaution — the code does not exist, and a toggle that quietly does
          nothing would be a worse answer than a locked one.
        </p>
      </header>

      <div className="mt-8">
        <AccessPanel />
      </div>

      <p className="mt-10 max-w-[62ch] text-[0.8125rem] leading-relaxed text-ink-faint">
        Your mail is never uploaded. The seeded mailbox ships with the repo, a file you
        open yourself is parsed in this browser, and the scopes and the log below live in
        this browser too — clear your site data and they are gone, including from us.
      </p>
    </>
  );
}
