/**
 * CreditAnimationOverlay
 *
 * Full-screen modal that plays a 3-phase animation while an agreement is
 * created (agreements are a Pro feature in the subscription-first model, so
 * there is no credit deduction to animate — just a premium progress flow):
 *
 *   Phase 1 — "Preparing Agreement" (Pro badge pulse)
 *   Phase 2 — "Creating Agreement"  (progress bar fill)
 *   Phase 3 — "Agreement Created!"  (green burst, auto-dismiss)
 *
 * Usage:
 *   <CreditAnimationOverlay
 *     show={createContract.isPending || showSuccess}
 *     phase={phase}           // "reserving" | "creating" | "done"
 *   />
 */

import { useEffect, useState } from "react";

type Phase = "reserving" | "creating" | "done";

interface Props {
  show: boolean;
  phase: Phase;
}

// Animated progress bar
function ProgressBar({ active }: { active: boolean }) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!active) { setWidth(0); return; }
    const t = setTimeout(() => setWidth(95), 80);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all ease-out"
        style={{ width: `${width}%`, transitionDuration: "2800ms" }}
      />
    </div>
  );
}

// Sparkle burst on success
function SparkleRing() {
  const sparks = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <div className="absolute inset-0 pointer-events-none">
      {sparks.map((deg, i) => (
        <div
          key={i}
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: `rotate(${deg}deg)` }}
        >
          <div
            className="w-2 h-2 rounded-full bg-emerald-400"
            style={{
              animation: `sparkle-out 0.6s ease-out ${i * 40}ms both`,
              transformOrigin: "center",
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function CreditAnimationOverlay({ show, phase }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (show) setVisible(true);
    else {
      const t = setTimeout(() => setVisible(false), 400);
      return () => clearTimeout(t);
    }
  }, [show]);

  if (!visible) return null;

  const isDone = phase === "done";

  return (
    <>
      {/* Keyframes */}
      <style>{`
        @keyframes sparkle-out {
          0%   { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-38px) scale(0); opacity: 0; }
        }
        @keyframes success-pop {
          0%   { transform: scale(0.5); opacity: 0; }
          60%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[200] flex items-center justify-center p-6 transition-opacity duration-300
          ${show ? "opacity-100" : "opacity-0"}`}
        style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
      >
        <div
          className={`relative w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl transition-all duration-300
            ${show ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}
          style={{
            background: "linear-gradient(135deg, hsl(160 30% 12%) 0%, hsl(215 25% 8%) 100%)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {/* Top gradient strip */}
          <div className="h-1 w-full bg-gradient-to-r from-violet-400 via-teal-500 to-emerald-400" />

          <div className="px-8 py-10 flex flex-col items-center gap-6 text-center">

            {/* ── Phase 1 & 2: Pro badge + progress ── */}
            {!isDone && (
              <>
                <div className="relative flex items-center justify-center" style={{ width: 80, height: 80 }}>
                  <div className="absolute inset-0 rounded-full bg-violet-400/30 animate-ping" />
                  <div className="absolute inset-2 rounded-full bg-violet-300/20 animate-pulse" />
                  <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-violet-400 via-violet-500 to-indigo-600 shadow-lg shadow-violet-500/50 flex items-center justify-center border-2 border-violet-300/60">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 20h20M4 20l2-11 4.5 4L12 6l1.5 7L18 9l2 11" fill="none" />
                    </svg>
                  </div>
                </div>

                <div className="flex flex-col items-center">
                  <span className="text-3xl font-black text-white">Pro</span>
                  <span className="text-xs text-violet-300/80 uppercase tracking-wider mt-0.5">
                    Unlimited agreements
                  </span>
                </div>

                {/* Label + progress */}
                <div className="w-full space-y-3">
                  <p className="text-sm font-semibold text-white/80 tracking-wide">
                    {phase === "reserving" ? "Preparing Agreement…" : "Creating your Agreement…"}
                  </p>
                  {phase === "creating" && <ProgressBar active />}
                  {phase === "reserving" && (
                    <div className="flex justify-center gap-1.5 pt-1">
                      {[0, 1, 2].map(i => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-violet-400"
                          style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── Phase 3: Success ── */}
            {isDone && (
              <>
                <div className="relative flex items-center justify-center w-20 h-20">
                  <SparkleRing />
                  <div
                    className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/40"
                    style={{ animation: "success-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) both" }}
                  >
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xl font-bold text-white">Agreement Created!</p>
                  <p className="text-sm text-white/60">Signed &amp; ready to share</p>
                </div>

                {/* Success bar */}
                <div className="w-full h-1.5 rounded-full overflow-hidden bg-white/10">
                  <div className="h-full bg-emerald-400 rounded-full" style={{ width: "100%", transition: "width 0.6s ease-out" }} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
