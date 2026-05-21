import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";

export type PaymentResultState = "success" | "error" | null;

interface PaymentResultProps {
  state: PaymentResultState;
  /** Success: credits granted. */
  credits?: number;
  /** Error: short reason to show. */
  errorReason?: string;
  /** Optional label for the primary success action (e.g. "Continue to Agreement"). */
  continueLabel?: string;
  onContinue?: () => void;
  onClose: () => void;
  onRetry?: () => void;
}

// Confetti burst — lightweight, pure framer-motion (no library)
const CONFETTI = Array.from({ length: 28 }).map((_, i) => {
  const colors = ["#10B981", "#0E8C5A", "#F59E0B", "#3B82F6", "#EC4899", "#06B6D4"];
  return {
    id: i,
    color: colors[i % colors.length],
    x: (Math.random() - 0.5) * 360,
    y: -(Math.random() * 320 + 120),
    rotate: Math.random() * 540,
    delay: Math.random() * 0.2,
    size: Math.random() * 6 + 5,
  };
});

export function PaymentResult({
  state,
  credits = 1,
  errorReason,
  continueLabel,
  onContinue,
  onClose,
  onRetry,
}: PaymentResultProps) {
  return (
    <AnimatePresence>
      {state && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Card */}
          <motion.div
            className="relative w-full max-w-sm rounded-3xl bg-card border border-border/60 shadow-2xl overflow-hidden"
            initial={{ scale: 0.85, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 10 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
          >
            {state === "success" ? (
              <SuccessContent
                credits={credits}
                continueLabel={continueLabel}
                onContinue={onContinue}
                onClose={onClose}
              />
            ) : (
              <ErrorContent errorReason={errorReason} onClose={onClose} onRetry={onRetry} />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SuccessContent({
  credits,
  continueLabel,
  onContinue,
  onClose,
}: {
  credits: number;
  continueLabel?: string;
  onContinue?: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Gradient header band */}
      <div className="relative h-28 bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 overflow-hidden">
        {/* Confetti burst originating from center-bottom of the band */}
        <div className="absolute left-1/2 bottom-0 w-0 h-0">
          {CONFETTI.map((c) => (
            <motion.span
              key={c.id}
              className="absolute rounded-[2px]"
              style={{ width: c.size, height: c.size * 1.4, backgroundColor: c.color }}
              initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
              animate={{ x: c.x, y: c.y, opacity: 0, rotate: c.rotate }}
              transition={{ duration: 1.1, delay: c.delay, ease: "easeOut" }}
            />
          ))}
        </div>
      </div>

      {/* Animated check badge — overlaps the band */}
      <div className="flex justify-center -mt-12 relative z-10">
        <motion.div
          className="w-24 h-24 rounded-full bg-card border-4 border-card shadow-lg flex items-center justify-center"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", damping: 12, stiffness: 200, delay: 0.1 }}
        >
          <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <motion.path
                d="M11 20.5 L17 26.5 L29 13.5"
                stroke="white"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4, delay: 0.35, ease: "easeOut" }}
              />
            </svg>
          </div>
        </motion.div>
      </div>

      <div className="px-6 pt-4 pb-6 text-center">
        <motion.h2
          className="text-2xl font-bold text-foreground"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          Payment Successful!
        </motion.h2>
        <motion.p
          className="text-sm text-muted-foreground mt-1.5"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
        >
          {credits} contract credit{credits !== 1 ? "s" : ""} added to your account.
        </motion.p>

        {/* Credit chip */}
        <motion.div
          className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-800/40"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.65, type: "spring" }}
        >
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-bold text-amber-700 dark:text-amber-300">
            +{credits} credit{credits !== 1 ? "s" : ""}
          </span>
        </motion.div>

        <motion.div
          className="mt-6 space-y-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75 }}
        >
          {continueLabel && onContinue ? (
            <Button className="gradient-btn w-full text-white h-11 font-semibold" onClick={onContinue}>
              {continueLabel}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : null}
          <Button
            variant={continueLabel ? "outline" : "default"}
            className={continueLabel ? "w-full h-11" : "gradient-btn w-full text-white h-11 font-semibold"}
            onClick={onClose}
          >
            {continueLabel ? "Stay on Pricing" : "Done"}
          </Button>
        </motion.div>
      </div>
    </>
  );
}

function ErrorContent({
  errorReason,
  onClose,
  onRetry,
}: {
  errorReason?: string;
  onClose: () => void;
  onRetry?: () => void;
}) {
  return (
    <div className="px-6 pt-8 pb-6 text-center">
      {/* Animated X badge with a subtle shake */}
      <motion.div
        className="w-20 h-20 mx-auto rounded-full bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center"
        initial={{ scale: 0 }}
        animate={{ scale: 1, x: [0, -8, 8, -5, 5, 0] }}
        transition={{ scale: { type: "spring", damping: 12, stiffness: 200 }, x: { delay: 0.3, duration: 0.4 } }}
      >
        <div className="w-14 h-14 rounded-full bg-rose-500 flex items-center justify-center">
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
            <motion.path
              d="M9 9 L21 21"
              stroke="white" strokeWidth="3.5" strokeLinecap="round"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ duration: 0.25, delay: 0.3 }}
            />
            <motion.path
              d="M21 9 L9 21"
              stroke="white" strokeWidth="3.5" strokeLinecap="round"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ duration: 0.25, delay: 0.5 }}
            />
          </svg>
        </div>
      </motion.div>

      <motion.h2
        className="text-2xl font-bold text-foreground mt-5"
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
      >
        Payment Failed
      </motion.h2>
      <motion.p
        className="text-sm text-muted-foreground mt-1.5"
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
      >
        {errorReason || "Your payment couldn't be processed. No money was deducted — please try again."}
      </motion.p>

      <motion.div
        className="mt-6 space-y-2"
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
      >
        {onRetry && (
          <Button className="gradient-btn w-full text-white h-11 font-semibold" onClick={onRetry}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        )}
        <Button variant="outline" className="w-full h-11" onClick={onClose}>
          Close
        </Button>
        <p className="text-[11px] text-muted-foreground pt-1">
          If money was deducted, it auto-refunds in 5-7 days. Need help?{" "}
          <a href="mailto:hello@dealinsec.com" className="text-primary font-medium hover:underline">
            Contact support
          </a>
        </p>
      </motion.div>
    </div>
  );
}
