/**
 * The page address analytics may see: the route's shape, never its secrets or ids. Public quotation and signing links
 * (/d/<token>, /s/<token>) and invitations (/invite/<token>) are bearer tokens: anyone holding the URL can open the
 * document, so they must never leave for a third party. Record ids and query strings (a reset link carries the email
 * and its token) are dropped too. Pure, so it is tested and used by the SPA's page_view and its page_location.
 */
const TOKEN_ROUTES = new Set(["d", "s", "invite"]);
const FIXED = new Set(["new", "import", "edit", "quote", "contract", "export", "success", "failure"]);
const looksLikeId = (seg: string) =>
  /^\d+$/.test(seg) // numeric ids
  || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) // uuids
  || (seg.length >= 12 && /^[A-Za-z0-9_-]+$/.test(seg) && /\d/.test(seg)); // run ids, tokens, slugs with ids

export function analyticsPath(raw: string): string {
  const path = (raw || "/").split(/[?#]/)[0] || "/";
  const segs = path.split("/");
  const out = segs.map((seg, i) => {
    if (!seg || i === 0) return seg;
    if (i === 2 && TOKEN_ROUTES.has(segs[1])) return ":token";
    if (FIXED.has(seg)) return seg;
    return looksLikeId(seg) ? ":id" : seg;
  });
  return out.join("/") || "/";
}
