/**
 * The Gmail integration switch. Off unless GMAIL_INTEGRATION_ENABLED is exactly "true" or "1", and off whenever
 * anything it needs is missing or wrong: the token keys, the provider's settings, or the migrated tables. Callers get
 * a reason, never a half-working integration. Pure apart from the injected schema check; no database import here.
 *
 *   GMAIL_INTEGRATION_ENABLED   "true" | "1" to switch on (default off)
 *   MAIL_PROVIDER               "gmail" (default) | "fake" (local and tests; refused when NODE_ENV=production)
 *   MAILBOX_TOKEN_KEYS, MAILBOX_TOKEN_KEY_CURRENT          see token-crypto.ts
 *   GMAIL_OAUTH_REDIRECT_URI                         <origin>/api/integrations/gmail/callback (both providers)
 *   GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET   (gmail only)
 *   GMAIL_ALLOWED_ORG_IDS                            optional: comma-separated organization ids; when set, ONLY those
 *                                                    organizations see or use the integration (others: as if off)
 *   MAIL_SEND_DAILY_CAP                              sends per mailbox per rolling 24 hours (default 50; invalid = no sending)
 */
import { loadKeyring, TokenCryptoError, type Keyring } from "./token-crypto";
import { FakeMailProvider } from "./fake-provider";
import { GmailProvider } from "./gmail-provider";
import type { MailProvider } from "./provider";
import type { Exec } from "./mailbox-schema";
import { mailboxSchemaPresent } from "./mailbox-schema";

export const GMAIL_CALLBACK_PATH = "/api/integrations/gmail/callback";
/**
 * Sending through the REAL Gmail adapter stays off in this build, whatever any setting says: the adapter's own send
 * refuses too. Only the fake provider (never allowed in production) can complete a send, for local runs and tests.
 */
export const GMAIL_SENDING_ENABLED = false;
export const DEFAULT_SEND_DAILY_CAP = 50;
export const MAX_SEND_DAILY_CAP = 2_000;

export type GmailConfig = {
  provider: "gmail" | "fake";
  keyring: Keyring;
  /** GMAIL_ALLOWED_ORG_IDS: the only organizations it is switched on for; null means every organization. */
  allowedOrgIds: string[] | null;
  /** Per mailbox, rolling 24 hours (MAIL_SEND_DAILY_CAP). Null when the setting is invalid: then nothing may send. */
  sendDailyCap: number | null;
  redirectUri: string; // the one callback URL; never taken from a request
  oauth: { clientId: string; clientSecret: string } | null; // null for fake
};

export type GmailOff =
  | { enabled: false; reason: "disabled" } // the switch is off (the default)
  | { enabled: false; reason: "misconfigured"; problems: string[] }
  | { enabled: false; reason: "provider_unavailable"; detail: string }
  | { enabled: false; reason: "not_migrated"; missing: string[] }
  | { enabled: false; reason: "not_enabled_for_org" };
export type GmailStatus = GmailOff | { enabled: true; config: GmailConfig };

type Env = Record<string, string | undefined>;

/** Reads the switch and settings. Never throws; anything unusable is a reason to stay off. */
export function resolveGmailConfig(env: Env = process.env): GmailOff | { enabled: true; config: GmailConfig } {
  const flag = (env.GMAIL_INTEGRATION_ENABLED ?? "").trim().toLowerCase();
  if (flag === "" || flag === "false" || flag === "0") return { enabled: false, reason: "disabled" };
  if (flag !== "true" && flag !== "1") return { enabled: false, reason: "misconfigured", problems: [`GMAIL_INTEGRATION_ENABLED must be "true" or "false"`] };

  const problems: string[] = [];
  const provider = (env.MAIL_PROVIDER ?? "gmail").trim().toLowerCase();
  if (provider !== "gmail" && provider !== "fake") problems.push(`MAIL_PROVIDER must be "gmail" or "fake"`);
  if (provider === "fake" && env.NODE_ENV === "production") problems.push("MAIL_PROVIDER=fake is not allowed in production");

  let keyring: Keyring | null = null;
  try { keyring = loadKeyring(env); } catch (e) {
    problems.push(e instanceof TokenCryptoError ? e.message : "MAILBOX_TOKEN_KEYS could not be read");
  }

  const redirectUri = (env.GMAIL_OAUTH_REDIRECT_URI ?? "").trim();
  const r = redirectProblem(redirectUri, env.NODE_ENV === "production");
  if (r) problems.push(r);

  let oauth: GmailConfig["oauth"] = null;
  if (provider === "gmail") {
    const clientId = (env.GMAIL_OAUTH_CLIENT_ID ?? "").trim();
    const clientSecret = (env.GMAIL_OAUTH_CLIENT_SECRET ?? "").trim();
    if (!clientId.endsWith(".apps.googleusercontent.com")) problems.push("GMAIL_OAUTH_CLIENT_ID is missing or not a Google OAuth client id");
    if (!clientSecret) problems.push("GMAIL_OAUTH_CLIENT_SECRET is missing");
    oauth = { clientId, clientSecret };
  }

  const allowedOrgIds = parseOrgList(env.GMAIL_ALLOWED_ORG_IDS);
  if (allowedOrgIds === false) problems.push("GMAIL_ALLOWED_ORG_IDS must be organization ids separated by commas");

  if (problems.length || !keyring || allowedOrgIds === false) return { enabled: false, reason: "misconfigured", problems };
  return { enabled: true, config: { provider: provider as "gmail" | "fake", keyring, allowedOrgIds, sendDailyCap: parseDailyCap(env.MAIL_SEND_DAILY_CAP), redirectUri, oauth } };
}

