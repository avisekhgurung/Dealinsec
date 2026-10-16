/**
 * A StatusBadge that acknowledges a real change of status, and nothing else.
 *
 * It renders still on first paint (a page opening is not a change), and moves
 * only when the `status` it is given becomes a different value — which happens
 * only when the record itself came back from the server with a new status
 * (e.g. "Mark as completed" → Completed). The old badge fades out of the flow
 * (popLayout) while the new one fades in. It never animates on its own, on a
 * refetch that returned the same status, or ahead of the server's answer.
 *
 * Opacity only — no `layout` prop, so a badge never slides when content above
 * it grows. With reduced motion asked for, it simply swaps.
 */
import { AnimatePresence, motion } from "framer-motion";
import { StatusBadge } from "@/components/status-badge";
import { tBase, useCalmMotion, DURATION, EASE_IN } from "@/lib/motion";

export function AnimatedStatusBadge({ status, size, className }: { status: string; size?: "default" | "compact"; className?: string }) {
  const calm = useCalmMotion();
  if (calm) return <StatusBadge status={status} size={size} className={className} />;
  return (
    <span className="relative inline-flex shrink-0">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: tBase }}
          exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE_IN } }}
          className="inline-flex"
        >
          <StatusBadge status={status} size={size} className={className} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
