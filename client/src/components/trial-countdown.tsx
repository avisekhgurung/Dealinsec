/**
 * Animated 7-day trial countdown — the dashboard's trial-state card.
 *
 * A gold progress ring (the logo's seal color) drains over the trial window
 * around the days-left numeral, next to a live d/h/m/s ticker. Emerald card
 * = the trial FEELS like Pro; the ticking clock is the honest counterweight.
 * Ticks every second; the ring eases via CSS so reduced-motion users just
 * see it step. Display only — entitlements are enforced server-side.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TRIAL_DAYS } from "@shared/schema";

const DAY_MS = 86_400_000;
const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

function partsLeft(endsAtMs: number) {
  const left = Math.max(0, endsAtMs - Date.now());
  return {
    left,
    d: Math.floor(left / DAY_MS),
    h: Math.floor((left % DAY_MS) / 3_600_000),
    m: Math.floor((left % 3_600_000) / 60_000),
    s: Math.floor((left % 60_000) / 1_000),
  };
}

function Unit({ v, label }: { v: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="min-w-[2.25rem] text-center px-1.5 py-1.5 rounded-lg bg-white/15 font-bold text-white tabular-nums text-base leading-none">
        {String(v).padStart(2, "0")}
      </span>
      <span className="mt-1 text-[9px] uppercase tracking-wider text-white/60 font-semibold">
        {label}
      </span>
    </div>
  );
}

export function TrialCountdown({ trialEndsAt }: { trialEndsAt: Date | string }) {
  const endsAtMs = new Date(trialEndsAt).getTime();
  const [t, setT] = useState(() => partsLeft(endsAtMs));

  useEffect(() => {
    const id = setInterval(() => setT(partsLeft(endsAtMs)), 1_000);
    return () => clearInterval(id);
  }, [endsAtMs]);

  // Expired mid-session: vanish quietly; the next auth refetch swaps the
  // parent to the trial-ended card.
  if (t.left <= 0) return null;

  const frac = Math.min(1, t.left / (TRIAL_DAYS * DAY_MS));
  // Ceil-style day count so day 7 reads "7", matching getTrialDaysLeft.
  const daysCeil = Math.min(TRIAL_DAYS, Math.max(1, Math.ceil(t.left / DAY_MS)));
  const lastDay = t.left <= DAY_MS;
  const endsLabel = new Date(endsAtMs).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });

  return (
    <div
      className="relative overflow-hidden rounded-2xl dis-shimmer animate-fade-in"
      style={{
        background:
          "linear-gradient(135deg, hsl(160 84% 18%) 0%, hsl(160 84% 27%) 50%, hsl(174 77% 32%) 100%)",
      }}
      data-testid="trial-countdown"
    >
      {/* soft decorative orbs, matching the profile plan card */}
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white/10 -mr-10 -mt-10" aria-hidden="true" />
      <div className="absolute bottom-0 left-0 w-20 h-20 rounded-full bg-white/5 -ml-6 -mb-6" aria-hidden="true" />

      <div className="relative p-4 lg:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Gold ring draining over the trial window, numeral in the middle */}
        <div className="relative w-16 h-16 flex-shrink-0" aria-hidden="true">
          <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
            <defs>
              <linearGradient id="dis-trial-ring" x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#FBBF24" />
                <stop offset="1" stopColor="#F59E0B" />
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r={RING_R} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="5" />
            <circle
              cx="32"
              cy="32"
              r={RING_R}
              fill="none"
              stroke="url(#dis-trial-ring)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - frac)}
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-black text-white leading-none tabular-nums">
              {lastDay ? t.h : daysCeil}
            </span>
            <span className="text-[8px] uppercase tracking-wider text-white/70 font-bold">
              {lastDay ? "hours" : daysCeil === 1 ? "day" : "days"}
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300">
            <Sparkles className="w-3 h-3" /> Pro trial
          </p>
          <p className="text-base lg:text-lg font-bold text-white mt-0.5">
            {lastDay ? "Last day — everything unlocked" : "Everything unlocked"}
          </p>
          <p className="text-xs text-white/70 mt-0.5">
            Agreements, GST invoices &amp; payment tracking — free until {endsLabel}.
          </p>
        </div>

        <div className="flex flex-col items-start sm:items-end gap-2.5 flex-shrink-0">
          <div className="flex gap-1.5" role="timer" aria-label="Time left in your Pro trial">
            <Unit v={t.d} label="days" />
            <Unit v={t.h} label="hrs" />
            <Unit v={t.m} label="min" />
            <Unit v={t.s} label="sec" />
          </div>
          <Link href="/pricing">
            <Button
              size="sm"
              className="bg-white text-emerald-700 hover:bg-white/90 font-bold border-0"
              data-testid="trial-countdown-cta"
            >
              Keep Pro — see plans
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
