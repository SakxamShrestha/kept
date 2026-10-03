"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenCheck,
  Brain,
  Inbox,
  KeyRound,
  Scroll,
  type LucideIcon,
} from "lucide-react";

/**
 * The rail.
 *
 * Five destinations and nothing else. It deliberately does not sketch the
 * balance or repeat the counts - the ledger screen already opens with a
 * statement of position, and a second one here would be decoration. The single
 * number it carries is the overdue count, because that is the one fact worth
 * knowing from a screen that is not the ledger.
 */

interface Destination {
  href: string;
  label: string;
  icon: LucideIcon;
  hint: string;
}

const DESTINATIONS: Destination[] = [
  { href: "/", label: "Ledger", icon: BookOpenCheck, hint: "Every promise, both directions" },
  { href: "/memory", label: "Memory", icon: Brain, hint: "Rules your corrections wrote" },
  { href: "/skills", label: "Skills", icon: Scroll, hint: "How a chase gets written" },
  { href: "/access", label: "Access", icon: KeyRound, hint: "What this can reach" },
  { href: "/upload", label: "Mailbox", icon: Inbox, hint: "Read your own mail here" },
];

export function Rail({ overdue }: { overdue: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className="sticky top-0 flex h-dvh w-14 flex-col items-center border-r border-rule bg-rail py-4"
    >
      <Link
        href="/"
        aria-label="Kept — the ledger"
        className="mb-6 grid h-8 w-8 place-items-center border border-rule-strong text-[0.8125rem] font-semibold text-ink"
      >
        K
      </Link>

      <ul className="flex flex-1 flex-col items-center gap-1">
        {DESTINATIONS.map(({ href, label, icon: Icon, hint }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="relative">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                title={`${label} — ${hint}`}
                className={`group grid h-10 w-10 place-items-center transition-colors ${
                  active ? "bg-surface text-ink" : "text-ink-faint hover:text-ink-soft"
                }`}
              >
                <Icon size={17} strokeWidth={active ? 2 : 1.6} aria-hidden="true" />
                <span className="sr-only">{label}</span>
              </Link>

              {/* A hairline on the inside edge marks the current section. Reads
                  as the page's own tab rather than a highlight laid over it. */}
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1 -left-px w-0.5 bg-ink"
                />
              ) : null}

              {href === "/" && overdue > 0 ? (
                <span
                  className="absolute -right-0.5 top-1 min-w-4 bg-overdue px-1 text-center text-[0.625rem] font-medium leading-4 text-paper tabular"
                  title={`${overdue} overdue`}
                >
                  {overdue}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-[0.625rem] tracking-[0.2em] text-ink-faint [writing-mode:vertical-rl]">
        KEPT
      </p>
    </nav>
  );
}
