/**
 * A coworker's task, as the runtime drives it: deterministic TypeScript steps over a checkpoint, each one bounded.
 * A step calls the app's own services AS THE PERSON who started the task (their permissions, their plan's allowances),
 * and reports what really happened. The model never decides what a step may do.
 */
import type { LeagueReport } from "@shared/ai-league";
import type { LeagueRunRow, User } from "@shared/schema";

export interface TaskCtx {
  run: LeagueRunRow;
  /** The person, freshly loaded: every service call is authorized against them. */
  user: User;
  checkpoint: Record<string, unknown>;
  now(): Date;
  /** A truthful milestone the person sees ("Research started", "3 leads saved"). */
  event(kind: string, message: string, data?: Record<string, unknown>): Promise<void>;
  addUsage(tokensIn: number, tokensOut: number): void;
}

export type StepOutcome =
  | { kind: "continue"; stage: string; checkpoint?: Record<string, unknown> }
  | { kind: "wait"; stage: string; until: Date; checkpoint?: Record<string, unknown> }
  | { kind: "finish"; status: "completed" | "partial" | "failed"; report: LeagueReport; errorCode?: string | null };

export interface TaskHandler {
  step(ctx: TaskCtx, stage: string): Promise<StepOutcome>;
}

export const failed = (headline: string, errorCode: string, notes: string[] = []): StepOutcome =>
  ({ kind: "finish", status: "failed", errorCode, report: { headline, counts: [], items: [], notes, next: null } });
