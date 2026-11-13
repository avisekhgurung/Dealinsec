/**
 * The Leads list went blank at random (13 Nov 2026), showing its column headers with no rows under them.
 *
 * The rows were always there. They mount at opacity 0 and stagger in, and `animateRows` on the page flips to false
 * on the first re-render after the data arrives — which lands inside the ~370ms the stagger is still running. The
 * row passed `variants={animate ? staggerItem(index) : undefined}`, so that flip took the variants away mid-flight.
 * A motion node without variants is no longer a variant node: it cannot resolve "visible", and keeps the inline
 * opacity:0 it mounted with. Every row that had not yet animated stayed invisible until a reload.
 *
 * A source check, because the failure is in the props handed to framer-motion rather than in anything this project
 * computes — there is no return value to assert on. It lives in lib/ because vitest only collects client tests here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../pages/leads.tsx", import.meta.url), "utf8");

describe("the Leads list can never freeze its rows invisible", () => {
  it("no motion node on this page takes conditional variants", () => {
    const uses = [...src.matchAll(/variants=\{([^}]*)\}/g)];
    expect(uses.length).toBeGreaterThan(0);
    for (const m of uses) {
      expect(m[1], `conditional variants: ${m[0]}`).not.toMatch(/\?|undefined|&&|\|\|/);
    }
  });

  it("the row keeps its stagger variants, and only `initial` decides whether it fades in", () => {
    expect(src).toMatch(/<motion\.li variants=\{staggerItem\(index\)\} initial=\{animate \? undefined : false\}>/);
  });
});
