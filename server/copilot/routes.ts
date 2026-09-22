/**
 * DealinSec Copilot — HTTP surface.
 *
 * POST /api/copilot/chat     — the orchestration loop (auth required).
 *   Body: { messages: [{role:"user"|"assistant", content}], context?: {page, route, entityType, entityId} }
 *   Conversation memory is CLIENT-HELD in v1 (capped + re-validated here):
 *   nothing is persisted server-side, so conversations can never leak across
 *   organizations. The client context is a HINT — org, user, role and every
 *   entity read are derived/re-authorized server-side.
 * POST /api/copilot/execute  — the confirm-gated mutation endpoint.
 * GET  /api/copilot/meta     — enablement + knowledge version (debugging).
 *
 * Cost control: per-user daily message quota (in-memory — resets on deploy,
 * which is acceptable for a spend ceiling, not a security control), capped
 * history, capped tool rounds, 45s provider timeout, token caps.
 */
import type { Express } from "express";
import { isAuthenticated } from "../auth";
import { aiProvider, copilotConfigured, type ChatMessage } from "./provider";
import { retrieveKnowledge, AI_KNOWLEDGE_VERSION } from "./knowledge";
import {
  toolDefs, runTool, executeCreateQuotation, executeCreateDeal, buildDealCandidate,
  buildAgreementCandidate, executeCreateAgreement, buildInvoiceCandidate, executeCreateInvoice,
} from "./tools";
import { appendTerm, buildAgreementDraft, buildDealDraft, buildInvoiceDraft, confirmProposal, openProposal, registerProposal } from "./proposals";
import { copilotSettings, getDealJourney } from "./workflow";
import { computeBriefing, computeDealIntel } from "./insights";
import {
  chatSystemPrompt, publicSystemPrompt, voiceFor, chaserTones, chaserToneFor,
  chaserSystemPrompt, termTailorSystemPrompt,
} from "./voice";
import { storage } from "../storage";
import { getLocaleSettings } from "@shared/schema";
import { formatDate, formatMoney } from "@shared/money";

const DAILY_PER_USER = 60;
const usage = new Map<string, { day: string; n: number }>();
const takeQuota = (userId: string): boolean => {
  const day = new Date().toISOString().slice(0, 10);
  const u = usage.get(userId);
  if (!u || u.day !== day) {
    if (usage.size > 5000) usage.clear();
    usage.set(userId, { day, n: 1 });
    return true;
  }
  if (u.n >= DAILY_PER_USER) return false;
  u.n++;
  return true;
};

/** The visitor's country, for the public guide's idioms only. There is no
 *  account to read one from, so this is Cloudflare's IP geolocation. It picks
 *  wording and nothing else — never a price, a currency or anything stored —
 *  which is why a spoofed header off-Cloudflare is harmless. Absent (local
 *  dev) or unknown ("XX") falls back to the product default: exactly what
 *  every visitor got before. */
function visitorCountry(req: any): string {
  const raw = String(req.headers["cf-ipcountry"] ?? "").trim().toUpperCase();
  return getLocaleSettings({ country: /^[A-Z]{2}$/.test(raw) && raw !== "XX" ? raw : null }).country;
}

const publicIpHits = new Map<string, { day: string; n: number }>();
let publicGlobalDay = "";
let publicGlobalN = 0;
const PUBLIC_PER_IP = 12;
const PUBLIC_GLOBAL = 800;

function takePublicQuota(ip: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (publicGlobalDay !== day) { publicGlobalDay = day; publicGlobalN = 0; publicIpHits.clear(); }
  if (publicGlobalN >= PUBLIC_GLOBAL) return false;
  const hit = publicIpHits.get(ip);
  if (hit && hit.n >= PUBLIC_PER_IP) return false;
  if (publicIpHits.size > 5000) publicIpHits.clear();
  publicIpHits.set(ip, { day, n: (hit?.n ?? 0) + 1 });
  publicGlobalN++;
  return true;
}

