/**
 * Credit wallet HTTP surface (authenticated, workspace-scoped):
 *   GET /api/credits/wallet   plan allowances, purchased credits, lots, ledger, purchases and the packs on sale
 *   GET /api/credits/packs    the packs on sale (kind, units, price in ₹, expiry line) — prices come from the database.
 *                             Public (no sign-in): it is a price list the homepage quotes, with nothing about any workspace.
 * Buying goes through the existing Razorpay order and verify routes (plan: "credit_pack", packId); nothing here
 * grants, deducts or accepts a balance from the client.
 */
import type { Express } from "express";
import { isAuthenticated } from "../auth";
import { getWallet } from "./wallet";
import { packsForSale } from "./credit-orders";

export function registerCreditRoutes(app: Express) {
  app.get("/api/credits/wallet", isAuthenticated, async (req: any, res) => {
    if (!req.user?.organizationId) return res.status(403).json({ code: "no_organization", error: "Finish setting up your workspace first." });
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ wallet: await getWallet(req.user) });
    } catch (err) {
      console.error("wallet failed:", (err as Error)?.message ?? err);
      res.status(500).json({ code: "internal", error: "Couldn't load your credits just now." });
    }
  });
  app.get("/api/credits/packs", async (_req: any, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ packs: await packsForSale() });
    } catch {
      res.json({ packs: [] });
    }
  });
}
