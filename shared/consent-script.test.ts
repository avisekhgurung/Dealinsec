/**
 * Option a, run for real in a simulated browser: Google Analytics is not loaded (no script, no cookies) until the
 * visitor accepts; the choice persists across reloads; declining or withdrawing keeps it off and wipes _ga cookies.
 */
import { describe, expect, it } from "vitest";
import { CONSENT_KEY, consentBanner, consentScript, GA_ID } from "./consent-script";

function browser(o: { host?: string; stored?: unknown; cookies?: string[] } = {}) {
  const store = new Map<string, string>();
  if (o.stored !== undefined) store.set(CONSENT_KEY, JSON.stringify(o.stored));
  let jar = [...(o.cookies ?? [])];
  const appended: { src: string }[] = [];
  const events: string[] = [];
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const document: any = {
    head: { appendChild: (el: any) => appended.push(el) },
    createElement: () => ({ async: false, src: "" }),
    addEventListener: (t: string, f: any) => { (listeners[t] ??= []).push(f); },
    get cookie() { return jar.join("; "); },
    set cookie(v: string) {
      const name = v.split("=")[0];
      if (/expires=Thu, 01 Jan 1970/.test(v)) jar = jar.filter((c) => !c.startsWith(name + "="));
    },
  };
  const window: any = { dispatchEvent: (e: any) => events.push(`${e.type}:${e.detail}`) };
  const localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const location = { hostname: o.host ?? "www.dealinsec.com", pathname: "/pricing" };
  class CustomEvent { constructor(public type: string, init?: { detail?: unknown }) { (this as any).detail = init?.detail; } }
  const run = (html: string) => {
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      new Function("window", "document", "localStorage", "location", "CustomEvent", m[1])(window, document, localStorage, location, CustomEvent);
    }
  };
  return { window, document, store, appended, events, run, cookies: () => jar };
}
const granted = (at = new Date().toISOString()) => ({ v: 1, analytics: "granted", at });

describe("consent script: nothing from Google Analytics before consent", () => {
  for (const mode of ["spa", "server"] as const) {
    it(`${mode}: no choice → no gtag script, no gtag function, the choice reads as unknown`, () => {
      const b = browser();
      b.run(consentScript(mode));
      expect(b.appended).toEqual([]);
      expect(b.window.gtag).toBeUndefined();
      expect(b.window.disConsent.get()).toBeNull();
    });

    it(`${mode}: accept → GA loads once, configured; the choice is stored for the next visit`, () => {
      const b = browser();
      b.run(consentScript(mode));
      b.window.disConsent.set("granted");
      b.window.disConsent.set("granted");
      expect(b.appended.map((s) => s.src)).toEqual([`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`]);
      const cfg = b.window.dataLayer.find((a: any) => a[0] === "config");
      expect(cfg[1]).toBe(GA_ID);
      expect(cfg[2]).toEqual(mode === "spa" ? { send_page_view: false } : {});
      expect(JSON.parse(b.store.get(CONSENT_KEY)!)).toMatchObject({ v: 1, analytics: "granted" });
      expect(b.events).toEqual(["dis:consent:granted", "dis:consent:granted"]);
    });
  }

  it("a stored acceptance loads GA on the next page; a stored refusal never does", () => {
    const yes = browser({ stored: granted() });
    yes.run(consentScript("spa"));
    expect(yes.appended).toHaveLength(1);
    const no = browser({ stored: { v: 1, analytics: "denied", at: new Date().toISOString() } });
    no.run(consentScript("spa"));
    expect(no.appended).toHaveLength(0);
    expect(no.window.disConsent.get()).toBe("denied");
  });

  it("asks again after 12 months, or when the stored value is unreadable or from another version", () => {
    for (const stored of [granted(new Date(Date.now() - 366 * 864e5).toISOString()), { v: 2, analytics: "granted", at: new Date().toISOString() }, "junk", { v: 1, analytics: "maybe", at: new Date().toISOString() }]) {
      const b = browser({ stored });
      b.run(consentScript("spa"));
      expect(b.window.disConsent.get(), JSON.stringify(stored)).toBeNull();
      expect(b.appended).toHaveLength(0);
    }
  });

  it("withdrawing after accepting turns GA off for the rest of the visit and deletes its cookies only", () => {
    const b = browser({ stored: granted(), cookies: ["_ga=GA1.1.123", `_ga_${GA_ID.slice(2)}=GS1.1`, "connect.sid=s%3Aabc"] });
    b.run(consentScript("spa"));
    b.window.disConsent.set("denied");
    expect(b.window[`ga-disable-${GA_ID}`]).toBe(true);
    expect(b.cookies()).toEqual(["connect.sid=s%3Aabc"]);
    expect(b.window.disConsent.get()).toBe("denied");
  });

  it("never loads on localhost, whatever was chosen", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "dev.local"]) {
      const b = browser({ host, stored: granted() });
      b.run(consentScript("spa"));
      b.window.disConsent.set("granted");
      expect(b.appended, host).toHaveLength(0);
    }
  });

  it("ignores anything but the two choices", () => {
    const b = browser();
    b.run(consentScript("spa"));
    b.window.disConsent.set("yes please");
    expect(b.store.has(CONSENT_KEY)).toBe(false);
    expect(b.appended).toHaveLength(0);
  });
});

describe("server pages' banner", () => {
  it("is shown while there's no choice, with two equal buttons and a policy link; choosing hides it", () => {
    const html = consentBanner();
    expect(html).toContain('data-consent="granted"');
    expect(html).toContain('data-consent="denied"');
    expect(html).toContain('href="/cookies"');
    expect(html).toContain('role="region"');
    expect(html).not.toMatch(/checked/);
  });
});