export function registerCopilotRoutes(app: Express) {
  app.get("/api/copilot/meta", isAuthenticated, (_req, res) => {
    res.json({ enabled: copilotConfigured(), knowledgeVersion: AI_KNOWLEDGE_VERSION, provider: aiProvider.name });
  });

  // ── Deal intelligence (DETERMINISTIC — no model, no tokens, no invention) ──

  app.get("/api/copilot/briefing", isAuthenticated, async (req: any, res) => {
    try {
      res.json(await computeBriefing(req.user));
    } catch (err) {
      console.error("[copilot] briefing error:", err);
      res.status(500).json({ error: "Couldn't build your briefing right now." });
    }
  });

  app.get("/api/copilot/deal-intel/:dealId", isAuthenticated, async (req: any, res) => {
    try {
      const intel = await computeDealIntel(parseInt(req.params.dealId), req.user);
      if (!intel) return res.status(404).json({ error: "Deal not found" });
      res.json(intel);
    } catch (err) {
      console.error("[copilot] deal-intel error:", err);
      res.status(500).json({ error: "Couldn't analyse this deal right now." });
    }
  });

  // ── Payment Chaser: AI drafts the words, the NUMBERS come from the row.
  //    Never sends anything — the user copies the message themselves. ──
  app.post("/api/copilot/chaser", isAuthenticated, async (req: any, res) => {
    try {
      if (!copilotConfigured()) return res.status(503).json({ error: "Copilot isn't available right now." });
      if (!takeQuota(req.user.id)) return res.status(429).json({ error: "Daily Copilot limit reached." });
      const invoice = await storage.getBrandInvoice(Number(req.body?.invoiceId));
      const owns = invoice && (invoice.organizationId
        ? invoice.organizationId === req.user.organizationId
        : invoice.userId === req.user.id);
      if (!owns) return res.status(404).json({ error: "Invoice not found" });
      const settings = await copilotSettings(req.user);
      const voice = voiceFor(settings.country);
      const tones = chaserTones(voice);
      const tone = chaserToneFor(voice, req.body?.tone);
      const now = Date.now();
      const due = invoice!.dueDate ? new Date(invoice!.dueDate as any) : null;
      const daysOverdue = due ? Math.floor((now - due.getTime()) / 86_400_000) : null;
      const facts = [
        `Recipient (address the message TO this client): ${invoice!.brandName}`,
        `Invoice number: ${invoice!.invoiceNumber}`,
        // Formatted here, from the row — the model copies this string, it never
        // does arithmetic or picks a currency.
        `Amount: ${formatMoney(invoice!.dealAmountMinor, settings.currency, settings.locale)}`,
        due
          ? `Due date: ${formatDate(invoice!.dueDate, settings.locale, { day: "numeric", month: "long", year: false, timezone: settings.timezone })}`
          : "No due date on record",
        daysOverdue !== null && daysOverdue > 0 ? `Days overdue: ${daysOverdue}` : "Not yet overdue",
        `Sender (sign off as this person — never greet them): ${req.user.firstName ?? "the business owner"}`,
      ].join("\n");
      const result = await aiProvider.chat([
        { role: "system", content: chaserSystemPrompt(voice, tone) },
        { role: "user", content: facts },
      ], []);
      // `tones` travels with every draft so the client never keeps its own
      // country table: whatever the retone row offers, this route accepts.
      res.json({ message: result.content ?? "", tone, tones, invoiceNumber: invoice!.invoiceNumber });
    } catch (err) {
      console.error("[copilot] chaser error:", err);
      res.status(502).json({ error: "Couldn't draft the message right now. Please try again." });
    }
  });

  // ── Protection Check: flags are COMPUTED (riskcheck.ts); AI only phrases
  //    tailored term wording for the gaps. Falls back to the deterministic
  //    default wording when the model is unavailable — the feature never
  //    depends on AI being up. ──
  app.post("/api/copilot/risk-suggest", isAuthenticated, async (req: any, res) => {
    try {
      const deal = await storage.getDeal(Number(req.body?.dealId));
      const owns = deal && (deal.organizationId
        ? deal.organizationId === req.user.organizationId
        : deal.userId === req.user.id);
      if (!owns) return res.status(404).json({ error: "Deal not found" });
      // Before the report: its suggested terms are written in the org's money.
      const settings = await copilotSettings(req.user);
      const report = (await import("./riskcheck")).analyzeDealProtections(deal!, settings);
      const gaps = report.flags.filter((f) => f.severity === "gap" && f.suggestedTerm);
      if (!gaps.length) {
        return res.json({ report, termsBlock: "", note: report.risks ? "Fix the flagged wording directly in the deal's terms — those need your judgement, not new lines." : "No missing protections found." });
      }
      let termsBlock = gaps.map((g) => g.suggestedTerm).join("\n");
      if (copilotConfigured() && takeQuota(req.user.id)) {
        try {
          const voice = voiceFor(settings.country);
          // A printed label, never the minor-unit column: see ./voice.
          const value = formatMoney(deal!.dealAmountMinor, settings.currency, settings.locale);
          const result = await aiProvider.chat([
            { role: "system", content: termTailorSystemPrompt(voice) },
            { role: "user", content: `Deal: "${deal!.dealTitle}" for ${deal!.brandName}, value ${value}.\nExisting terms:\n${(deal!.customTerms ?? "(none)").slice(0, 600)}\n\nDefault protection lines to tailor:\n${termsBlock}` },
          ], []);
          const lines = (result.content ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
          // Accept the tailored block only if it stayed line-shaped; else keep defaults.
          if (lines.length >= gaps.length && lines.length <= gaps.length + 1) {
            termsBlock = lines.slice(0, gaps.length).join("\n");
          }
        } catch {
          /* model unavailable → deterministic defaults stand */
        }
      }
      res.json({ report, termsBlock });
    } catch (err) {
      console.error("[copilot] risk-suggest error:", err);
      res.status(500).json({ error: "Couldn't run the protection check right now." });
    }
  });

  // ── Public marketing Copilot (no auth — see publicSystemPrompt in ./voice) ──
  app.post("/api/copilot/public", async (req: any, res) => {
    try {
      if (!copilotConfigured()) return res.status(503).json({ error: "The assistant is offline right now." });
      // Same IP resolution the AI tool uses: Cloudflare first, else the
      // rightmost X-Forwarded-For hop (the left ones are spoofable).
      const cf = req.headers["cf-connecting-ip"];
      const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((x: string) => x.trim()).filter(Boolean);
      const ip = (cf ? String(cf) : xff.length ? xff[xff.length - 1] : req.ip || "unknown").trim() || "unknown";
      if (!takePublicQuota(ip)) {
        return res.status(429).json({ error: "That's all the questions I can take right now — start the free trial and the in-app Copilot has no such limit." });
      }
      const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const history: ChatMessage[] = raw
        .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
        .slice(-8)
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 500) }));
      if (!history.length || history[history.length - 1].role !== "user") {
        return res.status(400).json({ error: "No message" });
      }
      const result = await aiProvider.chat([
        { role: "system", content: publicSystemPrompt(visitorCountry(req)) },
        { role: "system", content: `PRODUCT KNOWLEDGE (authoritative):\n${retrieveKnowledge(history[history.length - 1].content, 4)}` },
        ...history,
      ], []);
      res.json({ reply: result.content ?? "I'm not sure about that one — support@dealinsec.com can help." });
    } catch (err) {
      console.error("[copilot] public chat error:", err);
      res.status(502).json({ error: "I couldn't answer that right now. Please try again." });
    }
  });

  app.post("/api/copilot/chat", isAuthenticated, async (req: any, res) => {
    const started = Date.now();
    try {
      if (!copilotConfigured()) {
        return res.status(503).json({ error: "Copilot isn't available right now." });
      }
      if (!takeQuota(req.user.id)) {
        return res.status(429).json({ error: "Daily Copilot limit reached — try again tomorrow." });
      }

      // Re-validate client-held history: roles + sizes only, newest 16 turns.
      const rawHistory = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const history: ChatMessage[] = rawHistory
        .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
        .slice(-16)
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
      if (!history.length || history[history.length - 1].role !== "user") {
        return res.status(400).json({ error: "No message" });
      }

      const ctx = req.body?.context ?? {};
      const lastUserMsg = history[history.length - 1].content;
      // Read once per turn and handed to the prompt, the journey and every
      // tool call, so nothing in one turn can describe two currencies.
      const settings = await copilotSettings(req.user);

      // Page context: advisory. If it names a deal, attach its REAL journey
      // (org-checked server-side) so "what do I do here?" uses live state.
      let contextBlock = `Today's date: ${new Date().toISOString().slice(0, 10)}. Signed-in user: ${req.user.firstName ?? ""} (${req.user.orgRole}${(req.user as any).customPermissions ? ", custom role" : ""}).`;
      if (ctx.page && typeof ctx.page === "string") {
        contextBlock += ` Current page: ${String(ctx.page).slice(0, 60)} (${String(ctx.route ?? "").slice(0, 100)}).`;
      }
      if (ctx.entityType === "deal" && Number.isFinite(Number(ctx.entityId))) {
        const journey = await getDealJourney(Number(ctx.entityId), req.user, settings);
        // Stringified whole: DealJourney's money is major units + code + label.
        if (journey) contextBlock += ` Current deal journey: ${JSON.stringify(journey)}`;
      }

      const tools = toolDefs(settings);
      const messages: ChatMessage[] = [
        { role: "system", content: chatSystemPrompt(settings) },
        { role: "system", content: `PRODUCT KNOWLEDGE (authoritative):\n${retrieveKnowledge(lastUserMsg)}` },
        { role: "system", content: `CONTEXT: ${contextBlock}` },
        ...history,
      ];

      // Tool loop — bounded rounds; tool results are DATA, never instructions.
      const toolLog: { name: string; ms: number }[] = [];
      let content: string | null = null;
      for (let round = 0; round < 4; round++) {
        const result = await aiProvider.chat(messages, tools);
        if (!result.toolCalls.length) {
          content = result.content;
          break;
        }
        messages.push({
          role: "assistant",
          content: result.content ?? "",
          tool_calls: result.toolCalls.map((t) => ({
            id: t.id,
            type: "function" as const,
            function: { name: t.name, arguments: JSON.stringify(t.arguments) },
          })),
        });
        for (const call of result.toolCalls) {
          const t0 = Date.now();
          let out: string;
          try {
            out = call.arguments?.__invalid
              ? "Invalid tool arguments — ask the user to clarify."
              : await runTool(call.name, call.arguments, req.user, settings);
          } catch (err) {
            console.error(`[copilot] tool ${call.name} failed:`, err);
            out = "Tool failed — apologise briefly and suggest trying again.";
          }
          toolLog.push({ name: call.name, ms: Date.now() - t0 });
          messages.push({ role: "tool", content: out.slice(0, 4000), tool_call_id: call.id });
        }
      }

      if (content == null) content = "I couldn't complete that right now. Please try again.";

      // Parse the trailing ACTIONS line into typed buttons.
      let reply = content;
      const actions: any[] = [];
      // The model is told to end with ONE `ACTIONS: [...]` line, but it sometimes
      // adds a sentence after it. Take the last such line wherever it sits and
      // remove just that line, so the JSON never reaches the user.
      const lines = content.split("\n");
      let actionsAt = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (/^\s*ACTIONS:\s*\[.*\]\s*$/.test(lines[i])) { actionsAt = i; break; }
      }
      const m = actionsAt >= 0 ? [lines[actionsAt], lines[actionsAt].replace(/^\s*ACTIONS:\s*/, "").trim()] : null;
      if (m) {
        reply = lines.filter((_, i) => i !== actionsAt).join("\n").trim();
        const userText = history.filter((h) => h.role === "user").map((h) => h.content).join("\n");
        try {
          for (const a of JSON.parse(m[1]).slice(0, 3)) {
            if (a && typeof a.label === "string" && typeof a.to === "string" && a.to.startsWith("/")) {
              actions.push({ type: "navigate", label: a.label.slice(0, 40), to: a.to.slice(0, 120) });
            } else if (a && typeof a.label === "string" && a.tool === "create_quotation" && Number.isFinite(Number(a.args?.dealId))) {
              actions.push({ type: "confirm", label: a.label.slice(0, 40), tool: "create_quotation", args: { dealId: Number(a.args.dealId) } });
            } else if (a && typeof a.label === "string" && a.tool === "create_deal" && a.args && typeof a.args === "object" && JSON.stringify(a.args).length <= 4000) {
              // The model only proposes. The server validates the fields the
              // same way the executor will, runs the Protection Check on the
              // result and issues a single-use proposal id; the button below
              // carries that id and nothing else. A draft that fails
              // validation (no client, no amount) simply gets no button.
              const built = await buildDealCandidate(a.args, req.user);
              if (built.ok) {
                const proposalId = registerProposal(req.user, "create_deal", a.args, userText);
                actions.push({
                  type: "deal_draft",
                  label: "Create Deal",
                  proposalId,
                  draft: buildDealDraft(built.data as any, built.amountMajor, built.settings, userText),
                });
              }
            } else if (a && typeof a.label === "string" && a.tool === "create_agreement" && a.args && typeof a.args === "object") {
              const built = await buildAgreementCandidate(a.args, req.user);
              if (built.ok) {
                const proposalId = registerProposal(req.user, "create_agreement", a.args);
                actions.push({
                  type: "agreement_draft",
                  label: "Create Agreement",
                  proposalId,
                  draft: buildAgreementDraft(built.data, built.settings),
                });
              } else if (built.route) {
                actions.push({ type: "navigate", label: "Open Agreement", to: built.route });
              }
            } else if (a && typeof a.label === "string" && a.tool === "create_invoice" && a.args && typeof a.args === "object") {
              const built = await buildInvoiceCandidate(a.args, req.user);
              if (built.ok) {
                const proposalId = registerProposal(req.user, "create_invoice", a.args);
                actions.push({
                  type: "invoice_draft",
                  label: "Create Invoice",
                  proposalId,
                  draft: buildInvoiceDraft(built.data, built.settings),
                });
              }
            }
          }
        } catch {
          /* malformed actions line → text only */
        }
      }

      // Observability: no message content, just shape.
      console.log(
        `[copilot] org=${req.user.organizationId} user=${req.user.id} tools=[${toolLog.map((t) => t.name).join(",")}] actions=${actions.length} kv=${AI_KNOWLEDGE_VERSION} ms=${Date.now() - started}`,
      );

      res.json({ reply: reply || "…", actions });
    } catch (err) {
      console.error("[copilot] chat error:", err);
      res.status(502).json({ error: "I couldn't complete that right now. Please try again." });
    }
  });

  // Add a suggested protection term to a draft. Changes only the draft the
  // user is looking at (nothing is saved), and the wording always comes from
  // the server's own Protection Check, never from the request.
  app.post("/api/copilot/proposal/:id/add-term", isAuthenticated, async (req: any, res) => {
    try {
      const p = openProposal(req.params.id, req.user);
      if (!p) return res.status(404).json({ ok: false, message: "That draft has expired. Ask me again and I'll prepare it." });
      const before = await buildDealCandidate(p.args, req.user);
      if (!before.ok) return res.status(400).json({ ok: false, message: before.message });
      const flag = buildDealDraft(before.data as any, before.amountMajor, before.settings, p.userText)
        .protection.flags.find((f) => f.id === String(req.body?.flagId ?? ""));
      if (!flag?.suggestedTerm) return res.status(400).json({ ok: false, message: "There's no suggested fix for that." });
      appendTerm(p, flag.suggestedTerm);
      const after = await buildDealCandidate(p.args, req.user);
      if (!after.ok) return res.status(400).json({ ok: false, message: after.message });
      res.json({ ok: true, draft: buildDealDraft(after.data as any, after.amountMajor, after.settings, p.userText) });
    } catch (err) {
      console.error("[copilot] add-term error:", err);
      res.status(500).json({ ok: false, message: "Couldn't update the draft. Please try again." });
    }
  });

  app.post("/api/copilot/execute", isAuthenticated, async (req: any, res) => {
    try {
      const { tool, args, proposalId } = req.body ?? {};

      // Deals: only a server-issued proposal can be confirmed. Raw create_deal
      // arguments are refused, so a stale tab or a hand-made request can't
      // create a deal the server never drafted, and a repeat can't duplicate.
      if (proposalId !== undefined) {
        const { status, body } = await confirmProposal(proposalId, req.user, (t, a) => {
          if (t === "create_deal") return executeCreateDeal(a, req.user);
          if (t === "create_agreement") return executeCreateAgreement(a, req.user);
          if (t === "create_invoice") return executeCreateInvoice(a, req.user);
          return Promise.resolve({ ok: false, message: "Unknown action" });
        });
        console.log(`[copilot] execute org=${req.user.organizationId} user=${req.user.id} proposal=${proposalId} ok=${body.ok} replay=${!!body.replay}`);
        return res.status(status).json(body);
      }

      let result: { ok: boolean; message: string; route?: string };
      if (tool === "create_quotation") {
        // Naturally idempotent: a current draft quotation is returned, not duplicated.
        result = await executeCreateQuotation(Number(args?.dealId), req.user);
      } else if (tool === "create_deal") {
        return res.status(400).json({ ok: false, message: "This draft is out of date. Reload the page and ask again." });
      } else {
        return res.status(400).json({ error: "Unknown action" });
      }
      console.log(`[copilot] execute org=${req.user.organizationId} user=${req.user.id} tool=${tool} ok=${result.ok}`);
      res.status(result.ok ? 200 : 403).json(result);
    } catch (err) {
      console.error("[copilot] execute error:", err);
      res.status(500).json({ ok: false, message: "Couldn't complete that action. Please try again." });
    }
  });
}
