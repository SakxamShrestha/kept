import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Ship data/ into the serverless functions.
   *
   * lib/ledger.ts resolves the committed corpus, ledger and response cache through
   * path.join(process.cwd(), "data", ...), which Next's file tracing cannot follow
   * statically. Pages get away with it because they read at build time and
   * prerender; the API routes read at request time, so without this they work on a
   * laptop and 500 in production - the worst possible shape for a bug, since the
   * routes are the only thing in the project that calls Token Factory at runtime.
   */
  outputFileTracingIncludes: {
    "/api/*": ["./data/**/*"],
  },
};

export default nextConfig;
