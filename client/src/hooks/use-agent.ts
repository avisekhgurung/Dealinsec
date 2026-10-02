/**
 * One agent conversation: its messages, the live progress of a run, and the
 * approvals waiting on the user. Used by the full /agent page and by the
 * compact Copilot drawer, so both talk to the same backend the same way.
 *
 * Nothing here decides anything. The server runs the agent and says what
 * happened; this hook turns the event stream into state the components render,
 * and sends the user's own clicks (send, stop, approve, decline) back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AgentHttpError, postStream } from "@/lib/agent-stream";
import { trackEvent } from "@/lib/analytics";
import {
  FUNNEL_EVENT, approvalStatusFromServer, reduceSteps,
  type ActivityStep, type AgentCard, type AgentEvent, type ApprovalStatus,
} from "@shared/agent";

export interface ThreadMessage {
  key: string;
  role: "user" | "assistant";
  content: string;
  cards: AgentCard[];
  /** What the agent did to produce this reply (assistant messages, live runs only). */
  steps?: ActivityStep[];
  /** A failed run: the text to send again. */
  error?: { retryText: string };
}

export interface ApprovalView {
  status: ApprovalStatus;
  /** For done/failed: what the server said. */
  message?: string;
  route?: string;
}

export interface AgentContext {
  page?: string;
  route?: string;
  dealId?: number;
}

export interface UseAgentOptions {
  context?: AgentContext;
  /** The conversation to open (the page's route param). */
  sessionId?: string | null;
  /** Called when a conversation is created or cleared, so the page can update its URL. */
  onSessionChange?: (id: string | null) => void;
}

let keySeq = 0;
const nextKey = () => `m${++keySeq}`;

const REFRESH_ALL = () =>
  queryClient.invalidateQueries({
    predicate: (q) => {
      const k = String(q.queryKey[0] ?? "");
      return k.startsWith("/api/") && !k.startsWith("/api/agent");
    },
  });

/** A refusal that came back as JSON before any streaming, in the user's words. */
function describeHttpError(err: unknown): string {
  if (err instanceof AgentHttpError) {
    if (err.code === "AGENT_NOT_SETUP" || err.status === 503) return err.message || "The agent isn't available right now.";
    if (err.status === 429) return err.message || "You've reached today's AI limit. It resets tomorrow.";
    if (err.status === 401) return "You've been signed out. Sign in again to continue.";
    return err.message || "Something went wrong. Nothing was changed.";
  }
  return "I lost the connection. Nothing was changed. Check your connection and try again.";
}

