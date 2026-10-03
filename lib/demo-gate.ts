/**
 * Who is allowed to spend tokens.
 *
 * The two API routes are public, and they are the only things here that can
 * reach a paid endpoint. Nebius offers no way to bound that from their side: a
 * budget "does not stop or cap your usage" and only alerts, with usage data that
 * updates every few hours; a key's rate limit cannot be lowered by its owner;
 * and this account's limit is 100 requests a second. So an unguarded route with
 * a key behind it is an unmetered way for a stranger to spend the credits this
 * demo needs in December.
 *
 * The guard is therefore on the money, not on the app. There is no login and no
 * account anywhere in this project. Anything already in the committed cache -
 * which is every path the demo narrates - is served to anyone who asks. Only a
 * request that would have to go over the wire needs the token, and that token
 * lives in the submission's testing instructions so a reviewer can watch a real
 * Nemotron call happen.
 *
 * With KEPT_DEMO_TOKEN unset there is no guard at all, which is what makes local
 * development and `npm run prewarm` behave normally.
 */

import { timingSafeEqual } from "node:crypto";

export const DEMO_TOKEN_HEADER = "x-kept-demo";

export function liveCallsAllowed(request: Request): boolean {
  const expected = process.env.KEPT_DEMO_TOKEN;
  if (!expected) return true;

  const given = request.headers.get(DEMO_TOKEN_HEADER) ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // Length is compared first because timingSafeEqual throws on a mismatch, and
  // the length of a token is not the secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True when a token is configured, so the UI can say whether one is needed. */
export const demoTokenRequired = (): boolean => !!process.env.KEPT_DEMO_TOKEN;

/**
 * The answer when a request needed to spend and was not allowed to. 403 rather
 * than 401: nothing is being authenticated, a specific capability is withheld.
 */
export function spendRefused(stage: string): Response {
  return Response.json(
    {
      error:
        `This one is not in the shipped cache, so answering it would mean a live model call. ` +
        `Everything the demo walks through is cached and open to everyone; a request that costs ` +
        `money needs the demo token from the submission's testing instructions. Paste it on the ` +
        `Access screen.`,
      stage,
      needsDemoToken: true,
    },
    { status: 403 },
  );
}
