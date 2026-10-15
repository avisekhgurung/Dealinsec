/**
 * The app's motion system: one set of durations, easings and variants, so movement means the same thing everywhere.
 *
 *   - Short: 120–240 ms. Motion confirms what happened; it never makes anyone wait.
 *   - Transform and opacity only (no layout-heavy properties, no blur animations).
 *   - Reduced motion: App wraps everything in <MotionConfig reducedMotion="user">, which drops transforms for people
 *     who ask for less motion; components that also fade use `useCalmMotion()` to drop the fade too.
 *   - Lists: only the first STAGGER_CAP items animate in; the rest appear at once, so long lists never crawl.
 */
import { useReducedMotion, type Transition, type Variants } from "framer-motion";

export const DURATION = { fast: 0.12, base: 0.18, slow: 0.24 } as const;
/** A quick settle: fast start, soft landing. The same curve the landing page already uses. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_IN: [number, number, number, number] = [0.4, 0, 1, 1];

export const tBase: Transition = { duration: DURATION.base, ease: EASE_OUT };
/** For indicators that slide between positions (active tab, segmented control). */
export const tSpring: Transition = { type: "spring", stiffness: 520, damping: 40, mass: 0.6 };

/** Content arriving: a small rise and fade. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: tBase },
  exit: { opacity: 0, y: 4, transition: { duration: DURATION.fast, ease: EASE_IN } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: tBase },
  exit: { opacity: 0, transition: { duration: DURATION.fast, ease: EASE_IN } },
};

/** A parent that reveals its children one after another, briefly. */
export const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } },
};

/** How many list items animate in; anything after appears immediately. */
export const STAGGER_CAP = 10;
export const staggerItem = (index: number): Variants => (index < STAGGER_CAP ? fadeUp : { hidden: {}, visible: {} });

/** Press feedback for buttons and cards: a slight dip, never a bounce. */
export const press = { whileTap: { scale: 0.98 }, transition: { duration: DURATION.fast } } as const;

/** True when the person asked for less motion: skip fades and slides entirely, not just transforms. */
export function useCalmMotion(): boolean {
  return useReducedMotion() ?? false;
}