export function useAgent(opts: UseAgentOptions = {}) {
  const { context, onSessionChange } = opts;
  const [sessionId, setSessionId] = useState<string | null>(opts.sessionId ?? null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [approvals, setApprovals] = useState<Record<string, ApprovalView>>({});
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ActivityStep[]>([]);
  const [loading, setLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const sendLock = useRef(false);
  const approving = useRef(new Set<string>());
  const stepsRef = useRef<ActivityStep[]>([]);
  const lastText = useRef("");
  // A conversation this hook just created locally has nothing to load.
  const skipLoadFor = useRef<string | null>(null);
  // The conversation this hook itself started. The page's URL follows it, and
  // that URL change must not be mistaken for someone opening a different one
  // (which would abort the run that is just starting).
  const createdHere = useRef<string | null>(null);
  const ctxRef = useRef(context);
  ctxRef.current = context;

  // ── open an existing conversation ────────────────────────────────────────
  useEffect(() => {
    const id = opts.sessionId ?? null;
    if (id === sessionId || (id !== null && id === createdHere.current)) return;
    createdHere.current = null;
    abortRef.current?.abort();
    setSessionId(id);
    if (!id) { setMessages([]); setApprovals({}); setSteps([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.sessionId]);

  const loadTranscript = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await apiRequest("GET", `/api/agent/sessions/${id}`);
      const data = await res.json();
      setMessages((data.messages ?? []).map((m: any): ThreadMessage => ({ key: `s${m.id}`, role: m.role, content: m.content, cards: m.cards ?? [] })));
      const next: Record<string, ApprovalView> = {};
      for (const a of data.approvals ?? []) next[a.id] = { status: approvalStatusFromServer(a.status, a.expiresAt), message: a.result?.message, route: a.result?.route };
      setApprovals(next);
    } catch {
      setMessages([{ key: nextKey(), role: "assistant", content: "I couldn't open that conversation.", cards: [] }]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    if (skipLoadFor.current === sessionId) { skipLoadFor.current = null; return; }
    void loadTranscript(sessionId);
  }, [sessionId, loadTranscript]);

  const append = (m: Omit<ThreadMessage, "key">) => setMessages((cur) => [...cur, { key: nextKey(), ...m }]);
  const setApproval = (id: string, v: ApprovalView) => setApprovals((cur) => ({ ...cur, [id]: v }));

  // ── send ─────────────────────────────────────────────────────────────────
  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || sendLock.current) return;
    sendLock.current = true;
    lastText.current = text;
    let sid = sessionId;
    try {
      if (!sid) {
        // The conversation isn't bound to a deal: the page's deal travels with
        // each message as advisory context instead, so a chat can move on.
        const res = await apiRequest("POST", "/api/agent/sessions", {});
        sid = (await res.json()).id as string;
        skipLoadFor.current = sid;
        createdHere.current = sid;
        setSessionId(sid);
        onSessionChange?.(sid);
      }
    } catch (err) {
      append({ role: "assistant", content: describeHttpError(err), cards: [], error: { retryText: text } });
      sendLock.current = false;
      return;
    }

    append({ role: "user", content: text, cards: [] });
    trackEvent("agent_message_sent", { has_deal_context: !!ctxRef.current?.dealId, long_message: text.length >= 200 });
    const ac = new AbortController();
    abortRef.current = ac;
    stepsRef.current = [];
    setSteps([]);
    setRunning(true);

    let mutated = false;
    let finished = false;
    const onEvent = (e: AgentEvent) => {
      stepsRef.current = reduceSteps(stepsRef.current, e);
      setSteps(stepsRef.current);
      switch (e.type) {
        case "agent.started": trackEvent("agent_run_started"); break;
        case "agent.tool_started": trackEvent("agent_tool_called", { tool: String(e.data.tool ?? ""), risk: String(e.data.risk ?? "") }); break;
        case "agent.tool_completed":
          trackEvent("agent_tool_completed", { tool: String(e.data.tool ?? "") });
          if (e.data.tool === "analyze_deal_message") trackEvent("agent_deal_extracted");
          break;
        case "agent.needs_confirmation": trackEvent("agent_approval_requested", { tool: String(e.data.tool ?? "") }); break;
        case "agent.executing": mutated = true; break;
        case "agent.message": {
          const cards = (e.data.cards as AgentCard[] | undefined) ?? [];
          for (const c of cards) if (c.kind === "approval") setApproval(String(c.data.approvalId), { status: "pending" });
          append({ role: "assistant", content: String(e.data.text ?? ""), cards, steps: stepsRef.current.map((s) => (s.state === "active" ? { ...s, state: "done" as const } : s)) });
          break;
        }
        case "agent.completed": finished = true; trackEvent("agent_run_completed", { status: String(e.data.status ?? "") }); break;
        case "agent.failed":
          finished = true;
          if (!e.data.cancelled) {
            trackEvent("agent_run_failed", { code: String(e.data.code ?? "") });
            append({ role: "assistant", content: String(e.data.message ?? "That didn't work. Nothing was changed."), cards: [], error: { retryText: text } });
          }
          break;
      }
    };

    try {
      await postStream(`/api/agent/sessions/${sid}/messages`, { text, context: ctxRef.current }, { signal: ac.signal, onEvent });
      if (!finished) throw new Error("stream ended early");
    } catch (err) {
      if (ac.signal.aborted) {
        // The user pressed Stop. The server records the run as cancelled.
      } else if (err instanceof AgentHttpError) {
        trackEvent("agent_run_failed", { code: `http_${err.status}` });
        append({ role: "assistant", content: describeHttpError(err), cards: [], error: { retryText: text } });
      } else {
        // The connection dropped mid-run. The server finished (or stopped) it
        // on its own and saved the outcome: show what it says now.
        trackEvent("agent_run_failed", { code: "connection_lost" });
        if (sid) await loadTranscript(sid);
      }
    } finally {
      if (mutated) void REFRESH_ALL();
      void queryClient.invalidateQueries({ queryKey: ["/api/agent/sessions"] });
      setRunning(false);
      setSteps([]);
      stepsRef.current = [];
      abortRef.current = null;
      sendLock.current = false;
    }
  }, [sessionId, onSessionChange, loadTranscript]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const retry = useCallback(() => {
    if (!lastText.current) return;
    // Drop the failed reply (and the user message it answered) so the retry reads cleanly.
    setMessages((cur) => {
      const copy = [...cur];
      if (copy.at(-1)?.error) copy.pop();
      if (copy.at(-1)?.role === "user" && copy.at(-1)?.content === lastText.current) copy.pop();
      return copy;
    });
    void send(lastText.current);
  }, [send]);

  // ── approvals ────────────────────────────────────────────────────────────
  const approve = useCallback(async (approvalId: string, tool: string) => {
    if (approving.current.has(approvalId)) return; // two clicks in one tick
    approving.current.add(approvalId);
    setApproval(approvalId, { status: "executing" });
    trackEvent("agent_approval_granted", { tool });
    let final: { ok?: boolean; status?: number; message?: string; route?: string } | null = null;
    try {
      await postStream(`/api/agent/approvals/${approvalId}/approve`, undefined, {
        onEvent: (e) => {
          if (e.type === "agent.message") {
            const cards = (e.data.cards as AgentCard[] | undefined) ?? [];
            append({ role: "assistant", content: String(e.data.text ?? ""), cards });
          }
          if ((e.type === "agent.completed" || e.type === "agent.failed") && e.data.final) final = e.data as any;
        },
      });
    } catch (err) {
      final = { ok: false, status: err instanceof AgentHttpError ? err.status : 0, message: describeHttpError(err) };
    } finally {
      approving.current.delete(approvalId);
    }
    const f = final as { ok?: boolean; status?: number; message?: string; route?: string } | null;
    if (f?.ok) {
      setApproval(approvalId, { status: "done", message: f.message, route: f.route });
      if (FUNNEL_EVENT[tool] && !(f as any).replay) trackEvent(FUNNEL_EVENT[tool]);
      void REFRESH_ALL();
    } else if (f?.status === 410 || f?.status === 404) {
      setApproval(approvalId, { status: "expired", message: f.message });
    } else if (f?.status === 409 && /declined/i.test(f.message ?? "")) {
      setApproval(approvalId, { status: "declined", message: f.message });
    } else {
      // Nothing was changed and the server put the request back: the user can try again.
      setApproval(approvalId, { status: "failed", message: f?.message ?? "That didn't go through. Nothing was changed." });
    }
    if (sessionId) void queryClient.invalidateQueries({ queryKey: ["/api/agent/sessions"] });
  }, [sessionId]);

  const reject = useCallback(async (approvalId: string, tool: string) => {
    try {
      await apiRequest("POST", `/api/agent/approvals/${approvalId}/reject`);
      trackEvent("agent_approval_rejected", { tool });
      setApproval(approvalId, { status: "declined" });
    } catch {
      setApproval(approvalId, { status: "expired", message: "That request isn't available any more." });
    }
  }, []);

  // ── conversations ────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    abortRef.current?.abort();
    createdHere.current = null;
    setSessionId(null);
    setMessages([]);
    setApprovals({});
    setSteps([]);
    onSessionChange?.(null);
  }, [onSessionChange]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { sessionId, messages, approvals, running, steps, loading, send, stop, retry, approve, reject, reset };
}