/** GMAIL_ALLOWED_ORG_IDS: unset or blank means every organization; anything malformed is false (the integration stays off). */
export function parseOrgList(raw: string | undefined): string[] | null | false {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const ids = v.split(",").map((x) => x.trim()).filter(Boolean);
  if (!ids.length || ids.length > 100 || ids.some((x) => !/^[A-Za-z0-9_-]{1,64}$/.test(x))) return false;
  return Array.from(new Set(ids));
}

/** The integration as one organization sees it: off for any organization outside GMAIL_ALLOWED_ORG_IDS. */
export function forOrg(s: GmailStatus, orgId: string | null | undefined): GmailStatus {
  if (!s.enabled || !s.config.allowedOrgIds) return s;
  return orgId && s.config.allowedOrgIds.includes(orgId) ? s : { enabled: false, reason: "not_enabled_for_org" };
}

/** MAIL_SEND_DAILY_CAP: unset means the default; anything but a whole number from 1 to the maximum is invalid (null). */
export function parseDailyCap(raw: string | undefined): number | null {
  const v = (raw ?? "").trim();
  if (!v) return DEFAULT_SEND_DAILY_CAP;
  if (!/^\d{1,5}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= MAX_SEND_DAILY_CAP ? n : null;
}

/** Whether a connected mailbox may send in this build, and why not. */
export function sendingAvailability(config: GmailConfig, env: Env = process.env): { ok: true; cap: number } | { ok: false; reason: "sending_disabled" | "cap_invalid" } {
  if (config.provider === "gmail" && !GMAIL_SENDING_ENABLED) return { ok: false, reason: "sending_disabled" };
  if (config.provider === "fake" && env.NODE_ENV === "production") return { ok: false, reason: "sending_disabled" };
  if (config.sendDailyCap === null) return { ok: false, reason: "cap_invalid" };
  return { ok: true, cap: config.sendDailyCap };
}

function redirectProblem(uri: string, production: boolean): string | null {
  let u: URL;
  try { u = new URL(uri); } catch { return "GMAIL_OAUTH_REDIRECT_URI is missing or not a URL"; }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return "GMAIL_OAUTH_REDIRECT_URI must be https (http only for localhost)";
  if (production && local) return "GMAIL_OAUTH_REDIRECT_URI points at localhost in production";
  if (u.pathname !== GMAIL_CALLBACK_PATH || u.search || u.hash || u.username || u.password) return `GMAIL_OAUTH_REDIRECT_URI must be <origin>${GMAIL_CALLBACK_PATH}, nothing more`;
  return null;
}

let fakeInstance: FakeMailProvider | null = null;
let gmailInstance: { key: string; provider: GmailProvider } | null = null;

/**
 * The provider for a resolved config, one per process (the fake keeps its codes and tokens in memory, so a connect
 * and its callback must meet the same instance). The fake is refused in production here as well as in the config.
 */
export function createMailProvider(config: GmailConfig, env: Env = process.env): MailProvider {
  if (config.provider === "fake") {
    if (env.NODE_ENV === "production") throw new Error("the fake mail provider is not allowed in production");
    return (fakeInstance ??= new FakeMailProvider());
  }
  if (!config.oauth) throw new Error("the Gmail provider needs its OAuth settings");
  const key = `${config.oauth.clientId}|${config.oauth.clientSecret}`;
  if (gmailInstance?.key !== key) gmailInstance = { key, provider: new GmailProvider({ clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret }) };
  return gmailInstance.provider;
}

const PROVIDERS_AVAILABLE = new Set<GmailConfig["provider"]>(["fake", "gmail"]);

/**
 * The full answer to "may the Gmail integration run?": switch, settings, adapter, then migrated tables. A positive
 * schema answer is cached for the process; a negative one is rechecked at most every 30 seconds.
 */
export function gmailIntegrationGate(schemaExec: () => Exec, opts: { env?: Env; recheckMs?: number } = {}) {
  let schemaOk = false;
  let lastCheck = 0;
  let lastMissing: string[] = ["(not checked yet)"];
  return async function status(): Promise<GmailStatus> {
    const resolved = resolveGmailConfig(opts.env ?? process.env);
    if (!resolved.enabled) return resolved;
    if (!PROVIDERS_AVAILABLE.has(resolved.config.provider)) return { enabled: false, reason: "provider_unavailable", detail: `the ${resolved.config.provider} adapter is not available in this build` };
    if (!schemaOk && Date.now() - lastCheck >= (opts.recheckMs ?? 30_000)) {
      lastCheck = Date.now();
      try {
        const r = await mailboxSchemaPresent(schemaExec());
        schemaOk = r.ok;
        lastMissing = r.ok ? [] : r.missing;
      } catch {
        lastMissing = ["(the schema check failed)"];
      }
    }
    return schemaOk ? resolved : { enabled: false, reason: "not_migrated", missing: lastMissing };
  };
}
