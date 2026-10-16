import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyReply, conversationStatusFor } from "./reply-rules";

const c = (text: string | null, o: { subject?: string; kind?: "reply" | "auto_reply" | "bounce" } = {}) => classifyReply({ kind: o.kind ?? "reply", subject: o.subject ?? "Re: A quick idea", text });

describe("classifyReply: rules only, conservative", () => {
  it("delivery failures and auto-replies", () => {
    expect(c("Address not found", { kind: "bounce" })).toBe("bounce");
    expect(c("I'm away until Monday", { kind: "auto_reply" })).toBe("out_of_office");
    expect(c("Thanks for your email. I am out of the office with limited access to email.")).toBe("out_of_office");
  });

  it("opt-outs win over anything friendlier, in the text or the subject", () => {
    for (const t of ["Please remove me from your list.", "unsubscribe", "Stop emailing me", "Don't contact us again", "Interested, but please take me off this list", "No more emails please", "Please opt out my address"]) {
      expect(c(t), t).toBe("opt_out");
    }
    expect(c("thanks", { subject: "UNSUBSCRIBE" })).toBe("opt_out");
    expect(c("I’m on holiday, please stop emailing me", { kind: "auto_reply" })).toBe("opt_out");
  });

  it("a single clear intent", () => {
    expect(c("Sounds good — let's talk next week.")).toBe("interested");
    expect(c("We're interested. When are you free?")).toBe("interested");
    expect(c("Can you send more information and your pricing?")).toBe("more_info");
    expect(c("Not interested, thanks.")).toBe("not_interested");
    expect(c("We already work with an agency, so we'll pass.")).toBe("not_interested");
  });

  it("\"not interested\" is never read as \"interested\"", () => {
    expect(c("I'm not interested")).toBe("not_interested");
  });

  it("mixed or unclear replies need a person", () => {
    expect(c("Not right now, but send more info for next quarter")).toBe("needs_review");
    expect(c("Who is this?")).toBe("needs_review");
    expect(c("Ok")).toBe("needs_review");
    expect(c(null)).toBe("needs_review");
    expect(c(`${"Long story about our company history. ".repeat(30)} Sounds good, let's talk.`)).toBe("needs_review"); // intent only past the opening
  });

  it("maps labels to conversation states; an auto-reply changes nothing", () => {
    expect(conversationStatusFor("out_of_office")).toBeNull();
    expect(conversationStatusFor("opt_out")).toBe("opted_out");
    expect(conversationStatusFor("more_info")).toBe("replied");
  });

  it("imports nothing that could reach a model, a network or a database", () => {
    const src = readFileSync(new URL("./reply-rules.ts", import.meta.url), "utf8");
    const imports = Array.from(src.matchAll(/^(?:import|export) .* from "([^"]+)"/gm)).map((m) => m[1]);
    expect(new Set(imports)).toEqual(new Set(["@shared/inbox-view", "./reply-match"])); // types and label text only
  });
});
