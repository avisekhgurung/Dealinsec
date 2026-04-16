/**
 * CreditAnimationOverlay
 *
 * Full-screen modal that plays a 3-phase animation when an agreement credit
 * is being consumed:
 *
 *   Phase 1 — "Reserving Credit"   (coin pulse + shrink)
 *   Phase 2 — "Creating Agreement" (progress bar fill)
 *   Phase 3 — "Agreement Created!" (green burst, auto-dismiss)
 *
 * Usage:
 *   <CreditAnimationOverlay
 *     show={createContract.isPending || showSuccess}
 *     phase={phase}           // "reserving" | "creating" | "done"
 *     creditsAfter={credits - 1}
 *   />
 */

import { useEffect, useState } from "react";

type Phase = "reserving" | "creating" | "done";

interface Props {
  show: boolean;
  phase: Phase;
  creditsAfter: number;
}

// Inline SVG coin (gold circle with ₹)
function CreditCoin({ shrinking }: { shrinking: boolean }) {
  return (
    <div
      className={`relative flex items-center justify-center transition-all duration-700 ease-in-out
        ${shrinking ? "scale-0 opacity-0 -translate-y-8" : "scale-100 opacity-100"}`}
      style={{ width: 80, height: 80 }}
    >
      {/* Outer glow ring */}
      <div className="absolute inset-0 rounded-full bg-amber-400/30 animate-ping" />
      <div className="absolute inset-2 rounded-full bg-amber-300/20 animate-pulse" />

      {/* Coin body */}
      <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 shadow-lg shadow-amber-400/50 flex items-center justify-center border-2 border-amber-200/60">
        {/* Shine streak */}
        <div className="absolute top-2 left-3 w-4 h-1.5 rounded-full bg-white/40 rotate-[-30deg]" />
        <span className="text-2xl font-black text-amber-900 drop-shadow-sm select-none">₹</span>
      </div>
    </div>
  );
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
        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-400 transition-all ease-out"
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

export function CreditAnimationOverlay({ show, phase, creditsAfter }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (show) setVisible(true);
    else {
      const t = setTimeout(() => setVisible(false), 400);
      return () => clearTimeout(t);
    }
  }, [show]);

  if (!visible) return null;

  const isCoinGone = phase === "creating" || phase === "done";
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
        @keyframes credit-cross {
          0%   { opacity: 1; transform: none; }
          50%  { opacity: 0.3; transform: scale(0.85); }
          100% { opacity: 1; transform: none; }
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
            background: "linear-gradient(135deg, hsl(262 30% 12%) 0%, hsl(240 20% 8%) 100%)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {/* Top gradient strip */}
          <div className="h-1 w-full bg-gradient-to-r from-amber-400 via-violet-500 to-emerald-400" />

          <div className="px-8 py-10 flex flex-col items-center gap-6 text-center">

            {/* ── Phase 1 & 2: Coin ── */}
            {!isDone && (
              <>
                <CreditCoin shrinking={isCoinGone} />

                {/* Credit counter */}
                <div className="flex items-center gap-3">
                  <div className={`flex flex-col items-center transition-all duration-500
                    ${isCoinGone ? "opacity-50" : "opacity-100"}`}>
                    <span className="text-4xl font-black text-white tabular-nums"
                      style={isCoinGone ? { animation: "credit-cross 0.4s ease-in-out" } : {}}>
                      {isCoinGone ? creditsAfter : creditsAfter + 1}
                    </span>
                    <span className="text-xs text-white/50 uppercase tracking-wider mt-0.5">
                      {(isCoinGone ? creditsAfter : creditsAfter + 1) === 1 ? "Credit" : "Credits"}
                    </span>
                  </div>

                  {isCoinGone && (
                    <>
                      <span className="text-2xl text-white/30 font-light">→</span>
                      <div className="flex flex-col items-center">
                        <span className="text-4xl font-black tabular-nums"
                          style={{ color: creditsAfter === 0 ? "#f87171" : "#34d399" }}>
                          {creditsAfter}
                        </span>
                        <span className="text-xs text-white/50 uppercase tracking-wider mt-0.5">
                          {creditsAfter === 1 ? "Credit" : "Credits"}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Label + progress */}
                <div className="w-full space-y-3">
                  <p className="text-sm font-semibold text-white/80 tracking-wide">
                    {phase === "reserving"
                      ? "Reserving 1 Agreement Credit…"
                      : "Creating your Agreement…"}
                  </p>
                  {phase === "creating" && <ProgressBar active />}
                  {phase === "reserving" && (
                    <div className="flex justify-center gap-1.5 pt-1">
                      {[0, 1, 2].map(i => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-amber-400"
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
                  <p className="text-sm text-white/60">
                    1 credit used · {creditsAfter} remaining
                  </p>
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
