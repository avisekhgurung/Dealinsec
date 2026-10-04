/**
 * Knowledge: HTTP surface (all under /api/knowledge, all authenticated).
 *
 *   GET    /api/knowledge              the sources, usage and limits
 *   POST   /api/knowledge/note         { title, text }
 *   POST   /api/knowledge/url          { url, title? }   fetched once, now
 *   POST   /api/knowledge/pdf          multipart: file, title?
 *   POST   /api/knowledge/image        multipart: file, title, description
 *   GET    /api/knowledge/search?q=    what the agent would find for a question
 *   GET    /api/knowledge/:id/image    the picture (this workspace only)
 *   DELETE /api/knowledge/:id
 *
 * Every rule lives in server/services/knowledge.ts; a route parses the request and maps the
 * result to HTTP. A source in another workspace answers 404, like one that doesn't exist.
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import { LIMITS } from "@shared/knowledge";
import { isAuthenticated } from "../auth";
import { agentLog } from "../agent/log";
import * as kb from "../services/knowledge";
import { createRateLimiter } from "./rate-limit";
import { knowledgeTablesReady } from "./store";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.pdfBytes, files: 1, fields: 6, fieldSize: 40_000 } });
// Each costs something real (a fetch, a parse): 30 additions an hour per workspace is far more than a person does by hand.
const addLimiter = createRateLimiter(30, 60 * 60 * 1000);

export function registerKnowledgeRoutes(app: Express) {
  const gate = async (req: Request, res: Response, next: () => void) => {
    if (!(req as any).user?.organizationId) return res.status(403).json({ code: "no_organization", error: "Finish setting up your workspace first." });
    try {
      if (!(await knowledgeTablesReady())) return res.status(503).json({ code: "KNOWLEDGE_NOT_SETUP", error: "Knowledge isn't set up on this server yet." });
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "knowledge_tables" });
      return res.status(503).json({ code: "KNOWLEDGE_NOT_SETUP", error: "Knowledge isn't available right now." });
    }
    next();
  };
  const limited = (req: Request, res: Response, next: () => void) => {
    if (!addLimiter.take(String((req as any).user.organizationId))) return res.status(429).json({ code: "rate_limited", error: "That's a lot of additions at once. Try again in a little while." });
    next();
  };
  const send = (res: Response, r: { ok: boolean } & Record<string, any>, created = false) => {
    if (r.ok) { const { ok: _ok, ...rest } = r; return res.status(created ? 201 : 200).json(rest); }
    const { ok: _ok, status, message, code, ...extra } = r;
    return res.status(status).json({ code, error: message, ...extra });
  };
  const guarded = (fn: (req: any, res: Response) => Promise<unknown>, where: string) => async (req: any, res: Response) => {
    try { await fn(req, res); } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where });
      res.status(500).json({ code: "internal", error: "Something went wrong on our side. Nothing was added." });
    }
  };
  /** multer's own refusals (too big, too many parts) as JSON in the same shape. */
  const withUpload = (req: Request, res: Response, next: () => void) =>
    upload.single("file")(req, res, (err?: any) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ code: "too_big", error: "That file is too large." });
      return res.status(400).json({ code: "invalid", error: "That upload couldn't be read." });
    });

  app.get("/api/knowledge", isAuthenticated, gate, guarded(async (req, res) => send(res, await kb.listKnowledge(req.user)), "knowledge_list"));
  app.get("/api/knowledge/search", isAuthenticated, gate, guarded(async (req, res) => send(res, await kb.searchKnowledge(req.user, String(req.query.q ?? ""))), "knowledge_search"));
  app.post("/api/knowledge/note", isAuthenticated, gate, guarded(async (req, res) => send(res, await kb.addNote(req.user, req.body), true), "knowledge_note"));
  app.post("/api/knowledge/url", isAuthenticated, gate, limited, guarded(async (req, res) => send(res, await kb.addUrl(req.user, req.body), true), "knowledge_url"));
  app.post("/api/knowledge/pdf", isAuthenticated, gate, limited, withUpload, guarded(async (req, res) => {
    if (!req.file) return res.status(400).json({ code: "invalid", error: "Choose a PDF." });
    return send(res, await kb.addPdf(req.user, { bytes: req.file.buffer, name: req.file.originalname }, typeof req.body?.title === "string" ? req.body.title : undefined), true);
  }, "knowledge_pdf"));
  app.post("/api/knowledge/image", isAuthenticated, gate, limited, withUpload, guarded(async (req, res) => {
    if (!req.file) return res.status(400).json({ code: "invalid", error: "Choose a picture." });
    if (req.file.size > LIMITS.imageBytes) return res.status(413).json({ code: "too_big", error: "That picture is too large." });
    return send(res, await kb.addImage(req.user, { bytes: req.file.buffer, name: req.file.originalname }, { title: req.body?.title, description: req.body?.description }), true);
  }, "knowledge_image"));
  app.get("/api/knowledge/:id/image", isAuthenticated, gate, guarded(async (req, res) => {
    const r = await kb.readImage(req.user, String(req.params.id));
    if (!r.ok) return send(res, r);
    // A picture, never a document: no sniffing, no scripts, no framing, no sharing between people.
    res.set({ "Content-Type": r.mime, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, max-age=300", "Content-Disposition": "inline" });
    return res.send(r.bytes);
  }, "knowledge_image_read"));
  app.delete("/api/knowledge/:id", isAuthenticated, gate, guarded(async (req, res) => send(res, await kb.removeSource(req.user, String(req.params.id))), "knowledge_delete"));
}
