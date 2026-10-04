/**
 * What gets read aloud. The agent's replies are markdown with links and lists;
 * spoken as written they would say "asterisk asterisk" and read out URLs. This
 * keeps only the words, and stops at a length a person will actually listen to.
 */
export function speakable(md: string, max = 700): string {
  const t = String(md ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>|]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, "")}…` : t;
}

/* ── speaking: chunks, and which voice ─────────────────────────────────── */

/**
 * Sentence-sized pieces to speak one after another. Browsers cut a single long
 * utterance off after ~15 seconds, and speaking in pieces lets the first
 * sentence start at once and lets a person interrupt between them.
 */
export function splitSentences(text: string, maxLen = 220): string[] {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  // A sentence ends at . ! ? or … followed by a space or the end, so "northwind.com" and "₹1.5 lakh" stay whole.
  const raw = t.match(/.+?[.!?…]+["')\]]*(?=\s|$)|.+$/g) ?? [t];
  const merged: string[] = [];
  for (const piece of raw.map((p) => p.trim()).filter(Boolean)) {
    const last = merged[merged.length - 1];
    // A very short fragment ("Yes.", "Mr. Sharma") reads better joined to its neighbour.
    if (last && (last.length < 24 || piece.length < 12) && last.length + piece.length < maxLen) merged[merged.length - 1] = `${last} ${piece}`;
    else merged.push(piece);
  }
  const out: string[] = [];
  for (const m of merged) {
    let rest = m;
    while (rest.length > maxLen) {
      const cut = Math.max(rest.lastIndexOf(", ", maxLen - 2), rest.lastIndexOf(" ", maxLen - 1));
      const at = cut > maxLen / 2 ? cut + 1 : maxLen;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

export interface VoiceInfo { name: string; lang: string; localService?: boolean; default?: boolean }

const FEMALE = /\b(female|samantha|karen|moira|tessa|serena|kate|susan|hazel|libby|sonia|zira|aria|jenny|joanna|salli|kendra|emma|amy|siri female|victoria|allison|ava|nicky|catherine|fiona|veena|heera|neerja)\b/i;
const MALE = /\b(male|daniel|oliver|arthur|george|ryan|thomas|alfie|rishi|alex|fred|ralph|lee|david|mark|guy|james|brian|matthew|joey|aaron|gordon|prabhat|ravi|hemant)\b/i;
const NICE = /(natural|neural|premium|enhanced|google|online|siri|wavenet)/i;

/** The gentleman voice for a language: calm, male, British where the language is English, the most natural one the device has. */
export function pickGentlemanVoice(voices: VoiceInfo[], lang: string): number {
  const want = (lang || "en-US").toLowerCase();
  const base = want.split("-")[0];
  const target = base === "en" ? "en-gb" : want;
  let best = -1, bestScore = -Infinity;
  voices.forEach((v, i) => {
    const l = (v.lang || "").toLowerCase().replace("_", "-");
    if (l.split("-")[0] !== base) return;
    let s = 0;
    if (l === target) s += 4; else if (l === want) s += 3;
    if (MALE.test(v.name)) s += 3;
    if (FEMALE.test(v.name)) s -= 6;
    if (NICE.test(v.name)) s += 2;
    if (v.localService === false) s += 1;
    if (v.default) s += 0.5;
    if (s > bestScore) { bestScore = s; best = i; }
  });
  return best;
}

/* ── interrupting by voice ─────────────────────────────────────────────── */

/**
 * Decides whether the PERSON has started talking over the agent, from the
 * microphone level alone. A speaker can leak into the microphone, so it first
 * listens to the agent's own voice for a moment to learn how loud that echo is,
 * then only fires on something clearly louder that is sustained. Pure: the
 * caller feeds it (time, level) samples.
 */
export function createBargeInDetector(opts: { calibrateMs?: number; factor?: number; floor?: number; sustainMs?: number } = {}) {
  const { calibrateMs = 450, factor = 2.2, floor = 0.05, sustainMs = 260 } = opts;
  let t0: number | null = null;
  let echo = 0;
  let aboveSince: number | null = null;
  return {
    reset() { t0 = null; echo = 0; aboveSince = null; },
    push(t: number, rms: number): boolean {
      if (t0 === null) t0 = t;
      if (t - t0 < calibrateMs) { echo = Math.max(echo, rms); return false; }
      const threshold = Math.max(floor, echo * factor);
      if (rms > threshold) {
        if (aboveSince === null) aboveSince = t;
        return t - aboveSince >= sustainMs;
      }
      aboveSince = null;
      return false;
    },
  };
}

/**
 * A phone or tablet (touch-first device), from the user agent. The call behaves differently there:
 * a speech recogniser or an open microphone puts a phone's audio into "record" mode, which mutes,
 * ducks or reroutes the assistant's voice to the quiet earpiece, so on these devices the call
 * listens only between turns and a tap (not a spoken word) interrupts. iPadOS reports itself as
 * a Mac, so a "Mac" with a touch screen counts.
 */
export function isPhoneDevice(userAgent: string, maxTouchPoints = 0): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile|CriOS|FxiOS/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}
