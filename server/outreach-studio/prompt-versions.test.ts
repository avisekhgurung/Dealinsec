/**
 * Every prompt version the app records in llm_calls must fit its column. A longer one can't be saved, the spend
 * reservation fails, and the request is refused as "not set up" — that is how "More professional" and "More
 * conversational" failed in the 12 Nov 2026 real-model test ("rewrite-v1:conversational" is 25 characters).
 */
import { describe, expect, it } from "vitest";
import { llmCalls } from "@shared/schema";
import { PROMPT_VERSION_MAX, REWRITE_ACTIONS, rewriteVersion } from "./rewrite-prompt";
import { versionFor } from "../sales/outreach-prompt";
import { CHANNEL_PROMPT_VERSION } from "../channels/prompt";
import { RESEARCH_PROMPT_VERSION } from "../sales/research-prompt";
import { PROMPT_VERSIONS } from "../outbound/prompts";
import { OUTREACH_STRATEGIES } from "@shared/outreach-strategy";

describe("prompt versions fit llm_calls.prompt_version", () => {
  it("the limit here is the column's own length", () => {
    expect((llmCalls.promptVersion as unknown as { length: number }).length).toBe(PROMPT_VERSION_MAX);
  });
  it("every rewrite, draft, channel, research and Radar version is short enough", () => {
    const all = [
      ...REWRITE_ACTIONS.map(rewriteVersion),
      ...OUTREACH_STRATEGIES.map((s) => versionFor(s)),
      CHANNEL_PROMPT_VERSION, RESEARCH_PROMPT_VERSION, "followup-t1", ...Object.values(PROMPT_VERSIONS),
      "zee-brief-v1", "team-summary-v1",
    ];
    const tooLong = all.filter((v) => v.length > PROMPT_VERSION_MAX);
    expect(tooLong).toEqual([]);
  });
  it("rewrites are never counted as AI drafts (those start with draft-)", () => {
    for (const a of REWRITE_ACTIONS) expect(rewriteVersion(a).startsWith("draft-")).toBe(false);
  });
});

import { rewriteShortfall } from "./rewrite-prompt";
describe("a rewrite that didn't do what was asked gets one more try", () => {
  const long = "word ".repeat(100).trim();
  it("Shorten must really be shorter", () => {
    expect(rewriteShortfall("shorten", long, "word ".repeat(94))).toMatch(/70 words or fewer/);
    expect(rewriteShortfall("shorten", long, "word ".repeat(70))).toBeNull();
  });
  it("More conversational drops 'Dear' and 'Kind regards'", () => {
    expect(rewriteShortfall("conversational", long, "Dear Casa team,\n\nHello.\n\nKind regards,\nRavi")).toMatch(/formally/);
    expect(rewriteShortfall("conversational", long, "Hi Casa team,\n\nHello.\n\nThanks,\nRavi")).toBeNull();
  });
  it("other actions are judged by the safety checks only", () => {
    expect(rewriteShortfall("professional", long, "Hey")).toBeNull();
  });
});
