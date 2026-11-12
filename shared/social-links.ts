/**
 * The company's own social profiles and WhatsApp link, read from the links on its website (footer icons, contact page).
 * Plain rules, no model. Share buttons ("share this on Facebook"), posts and search pages are not profiles and are
 * skipped by the address helpers in shared/channels.ts. The first profile of each kind wins; a LinkedIn company page
 * is preferred to a person's profile. A footer can link someone else (the web designer, a partner), so the Studio says
 * where each one came from and the person checks it before sending.
 */
import { instagramHandle, linkedinUrl, messengerPage, normalPhone, xHandle } from "./channels";

export interface SocialLinks { linkedin: string | null; instagram: string | null; x: string | null; facebook: string | null; whatsapp: string | null }
export const SOCIAL_FIELDS = { linkedin: "social_linkedin", instagram: "social_instagram", x: "social_x", facebook: "social_facebook", whatsapp: "social_whatsapp" } as const;
export type SocialKind = keyof typeof SOCIAL_FIELDS;
export const SOCIAL_KINDS = Object.keys(SOCIAL_FIELDS) as SocialKind[];

/** A WhatsApp click-to-chat link (wa.me/<number>, api.whatsapp.com/send?phone=<number>) as +<number>; null otherwise. */
export function whatsappNumber(href: string): string | null {
  try {
    const u = new URL(href.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const raw = host === "wa.me" ? u.pathname.slice(1).split("/")[0] : (host === "api.whatsapp.com" || host === "web.whatsapp.com" || host === "whatsapp.com") ? (u.searchParams.get("phone") ?? "") : "";
    const digits = raw.replace(/\D/g, "");
    return digits ? normalPhone(`+${digits}`) : null;
  } catch { return null; }
}

export function socialLinksFrom(links: readonly { href: string }[]): SocialLinks {
  const out: SocialLinks = { linkedin: null, instagram: null, x: null, facebook: null, whatsapp: null };
  let linkedinPerson: string | null = null;
  for (const { href } of links) {
    if (!/^https?:\/\//i.test(href.trim())) continue;
    let host = "";
    try { host = new URL(href.trim()).hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, ""); } catch { continue; }
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
      const u = linkedinUrl(href);
      if (u && u.includes("/company/")) out.linkedin ??= u;
      else if (u) linkedinPerson ??= u;
    } else if (host === "instagram.com") out.instagram ??= instagramHandle(href);
    else if (host === "x.com" || host === "twitter.com") out.x ??= ["intent", "share", "home", "search", "i"].some((p) => new URL(href.trim()).pathname.toLowerCase().startsWith(`/${p}`)) ? null : xHandle(href);
    else if (host === "facebook.com" || host === "fb.com" || host === "m.me") out.facebook ??= /sharer|share\.php|dialog\//i.test(href) ? null : messengerPage(href);
    else if (host === "wa.me" || host.endsWith("whatsapp.com")) out.whatsapp ??= whatsappNumber(href);
  }
  out.linkedin ??= linkedinPerson;
  return out;
}
