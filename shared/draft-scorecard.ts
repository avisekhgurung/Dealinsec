/**
 * A deterministic quality card for ONE outreach draft: a handful of things a program can honestly measure,
 * each with its points and the reason, so two versions of a message can be compared side by side.
 *
 * It measures craft, not outcomes: there is no predicted reply rate or conversion probability anywhere here,
 * because no program can know those. What a strategy actually achieves is counted afterwards from real
 * approvals, sends and replies. It also repeats nothing from shared/outreach-check.ts: a draft that reaches
 * a scorecard has already passed the safety checks.
 *
 * Components that cannot be measured for a draft (no name to greet, no strategy evidence) are left off the
 * card rather than scored zero, so `max` varies — but every variant of the same lead shares one context,
 * so their cards always compare like with like.
 */

export interface ScorecardComponent { key: string; label: string; points: number; max: number; reason: string }
export interface Scorecard { total: number; max: number; components: ScorecardComponent[] }

export interface ScorecardContext {
  /** The name to greet, when the person recorded one. */
  greetName: string | null;
  /** The values of the facts handed to the model. */
  factValues: string[];
  /** The values of the claims the chosen strategy is built on (empty for "direct"). */
  evidenceValues: string[];
}

/** Words that say nothing distinctive, so sharing them proves no reference. */
const GENERIC = new Set(("the a an and or but so of in on at by for from with to into about like your their our its this that these those " +
  "is are was were be been have has had do does did will would can could you they we it i me us them he she " +
  "new more most very really just also only some any all lot team company business work help make good great").split(/\s+/));
const tokens = (t: string): string[] => (t.toLowerCase().match(/[a-z][a-z0-9'-]*/g) ?? []).filter((w) => w.length >= 3 && !GENERIC.has(w));
const stem = (w: string) => (w.length > 6 ? w.slice(0, 6) : w.replace(/(?:es|s)$/, ""));
const stems = (t: string) => new Set(tokens(t).map(stem));

/** How many of a value's distinctive stems the text shares. */
const sharedStems = (textStems: Set<string>, value: string): { shared: number; of: number } => {
  const own = Array.from(new Set(tokens(value).map(stem)));
  return { shared: own.filter((s) => textStems.has(s)).length, of: own.length };
};
/** A value counts as referenced when the text shares at least two of its distinctive stems (or all, when it has fewer). */
const references = (textStems: Set<string>, value: string): boolean => {
  const { shared, of } = sharedStems(textStems, value);
  return of > 0 && shared >= Math.min(2, of);
};

const sentences = (body: string): number[] =>
  body.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+/).filter(Boolean).length);
const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** Openers and filler that read like every other cold email. */
const CLICHES =
  /\bhope this (?:e-?mail |message )?finds you well\b|\bquick question\b|\bjust checking in\b|\btouching base\b|\bto whom it may concern\b|\bi know you(?:'re| are) busy\b|\bgame[- ]?chang\w*|\brevolutioni[sz]\w*|\bsynerg\w*|\bcircle back\b|\btake (?:your|the) business to the next level\b|\bcutting[- ]edge\b|\bbest[- ]in[- ]class\b/i;

/** The ideal first-email length the drafting prompt asks for, in words. */
export const WORD_BAND = { min: 60, max: 150, outerMin: 40, outerMax: 200 } as const;

export function scoreDraft(d: { subject: string; body: string }, ctx: ScorecardContext): Scorecard {
  const body = d.body.trim(), subject = d.subject.trim();
  const bodyStems = stems(body);
  const components: ScorecardComponent[] = [];
  const add = (key: string, label: string, points: number, max: number, reason: string) => components.push({ key, label, points, max, reason });

  const first = ctx.greetName?.trim().split(/\s+/)[0];
  if (first) {
    const firstLine = body.split("\n", 1)[0] ?? "";
    const greeted = firstLine.toLowerCase().includes(first.toLowerCase());
    add("greeting", "Greets by name", greeted ? 1 : 0, 1, greeted ? `Opens to ${first}.` : `Doesn't greet ${first} by name.`);
  }

  if (ctx.factValues.length) {
    const used = ctx.factValues.filter((v) => references(bodyStems, v)).length;
    const points = Math.min(2, used);
    add("facts", "Built on the facts", points, 2,
      used === 0 ? "Mentions none of the known facts." : used === 1 ? "Mentions one of the known facts." : `Mentions ${used} of the known facts.`);
  }

  if (ctx.evidenceValues.length) {
    const best = ctx.evidenceValues.reduce((b, v) => Math.max(b, references(bodyStems, v) ? 2 : sharedStems(bodyStems, v).shared >= 1 ? 1 : 0), 0);
    add("grounding", "Uses its own evidence", best, 2,
      best === 2 ? "Clearly uses the evidence this version is built on." : best === 1 ? "Only touches the evidence this version is built on." : "Doesn't use the evidence this version is built on.");
  }

  const words = wordCount(body);
  const lengthPoints = words >= WORD_BAND.min && words <= WORD_BAND.max ? 2 : words >= WORD_BAND.outerMin && words <= WORD_BAND.outerMax ? 1 : 0;
  add("length", "Right length", lengthPoints, 2, `${words} words (${WORD_BAND.min}–${WORD_BAND.max} reads best).`);

  const subjectWords = wordCount(subject);
  const subjectOk = subjectWords >= 3 && subjectWords <= 8;
  add("subject", "Subject says it in a few words", subjectOk ? 1 : 0, 1, `${subjectWords} word${subjectWords === 1 ? "" : "s"} (3–8 reads best).`);

  const asks = (body.match(/\?/g) ?? []).length;
  add("ask", "One clear ask", asks === 1 ? 2 : asks === 2 ? 1 : 0, 2,
    asks === 0 ? "Asks nothing: give the reader one easy question." : asks === 1 ? "One question, easy to answer." : `${asks} questions: one is easier to answer.`);

  const lens = sentences(body);
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const longest = lens.length ? Math.max(...lens) : 0;
  const readable = lens.length > 0 && avg <= 20 && longest <= 35;
  add("readability", "Easy to read", readable ? 1 : 0, 1,
    readable ? "Short sentences throughout." : longest > 35 ? `Its longest sentence runs ${longest} words.` : `Sentences average ${Math.round(avg)} words.`);

  const tired = `${subject}\n${body}`.match(CLICHES);
  add("fresh", "No tired phrases", tired ? 0 : 1, 1, tired ? `Reads like every other cold email ("${tired[0]}").` : "No worn-out opener or filler.");

  return { total: components.reduce((a, c) => a + c.points, 0), max: components.reduce((a, c) => a + c.max, 0), components };
}
