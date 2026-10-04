/** /api/document-style: read (any member, so documents can print in it) and change (organization settings). */
import type { Express, Request, Response } from "express";
import { isAuthenticated } from "../auth";
import { agentLog } from "../agent/log";
import * as styles from "../services/document-style";
import { documentStyleTableReady } from "./style-store";

export function registerDocumentStyleRoutes(app: Express) {
  const gate = async (req: Request, res: Response, next: () => void) => {
    if (!(req as any).user?.organizationId) return res.status(403).json({ code: "no_organization", error: "Finish setting up your workspace first." });
    try {
      if (!(await documentStyleTableReady())) return res.status(503).json({ code: "DOCUMENT_STYLE_NOT_SETUP", error: "Document styles aren't set up on this server yet." });
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "document_style_tables" });
      return res.status(503).json({ code: "DOCUMENT_STYLE_NOT_SETUP", error: "Document styles aren't available right now." });
    }
    next();
  };
  const send = (res: Response, r: Awaited<ReturnType<typeof styles.getDocumentStyle>> | Awaited<ReturnType<typeof styles.saveDocumentStyle>>) => {
    if (r.ok) { const { ok: _ok, ...rest } = r; return res.json(rest); }
    const { ok: _ok, status, message, code, ...extra } = r as any;
    return res.status(status).json({ code, error: message, ...extra });
  };
  const guarded = (fn: (req: any, res: Response) => Promise<unknown>, where: string) => async (req: any, res: Response) => {
    try { await fn(req, res); } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where });
      res.status(500).json({ code: "internal", error: "Something went wrong on our side. Nothing was changed." });
    }
  };
  app.get("/api/document-style", isAuthenticated, gate, guarded(async (req, res) => send(res, await styles.getDocumentStyle(req.user)), "style_get"));
  app.put("/api/document-style", isAuthenticated, gate, guarded(async (req, res) => send(res, await styles.saveDocumentStyle(req.user, req.body)), "style_save"));
}
