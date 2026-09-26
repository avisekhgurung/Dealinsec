/**
 * The one list of top-level paths that Express renders as complete HTML
 * OUTSIDE the React SPA (free tools, blog, category and comparison pages,
 * downloadable templates).
 *
 * Three things must agree on it or a page silently breaks:
 *  - vite.config.ts: the PWA service worker's navigation fallback must NOT
 *    answer these with the SPA shell (a known production bug: /tools rendered
 *    the landing page for installed users), and its NetworkFirst page cache
 *    must skip them.
 *  - the server registration order (server/index.ts), which mounts these
 *    before the SPA catch-all.
 *  - server/seo.test.ts, which asserts every registered SSR route matches.
 *
 * Add a prefix here when you add a new server-rendered top-level route.
 */
export const SSR_PATH_PREFIXES: readonly string[] = [
  "tools",
  "blog",
  "templates",
  // category pages (server/category-pages.ts)
  "quotation-software",
  "contract-management",
  "proposal-management",
  "invoice-management",
  "e-signature",
  "freelancer-invoice-software",
  "refrens-alternative",
  "vyapar-alternative",
  // retired page kept for its 301 (server/legacy-redirects.ts)
  "interior-design-software",
  // comparison pages (server/comparison-pages.ts)
  "freelance-business-management-software",
  "bonsai-alternatives",
  "bonsai-vs-dealinsec",
  "about",
];

/** Matches "/tools", "/tools/anything", "/blog/x" … but not "/toolsx". */
export const SSR_PATH_PATTERN = new RegExp(`^/(${SSR_PATH_PREFIXES.join("|")})(/|$)`);

/**
 * The service worker's "should the NetworkFirst page cache handle this
 * navigation?" test, as a SELF-CONTAINED function.
 *
 * vite-plugin-pwa serialises `urlPattern` functions with toString() and pastes
 * the text into the generated sw.js, where nothing from this module exists. A
 * function that merely *referred* to SSR_PATH_PATTERN would therefore compile
 * fine, build fine, and throw a ReferenceError inside the service worker on
 * every navigation. So the regex is inlined into the function's own source.
 * server/seo.test.ts asserts it stays closure-free.
 */
export const swNavigationMatcher = new Function(
  "ctx",
  `var request = ctx.request, url = ctx.url; return request.mode === "navigate" && !${SSR_PATH_PATTERN.toString()}.test(url.pathname);`,
) as (ctx: { request: { mode: string }; url: { pathname: string } }) => boolean;
