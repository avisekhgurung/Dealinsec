import { describe, expect, it } from "vitest";
import { analysePost, askFocus, classifyIntent, discussionQueries, excerptOf, extractSignals, mentionsPhrase, platformOfUrl, postUrl, redditQueries, requestedService, socialScore, SOCIAL_PLATFORMS, SOCIAL_WEIGHTS } from "./social-intent";

const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const cat = (t: string) => classifyIntent(t).category;

describe("what kind of post it is", () => {
  it("direct hiring intent", () => {
    for (const t of [
      "[Hiring] React developer for a 3 month contract",
      "Looking to hire a developer for our startup",
      "Looking for a web developer to rebuild our store",
      "Need someone to build an MVP for my startup",
      "Searching for an SEO agency that understands SaaS",
      "Looking for a freelancer for an upcoming project",
      "We need a designer for our landing page",
      "Who can build a Shopify store for me?",
      "SEEKING FREELANCER: brand design for our studio",
      "Looking for someone to redo our website",
    ]) expect([t, cat(t)]).toEqual([t, "hiring"]);
  });

  it("recommendation intent", () => {
    for (const t of [
      "Can anyone recommend an SEO agency?",
      "Any recommendations for a reliable web developer?",
      "Who do you use for bookkeeping?",
      "Does anyone know a good Webflow designer?",
    ]) expect([t, cat(t)]).toEqual([t, "recommendation"]);
  });

  it("partnership intent, which is more specific than a one-off hire", () => {
    for (const t of [
      "Looking for a white-label agency to handle overflow",
      "Searching for development partners for client work",
      "Need an outsourcing partner for our agency",
    ]) expect([t, cat(t)]).toEqual([t, "partnership"]);
  });

  it("a stated problem, when nothing stronger is said", () => {
    for (const t of [
      "Our current website isn't converting",
      "We are struggling to generate leads",
      "Our manual processes are taking too much time",
      "We need to automate our workflow",
    ]) expect([t, cat(t)]).toEqual([t, "problem"]);
  });

  it("talk is not an opportunity", () => {
    for (const t of ["What do you think about React vs Vue in 2026?", "How I grew my agency to 10 clients", "Is SEO dead?", ""])
      expect([t, cat(t)]).toEqual([t, "discussion"]);
  });

  // The person's competitors, not their clients. r/forhire is half of these.
  it("a freelancer advertising themselves is never an opportunity", () => {
    for (const t of [
      "[For Hire] Full-stack developer, 8 years experience",
      "For hire: logo designer with fast turnaround",
      "I'm a web developer looking for new clients",
      "I am a designer available for freelance work",
      "SEEKING WORK | Remote | React, Node",
      "Offering my SEO services at a discount this month",
      "Experienced copywriter — hire me",
    ]) expect([t, cat(t)]).toEqual([t, "offer"]);
  });

  // Found in the browser: this was badged "Wants to hire" because it also states a budget.
  it("an explicit ask for a recommendation stays one, even when it names a budget or says what they need", () => {
    expect(cat("Can anyone recommend a web design agency for a small bakery? Budget around $1,500.")).toBe("recommendation");
    expect(cat("Any recommendations? We need a developer for our store.")).toBe("recommendation");
    expect(cat("Our budget is $2,000 for a new logo")).toBe("hiring"); // a budget alone still reads as wanting to buy
    expect(cat("Looking to hire — can anyone recommend a good agency?")).toBe("hiring"); // explicit hiring words still win
  });

  it("the poster's own [Hiring] tag wins over offer-like wording in the body", () => {
    expect(cat("[Hiring] We are a small studio looking for new clients' sites to be built by a contractor")).toBe("hiring");
  });

  it("quotes the words that decided it, and says how sure it is", () => {
    expect(classifyIntent("Hi all — we're looking to hire a developer next month")).toMatchObject({ category: "hiring", matched: "looking to hire", confidence: "high" });
    expect(classifyIntent("Looking for a web developer")).toMatchObject({ category: "hiring", confidence: "medium" });
    expect(classifyIntent("Just sharing my thoughts")).toEqual({ category: "discussion", matched: null, confidence: "low" });
  });
});

