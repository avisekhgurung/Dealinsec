/**
 * The Nest's plush coworkers: which artwork shows for which moment. Pure and dependency-free, so the homepage can use
 * the pictures without loading the app's coworker code, and a test can check every file exists.
 *
 * Each coworker has three poses, cropped from the supplied character sheet (client/public/ai-league/plush/*.webp,
 * 384 px and a 160 px "-sm" copy):
 *   rest  the everyday pose   Nibo with his magnifier · Mika with her letter · Zee with his tea
 *   work  busy on a task      Nibo reading a map · Mika at her laptop · Zee writing in his journal
 *   win   the job is done     Nibo with his notebook · Mika with her ticked notes · Zee with his ticked checklist
 */
export type PlushBot = "nibo" | "mika" | "zee";
export type PlushPose = "rest" | "work" | "win";

export const PLUSH_POSES: Record<PlushBot, Record<PlushPose, string>> = {
  nibo: { rest: "search", work: "map", win: "notebook" },
  mika: { rest: "letter", work: "laptop", win: "notes" },
  zee: { rest: "tea", work: "journal", win: "checklist" },
};

const DIR = "/ai-league/plush";

/** `src` and `srcSet` for one pose: the 160 px file for avatars, the 384 px one for large or high-density screens. */
export function plushSrc(bot: PlushBot, pose: PlushPose = "rest"): { src: string; srcSet: string } {
  const name = `${DIR}/${bot}-${PLUSH_POSES[bot][pose]}`;
  return { src: `${name}.webp`, srcSet: `${name}-sm.webp 160w, ${name}.webp 384w` };
}

/** The three together in their nest (the supplied team picture; its own lettering says "The Nest, Your AI Team"). */
export const NEST_TEAM_IMAGE = {
  src: `${DIR}/the-nest-team.webp`,
  srcSet: `${DIR}/the-nest-team-sm.webp 720w, ${DIR}/the-nest-team.webp 1200w`,
  width: 1200,
  height: 800,
  alt: "The Nest, your AI team: Nibo the Deal Finder in a brown bear-ear hat with a magnifying glass, Mika the Deal Closer in a pink heart hat holding a letter, and Zee the Business Buddy in a green sprout hat holding a checklist, sitting together in a knitted nest.",
} as const;

/** Every file the poses and the team picture point at (for the asset test). */
export const PLUSH_FILES: readonly string[] = [
  ...(Object.keys(PLUSH_POSES) as PlushBot[]).flatMap((b) =>
    (Object.values(PLUSH_POSES[b])).flatMap((n) => [`${DIR}/${b}-${n}.webp`, `${DIR}/${b}-${n}-sm.webp`])),
  NEST_TEAM_IMAGE.src,
  `${DIR}/the-nest-team-sm.webp`,
];

/** The app-driven states a character can be in (components/ai-league/nest-character.tsx). */
export type NestAnimationState = "idle" | "thinking" | "success" | "waiting" | "error";

const POSE: Record<NestAnimationState, PlushPose> = { idle: "rest", thinking: "work", success: "win", waiting: "rest", error: "rest" };

/** What a character shows and how it moves, from the app's state alone. */
export function nestLook(state: NestAnimationState, opts: { size: number; isSpeaking?: boolean }) {
  const animated = opts.size >= 40;
  const speaking = !!opts.isSpeaking;
  return {
    pose: POSE[state],
    /** The body's motion class (none for small avatars). */
    motion: !animated ? "" : speaking ? "nest-speak" : `nest-${state}`,
    /** The face's personal habit runs only while resting. */
    habit: animated && state === "idle" && !speaking,
    /** The busy or done prop beside large characters. */
    prop: opts.size >= 56 && (state === "thinking" || state === "success") ? (state === "thinking" ? ("busy" as const) : ("done" as const)) : null,
    /** The moving halo: only while work is really happening. */
    halo: speaking || state === "thinking",
  };
}
