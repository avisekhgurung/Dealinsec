import { describe, expect, it } from "vitest";
import { robotsAllows, robotsRules } from "./robots";

describe("robots.txt (RFC 9309 matching)", () => {
  const TXT = `
# comments are ignored
User-agent: *
Disallow: /private
Allow: /private/press
Disallow: /*.pdf$

User-agent: Googlebot
Disallow: /

User-agent: DealInSec
User-agent: OtherBot
Disallow: /careers
`;
  it("our own group wins over *, and a group naming several agents applies to each", () => {
    const ours = robotsRules(TXT, "DealInSec");
    expect(robotsAllows(ours, "/careers")).toBe(false);
    expect(robotsAllows(ours, "/private")).toBe(true); // the * group doesn't apply once ours exists
  });
  it("without our group: the * group, longest match wins, Allow wins a tie, * and $ patterns", () => {
    const star = robotsRules(TXT, "SomeoneElse");
    expect(robotsAllows(star, "/private/team")).toBe(false);
    expect(robotsAllows(star, "/private/press/2026")).toBe(true);
    expect(robotsAllows(star, "/files/brochure.pdf")).toBe(false);
    expect(robotsAllows(star, "/files/brochure.pdf?v=2")).toBe(true);
    expect(robotsAllows(star, "/")).toBe(true);
  });
  it("an empty Disallow, no robots.txt, or rubbish: everything is allowed", () => {
    expect(robotsAllows(robotsRules("User-agent: *\nDisallow:", "DealInSec"), "/anything")).toBe(true);
    expect(robotsAllows(robotsRules("", "DealInSec"), "/")).toBe(true);
    expect(robotsAllows(robotsRules("<html>not robots</html>", "DealInSec"), "/")).toBe(true);
  });
  it("a whole-site disallow for * applies to us", () => {
    expect(robotsAllows(robotsRules("User-agent: *\nDisallow: /", "DealInSec"), "/")).toBe(false);
  });
});