describe("what the post says about the project", () => {
  it("reads a budget as written, in several currencies", () => {
    expect(extractSignals("Budget is $2,000 for the whole thing").budget).toBe("$2,000");
    expect(extractSignals("can pay ₹50k/month").budget).toBe("₹50k/month");
    expect(extractSignals("around 1500 USD").budget).toMatch(/1500 USD/i);
    expect(extractSignals("£40/hr").budget).toBe("£40/hr");
  });
  it("silence on money is unknown; “unpaid” is a known no", () => {
    expect(extractSignals("Need a logo")).toMatchObject({ budget: null, budgetMentioned: false, unpaid: false });
    expect(extractSignals("Need a logo, paid of course")).toMatchObject({ budget: null, budgetMentioned: true, unpaid: false });
    expect(extractSignals("Need a logo, unpaid but great exposure, $0")).toMatchObject({ budget: null, unpaid: true });
  });
  it("reads urgency and business context as written", () => {
    expect(extractSignals("need this ASAP").urgency).toBe("ASAP");
    expect(extractSignals("launching within 2 weeks").urgency).toBe("within 2 weeks");
    expect(extractSignals("for our startup").businessContext).toBe("our startup");
    expect(extractSignals("I run a dental clinic").businessContext).toBe("I run");
    expect(extractSignals("a thing")).toMatchObject({ urgency: null, businessContext: null });
  });
  it("names which of the person's services the post is about", () => {
    expect(requestedService("need help with web design", ["SEO", "web design"])).toMatchObject({ service: "web design", via: "service" });
    expect(requestedService("need a next.js person", ["SEO"], ["Next.js"])).toMatchObject({ service: "Next.js", via: "keyword" });
    expect(requestedService("need a plumber", ["SEO"], ["Next.js"])).toMatchObject({ service: null, via: null });
  });
});

