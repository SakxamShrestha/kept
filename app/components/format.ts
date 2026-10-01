/**
 * Small presentation helpers shared by the ledger and memory screens.
 *
 * Dates that are rendered during SSR are formatted in a fixed locale and a
 * fixed time zone. Anything else hydrates with a different string than it was
 * served with, and React replaces the whole subtree - which on this app means
 * the receipts flicker, and the receipts are the product.
 */

/** Deterministic across server and client. Safe to call during render. */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Local time, deliberately. Only ever called after mount, on timestamps the
 *  user themselves created, where their own clock is the right one to show. */
export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
