/**
 * Is the address a campaign sends from set up so that mail from it is trusted? Pure: the server looks the DNS records
 * up, this reads them. Three records matter to a receiving mail server:
 *   SPF    which servers may send for the domain        (a TXT record on the domain, "v=spf1 …")
 *   DKIM   a signature proving the mail wasn't altered   (a TXT record at <selector>._domainkey.<domain>)
 *   DMARC  what to do when the two above fail            (a TXT record at _dmarc.<domain>, "v=DMARC1; p=…")
 *
 * This is advice, never a gate: it reads public DNS and says what it found. "Couldn't check" is its own answer — a
 * lookup that failed is not reported as a missing record, and a DKIM key under a name we don't know is "not found
 * at Google's usual name", not "missing".
 */
export type CheckState = "ok" | "warn" | "missing" | "unknown";
export type CheckKey = "spf" | "dkim" | "dmarc";
/** What the lookups returned. null = the lookup itself failed (unknown); [] = it worked and there is no such record. */
export interface SenderRecords { spf: string[] | null; dkim: string[] | null; dmarc: string[] | null }
export interface SenderCheckItem { key: CheckKey; label: string; state: CheckState; detail: string }
export interface SenderCheck {
  /** "none": no mailbox connected. "gmail": a Google-run address (gmail.com). "custom": the person's own domain. */
  kind: "none" | "gmail" | "custom";
  address: string | null; domain: string | null;
  items: SenderCheckItem[];
  /** Nothing is missing (unknowns and warnings are for the person to judge). */
  ready: boolean;
  summary: string;
}

/** Addresses on Google's own domains: Google publishes and signs these, there is nothing for the person to set up. */
export const GOOGLE_MAIL_DOMAINS: ReadonlySet<string> = new Set(["gmail.com", "googlemail.com"]);
export const CHECK_LABEL: Record<CheckKey, string> = { spf: "SPF", dkim: "DKIM", dmarc: "DMARC" };
/** Google Workspace signs with this selector unless the admin chose another. */
export const GOOGLE_DKIM_SELECTOR = "google";

/** The domain of an email address, lower case, or null when it isn't one we can look up. */
export function domainOfAddress(address: string | null | undefined): string | null {
  const m = String(address ?? "").trim().toLowerCase().match(/^[^@\s]+@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/);
  return m && m[1].length <= 253 ? m[1] : null;
}

const one = (xs: string[]) => xs.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);

function spf(records: string[] | null): SenderCheckItem {
  const label = CHECK_LABEL.spf;
  if (records === null) return { key: "spf", label, state: "unknown", detail: "Couldn't look this up just now. Try again in a minute." };
  const found = one(records).filter((r) => /^v=spf1(\s|$)/i.test(r));
  if (!found.length) return { key: "spf", label, state: "missing", detail: "No SPF record. Add a TXT record on your domain: v=spf1 include:_spf.google.com ~all" };
  if (found.length > 1) return { key: "spf", label, state: "warn", detail: "Your domain has more than one SPF record, which makes all of them invalid. Merge them into one." };
  const r = found[0].toLowerCase();
  if (/(^|\s)\+?all(\s|$)/.test(r)) return { key: "spf", label, state: "warn", detail: "Your SPF record ends in +all, which lets anyone send as you. Use ~all or -all." };
  if (!/include:_spf\.google\.com(\s|$)/.test(r)) return { key: "spf", label, state: "warn", detail: "You have an SPF record, but it doesn't include Google (include:_spf.google.com), so mail sent from Gmail may fail it." };
  return { key: "spf", label, state: "ok", detail: "Found, and it includes Google." };
}
function dkim(records: string[] | null): SenderCheckItem {
  const label = CHECK_LABEL.dkim;
  if (records === null) return { key: "dkim", label, state: "unknown", detail: "Couldn't look this up just now. Try again in a minute." };
  const found = one(records).some((r) => /(^|;)\s*p=[A-Za-z0-9+/=]{20,}/.test(r.replace(/\s+/g, "")) || /v=dkim1/i.test(r) && /p=[^;\s]/i.test(r));
  // Not finding it at Google's usual name proves nothing: the key may sit under another name. Say what to check.
  return found ? { key: "dkim", label, state: "ok", detail: "Found a signing key at Google's usual name." }
    : { key: "dkim", label, state: "unknown", detail: "No signing key at Google's usual name (google._domainkey). If you set DKIM up under another name it is fine; otherwise turn it on in Google Workspace Admin → Apps → Gmail → Authenticate email." };
}
function dmarc(records: string[] | null): SenderCheckItem {
  const label = CHECK_LABEL.dmarc;
  if (records === null) return { key: "dmarc", label, state: "unknown", detail: "Couldn't look this up just now. Try again in a minute." };
  const found = one(records).filter((r) => /^v=dmarc1(\s*;|$)/i.test(r));
  if (!found.length) return { key: "dmarc", label, state: "missing", detail: "No DMARC record. Add a TXT record at _dmarc on your domain, for example: v=DMARC1; p=none; rua=mailto:you@yourdomain" };
  if (found.length > 1) return { key: "dmarc", label, state: "warn", detail: "Your domain has more than one DMARC record. Keep only one." };
  const p = found[0].toLowerCase().match(/(?:^|;)\s*p\s*=\s*(none|quarantine|reject)\b/)?.[1];
  if (!p) return { key: "dmarc", label, state: "warn", detail: "You have a DMARC record, but it has no valid policy (p=none, quarantine or reject)." };
  return { key: "dmarc", label, state: "ok", detail: p === "none" ? "Found (policy: none, which only monitors). That is enough to start with." : `Found (policy: ${p}).` };
}

export function assessSender(address: string | null | undefined, records: SenderRecords | null): SenderCheck {
  const domain = domainOfAddress(address);
  if (!address || !domain) return { kind: "none", address: null, domain: null, items: [], ready: false, summary: "No Gmail is connected, so there is nothing to check yet." };
  if (GOOGLE_MAIL_DOMAINS.has(domain)) {
    const by = `Google sets this up for every ${domain} address.`;
    return {
      kind: "gmail", address, domain, ready: true,
      items: (["spf", "dkim", "dmarc"] as const).map((key) => ({ key, label: CHECK_LABEL[key], state: "ok" as const, detail: by })),
      summary: "You send from a personal Gmail address. Nothing to set up. For regular outreach, an address on your own business domain protects your personal address's reputation.",
    };
  }
  const items = [spf(records?.spf ?? null), dkim(records?.dkim ?? null), dmarc(records?.dmarc ?? null)];
  const missing = items.filter((i) => i.state === "missing"), warn = items.filter((i) => i.state === "warn"), unknown = items.filter((i) => i.state === "unknown");
  const names = (xs: SenderCheckItem[]) => xs.map((i) => i.label).join(" and ");
  const summary = missing.length ? `${names(missing)} ${missing.length === 1 ? "is" : "are"} not set up for ${domain}. Mail from it is more likely to land in spam until ${missing.length === 1 ? "it is" : "they are"}.`
    : warn.length ? `${names(warn)} for ${domain} need${warn.length === 1 ? "s" : ""} a look.`
    : unknown.length ? `${names(unknown)} couldn't be confirmed for ${domain}. The rest is in place.`
    : `${domain} is set up for sending: SPF, DKIM and DMARC are all in place.`;
  return { kind: "custom", address, domain, items, ready: missing.length === 0, summary };
}