describe("the score", () => {
  const score = (text: string, over: Partial<Parameters<typeof socialScore>[0]> = {}) =>
    socialScore({ text, intent: classifyIntent(text), postedAt: daysAgo(1), services: ["web development"], now: NOW, ...over });
  const pts = (s: ReturnType<typeof score>, k: string) => s.components.find((c) => c.key === k)!.points;

  it("the weights are the published ones and add up to 100", () => {
    expect(SOCIAL_WEIGHTS).toEqual({ intent: 25, requirements: 20, recency: 15, budget: 15, relevance: 15, business: 10 });
    expect(Object.values(SOCIAL_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("a complete, recent, funded ask about the person's service scores at the top", () => {
    const s = score("We're looking to hire a web development freelancer to build an MVP for our startup in React. Budget is $5,000 and we need it within 3 weeks. The app has 6 screens, auth, and Stripe payments, and we already have designs ready in Figma for the whole flow so this is build only.", { companyUrl: "https://acme.io" });
    expect(s.total).toBe(100);
    expect(s.knownMax).toBe(100);
    expect(s.confidence).toBe("high");
  });

  // The rule the whole design hangs on: not saying is not the same as saying no.
  it("a post that names no budget, no date and no business is UNKNOWN on those, never zero", () => {
    const s = score("Looking for a web development person", { postedAt: null });
    expect(pts(s, "budget")).toBeNull();
    expect(pts(s, "recency")).toBeNull();
    expect(pts(s, "business")).toBeNull();
    expect(s.knownMax).toBe(100 - 15 - 15 - 10);
    expect(s.confidence).toBe("medium");
  });
  it("…but a post that says there is no money scores zero for budget, as a known fact", () => {
    const s = score("Looking for a web development person, unpaid for now");
    expect(pts(s, "budget")).toBe(0);
    expect(s.knownMax).toBeGreaterThanOrEqual(75);
  });

  it("recency falls off in steps, and an old post earns nothing for it", () => {
    const at = (n: number) => pts(score("Looking for a web development person", { postedAt: daysAgo(n) }), "recency");
    expect([at(0), at(3), at(5), at(10), at(20), at(60), at(200)]).toEqual([15, 15, 12, 9, 6, 2, 0]);
  });

  it("explicit hiring outranks a recommendation, a partnership and a problem, in that order", () => {
    const intent = (t: string) => pts(score(t), "intent");
    expect(intent("We're looking to hire a web development freelancer")).toBe(25);
    expect(intent("Looking for a web development freelancer")).toBe(20);
    expect(intent("Can anyone recommend a web development agency?")).toBe(20);
    expect(intent("Looking for a white-label web development partner")).toBe(16);
    expect(intent("Our website isn't converting, web development is hard")).toBe(10);
    expect(intent("Thoughts on web development trends?")).toBe(0);
  });

  it("a post that never mentions the person's services earns nothing for relevance", () => {
    expect(pts(score("Looking to hire a plumber"), "relevance")).toBe(0);
    expect(pts(score("Looking to hire for web development"), "relevance")).toBe(15);
    expect(pts(score("Looking to hire a Next.js person", { keywords: ["Next.js"] }), "relevance")).toBe(10);
  });

  it("every component explains itself", () => {
    for (const c of score("Looking to hire a web development freelancer, $500").components) expect(c.reason.length).toBeGreaterThan(8);
  });
});

describe("one post, analysed", () => {
  const a = (text: string, services = ["web development"]) => analysePost({ text, postedAt: daysAgo(2), services, now: NOW });
  it("qualifies only with a buying intent AND a match to the person's services", () => {
    expect(a("Looking to hire a web development freelancer").qualifies).toBe(true);
    expect(a("Looking to hire a plumber").qualifies).toBe(false); // an ask, but not for this person
    expect(a("Web development is changing fast, thoughts?").qualifies).toBe(false); // about the service, but not an ask
    expect(a("[For Hire] web development, 5 years").qualifies).toBe(false); // a competitor
  });
  it("no services means nothing qualifies: a scan without an offer to match is noise", () => {
    expect(a("Looking to hire a web development freelancer", []).qualifies).toBe(false);
  });
});

describe("platforms", () => {
  it("says plainly which can be searched and which cannot", () => {
    const by = Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p.id, p.mode]));
    expect(by).toEqual({ hn: "search", reddit: "search", web: "search", linkedin: "manual", facebook: "manual", instagram: "manual", x: "manual" });
    for (const p of SOCIAL_PLATFORMS) { expect(p.access.length).toBeGreaterThan(10); expect(p.limitation.length).toBeGreaterThan(10); }
  });
  it("recognises a pasted link's platform", () => {
    expect(platformOfUrl("https://www.linkedin.com/posts/someone_activity-123")).toBe("linkedin");
    expect(platformOfUrl("https://www.facebook.com/groups/1/posts/2")).toBe("facebook");
    expect(platformOfUrl("https://www.instagram.com/p/abc/")).toBe("instagram");
    expect(platformOfUrl("https://x.com/a/status/1")).toBe("x");
    expect(platformOfUrl("https://old.reddit.com/r/forhire/comments/1")).toBe("reddit");
    expect(platformOfUrl("https://news.ycombinator.com/item?id=1")).toBe("hn");
    expect(platformOfUrl("https://forum.example.org/t/1")).toBe("web");
    expect(platformOfUrl("not a url")).toBe("web");
  });
});

describe("queries and what is kept", () => {
  it("builds at most three Reddit searches, one per service, quotes stripped", () => {
    expect(redditQueries(["web design", 'SEO "audit"', "a", "copywriting", "ads"])).toEqual([
      '("looking for" OR "need a" OR "hiring" OR "recommend") "web design"',
      '("looking for" OR "need a" OR "hiring" OR "recommend") "SEO audit"',
      '("looking for" OR "need a" OR "hiring" OR "recommend") "copywriting"',
    ]);
    expect(redditQueries([])).toEqual([]);
  });
  it("builds at most two web searches", () => {
    expect(discussionQueries(["web design", "SEO", "ads"])).toHaveLength(2);
    expect(discussionQueries(["web design"])[0]).toContain("web design");
  });
  it("keeps a short excerpt, never the whole post", () => {
    expect(excerptOf("a ".repeat(500)).length).toBeLessThanOrEqual(280);
    expect(excerptOf("  one\n\n two  ")).toBe("one two");
  });
});

describe("a post's link", () => {
  it("stays a link that opens: the host is kept, only tracking, the fragment and a trailing slash go", () => {
    expect(postUrl("https://www.example-forum.org/t/need-a-dev/42/?utm_source=x&page=2#reply")).toBe("https://www.example-forum.org/t/need-a-dev/42?page=2");
    expect(postUrl("https://news.ycombinator.com/item?id=123")).toBe("https://news.ycombinator.com/item?id=123"); // the id IS the post
    expect(postUrl("https://Example.com/")).toBe("https://example.com");
  });
  it("the same post from the app, the old site or the mobile site is one link", () => {
    const one = "https://www.reddit.com/r/forhire/comments/abc/hiring";
    for (const u of ["https://reddit.com/r/forhire/comments/abc/hiring/", "https://old.reddit.com/r/forhire/comments/abc/hiring/?share_id=9", "https://www.reddit.com/r/forhire/comments/abc/hiring/?utm_medium=android_app&rcm=1"])
      expect(postUrl(u)).toBe(one);
    expect(postUrl("https://twitter.com/a/status/1?s=20&t=abc")).toBe("https://x.com/a/status/1");
    expect(postUrl("https://m.facebook.com/groups/1/posts/2/?mibextid=x")).toBe("https://www.facebook.com/groups/1/posts/2");
    expect(postUrl("https://linkedin.com/posts/x_activity-1?trk=public_post")).toBe("https://www.linkedin.com/posts/x_activity-1");
  });
  it("refuses anything that isn't a plain web address", () => {
    for (const u of ["javascript:alert(1)", "ftp://a.com/x", "https://user:pw@a.com/x", "https://localhost/x", "not a url", "", null])
      expect(postUrl(u as any)).toBeNull();
  });
});

describe("is the post about what the person sells?", () => {
  const about = (phrase: string, text: string) => mentionsPhrase(phrase, text);
  it("every meaningful word of the service has to be there, allowing for endings", () => {
    expect(about("web development", "Looking for a web developer to rebuild our store")).toBe(true);
    expect(about("web development", "we need development of a new web app")).toBe(true);
    expect(about("web design", "need a designer for our web shop")).toBe(true);
    expect(about("React development", "Stack: TypeScript, React/Next.js. Looking for a developer")).toBe(true);
    expect(about("SEO", "Can anyone recommend an SEO agency?")).toBe(true);
    expect(about("content marketing", "we need a content marketer")).toBe(true);
    expect(about("Next.js", "need help with Next.js.")).toBe(true);
  });
  // Found on the first real scan: an iOS contract was kept as "web development" because both said "develop…".
  it("one shared word is not enough", () => {
    expect(about("web development", "iOS Engineer, contract. Sendery gives developers and designers the tools they need")).toBe(false);
    expect(about("web development", "Hiring a business development manager")).toBe(false);
    expect(about("web design", "Interior design studio seeks a contractor")).toBe(false);
    expect(about("React development", "Looking for a Rust developer")).toBe(false);
  });
  it("short words only ever match whole", () => {
    expect(about("ads", "we build roads and broadsides")).toBe(false);
    expect(about("ads", "need someone to run our ads")).toBe(true);
    expect(about("SEO", "our CEO Seon is hiring")).toBe(false);
    expect(about("web", "a cobweb of spiderwebs")).toBe(false);
  });
  it("filler words in a service's name don't have to appear", () => {
    expect(about("SEO services", "need an SEO freelancer")).toBe(true);
    expect(about("design and branding", "looking for branding and a designer")).toBe(true);
    expect(about("", "anything")).toBe(false);
    expect(about("services", "anything at all")).toBe(false);
  });
});

// Found on the second real scan: a contract for an iOS engineer was kept as "design" because, far down, the post
// said its product is for "developers, designers and operations".
describe("named in the ask, or only mentioned?", () => {
  const post = "Sendery | iOS Engineer | Tokyo | Contract\nSendery is an email platform. We provide developers, designers, and operations with the tools they need. We are looking for a capable iOS Engineer to own our app.";
  const intent = classifyIntent(post);
  it("the ask is the title plus the words after the phrase that made it an ask", () => {
    const f = askFocus(post, intent.matched);
    expect(f).toContain("iOS Engineer | Tokyo");
    expect(f).toContain("looking for a capable iOS Engineer to own our app");
    expect(f).not.toContain("designers");
  });
  it("a service only mentioned elsewhere still counts, for fewer points, and says so", () => {
    const m = requestedService(post, ["design"], [], askFocus(post, intent.matched));
    expect(m).toEqual({ service: "design", via: "service", focused: false });
    const rel = socialScore({ text: post, intent, postedAt: null, services: ["design"], now: NOW }).components.find((c) => c.key === "relevance")!;
    expect(rel.points).toBe(9);
    expect(rel.reason).toContain("not clearly as what they're asking for");
  });
  it("a service in the ask itself gets full points and wins over one mentioned further down", () => {
    const m = requestedService(post, ["design", "iOS"], [], askFocus(post, intent.matched));
    expect(m).toEqual({ service: "iOS", via: "service", focused: true });
    const rel = socialScore({ text: post, intent, postedAt: null, services: ["iOS"], now: NOW }).components.find((c) => c.key === "relevance")!;
    expect(rel.points).toBe(15);
  });
});

// Found on the third real scan: a real React contract was dropped for "React development" because it says "engineer".
describe("developer, engineer and programmer are one family", () => {
  const collabify = "Collabify | Senior Full-Stack Engineer (backend-heavy) | REMOTE (worldwide) | Contract, 4–5 months | $3,000–4,000/month\nI'm looking to hire our first engineer to own architecture and build product first version. Stack: TypeScript, React/Next.js, Node.js and PostgreSQL.";
  it("a service called “React development” matches a post asking for a React engineer", () => {
    expect(mentionsPhrase("React development", collabify)).toBe(true);
    expect(mentionsPhrase("Node.js developer", collabify)).toBe(true);
    expect(mentionsPhrase("software development", "Hiring a contract software engineer")).toBe(true);
    const a = analysePost({ text: collabify, postedAt: daysAgo(1), services: ["React development"], now: NOW });
    expect(a).toMatchObject({ qualifies: true, service: "React development" });
    expect(a.score.components.find((c) => c.key === "relevance")!.points).toBe(15);
  });
  it("…but only when the rest of the phrase is really there", () => {
    expect(mentionsPhrase("Vue development", collabify)).toBe(false);
    expect(mentionsPhrase("web development", "iOS Engineer, contract. For developers and designers.")).toBe(false);
    expect(mentionsPhrase("web development", "Hiring a business development manager")).toBe(false);
    expect(mentionsPhrase("React development", "We love React. Looking for a designer.")).toBe(false);
  });
});
