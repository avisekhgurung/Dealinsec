import { BadgeCheck, Briefcase, FileText, FileCheck, Receipt, Search, type LucideIcon } from "lucide-react";

/**
 * Modern branded app loader.
 * Shows the whole DealInSec journey (Prospect → Deal → Quote → Agreement →
 * Invoice → Paid: find the client, then get paid) as a traveling wave — each
 * stage fills emerald as the flow passes through it. Sized so all six fit a
 * 375px phone.
 */
export function AppLoader() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background overflow-hidden">
      {/* Ambient gradient backdrop */}
      <div
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at 30% 20%, rgba(5, 150, 105, 0.12) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(13, 148, 136, 0.12) 0%, transparent 50%)",
        }}
      />

      {/* Floating orbs */}
      <div className="absolute top-1/4 left-1/4 w-40 h-40 rounded-full bg-emerald-400/20 blur-3xl animate-pulse-slow" />
      <div
        className="absolute bottom-1/4 right-1/4 w-52 h-52 rounded-full bg-teal-400/20 blur-3xl animate-pulse-slow"
        style={{ animationDelay: "1s" }}
      />

      <div className="relative z-10 flex flex-col items-center gap-8 px-6">
        {/* Animated logo mark */}
        <div className="relative">
          {/* Outer rotating ring */}
          <div className="absolute inset-0 animate-spin-slow">
            <svg className="w-28 h-28" viewBox="0 0 100 100" fill="none">
              <circle
                cx="50"
                cy="50"
                r="46"
                stroke="url(#loader-gradient)"
                strokeWidth="2"
                strokeDasharray="8 12"
                strokeLinecap="round"
              />
              <defs>
                <linearGradient id="loader-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#059669" />
                  <stop offset="100%" stopColor="#0D9488" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Inner counter-rotating ring */}
          <div className="absolute inset-2 animate-spin-reverse">
            <svg className="w-24 h-24" viewBox="0 0 100 100" fill="none">
              <circle
                cx="50"
                cy="50"
                r="44"
                stroke="rgba(5, 150, 105, 0.25)"
                strokeWidth="1.5"
                strokeDasharray="2 8"
              />
            </svg>
          </div>

          {/* Center logo badge */}
          <div className="relative w-28 h-28 flex items-center justify-center">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg animate-breathe overflow-hidden"
              style={{
                background: "linear-gradient(135deg, #10B981 0%, #059669 55%, #0D9488 100%)",
                boxShadow: "0 10px 32px -6px rgba(5, 150, 105, 0.5)",
              }}
            >
              <svg width="36" height="36" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M13.5 12 H22.5 C29.9558 12 34 16.9249 34 24 C34 31.0751 29.9558 36 22.5 36 H13.5 V12 Z M18.5 17 V31 H22.3 C26.6 31 29 28.4 29 24 C29 19.6 26.6 17 22.3 17 H18.5 Z"
                  fill="white"
                  fillRule="evenodd"
                />
                <circle cx="35.5" cy="33.5" r="3.2" fill="#FBBF24" stroke="white" strokeWidth="1.6" />
              </svg>
            </div>
          </div>
        </div>

        {/* Brand name with gradient */}
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight leading-none">
            <span className="text-foreground">Deal</span>
            <span
              style={{
                background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              insec
            </span>
          </h1>
          <p className="text-xs text-muted-foreground tracking-wide">
            Setting up your workspace
          </p>
        </div>

        {/* The journey: find the client, then get paid */}
        <ol aria-label="Prospect, deal, quote, agreement, invoice, paid" className="flex items-start gap-1 sm:gap-1.5 mt-2">
          {JOURNEY.map(({ icon, label }, i) => (
            <li key={label} className="flex items-start gap-1 sm:gap-1.5">
              {i > 0 && <PipelineConnector delay={i * 0.45 - 0.2} />}
              <PipelineStep icon={icon} delay={i * 0.45} label={label} />
            </li>
          ))}
        </ol>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mt-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce-dot"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>

      {/* Scoped animations */}
      <style>{`
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes spin-reverse { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes pulse-slow { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.1); } }
        @keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes bounce-dot { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-6px); opacity: 1; } }
        @keyframes pipeline-step {
          0%, 100% { transform: scale(1); opacity: 0.65; background-color: transparent; color: #059669; }
          12% { transform: scale(1.12); opacity: 1; background-color: #059669; color: #ffffff;
                box-shadow: 0 8px 22px -4px rgba(5, 150, 105, 0.55); }
          30% { transform: scale(1); opacity: 0.9; background-color: transparent; color: #059669; }
        }
        @keyframes pipeline-flow {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        .animate-spin-slow { animation: spin-slow 8s linear infinite; }
        .animate-spin-reverse { animation: spin-reverse 12s linear infinite; }
        .animate-pulse-slow { animation: pulse-slow 4s ease-in-out infinite; }
        .animate-breathe { animation: breathe 2.5s ease-in-out infinite; }
        .animate-bounce-dot { animation: bounce-dot 1.2s ease-in-out infinite; }
        .animate-pipeline-step {
          animation: pipeline-step 3.6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-pipeline-step, .animate-pipeline-flow, .animate-spin-slow,
          .animate-spin-reverse, .animate-breathe, .animate-bounce-dot,
          .animate-pulse-slow { animation: none !important; }
        }
        .animate-pipeline-flow {
          background: linear-gradient(90deg, rgba(5, 150, 105, 0.1) 0%, #059669 50%, rgba(13, 148, 136, 0.1) 100%);
          background-size: 200% 100%;
          animation: pipeline-flow 1.6s linear infinite;
        }
      `}</style>
    </div>
  );
}

const JOURNEY: { icon: LucideIcon; label: string }[] = [
  { icon: Search, label: "Prospect" },
  { icon: Briefcase, label: "Deal" },
  { icon: FileText, label: "Quote" },
  { icon: FileCheck, label: "Agreement" },
  { icon: Receipt, label: "Invoice" },
  { icon: BadgeCheck, label: "Paid" },
];

function PipelineStep({
  icon: Icon,
  delay,
  label,
}: {
  icon: LucideIcon;
  delay: number;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center bg-white dark:bg-white/10 border border-emerald-200/50 dark:border-emerald-500/20 animate-pipeline-step"
        style={{ animationDelay: `${delay}s` }}
      >
        <Icon className="w-4 h-4 text-current" strokeWidth={2.2} />
      </div>
      <span className="text-[10px] font-medium text-muted-foreground tracking-wide">
        {label}
      </span>
    </div>
  );
}

function PipelineConnector({ delay }: { delay: number }) {
  return (
    <div aria-hidden="true" className="mt-[17px] sm:mt-[19px] w-2 sm:w-5 h-0.5 rounded-full animate-pipeline-flow" style={{ animationDelay: `${delay}s` }} />
  );
}

/**
 * Lightweight loader for route transitions.
 * A thin gradient progress bar at the top of the viewport —
 * non-blocking, unobtrusive, used by apps like Linear & Notion.
 */
export function RouteLoader() {
  // Shown while a screen's code loads. It appears only after 150 ms, so a fast load never flashes a bar, it tells
  // screen readers what is happening, and it holds still for people who prefer reduced motion.
  return (
    <>
      <div className="dis-route-loader fixed top-0 left-0 right-0 z-[9999] h-0.5 overflow-hidden pointer-events-none" role="status" aria-label="Loading">
        <div
          className="h-full w-full origin-left animate-route-progress"
          style={{
            background: "linear-gradient(90deg, #059669 0%, #0D9488 50%, #10b981 100%)",
            boxShadow: "0 0 10px rgba(5, 150, 105, 0.6)",
          }}
        />
      </div>
      <style>{`
        @keyframes route-progress {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
        @keyframes route-loader-in { from { opacity: 0; } to { opacity: 1; } }
        .dis-route-loader { opacity: 0; animation: route-loader-in 0.12s ease-out 0.15s forwards; }
        .animate-route-progress {
          animation: route-progress 1.1s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .dis-route-loader { animation: none; opacity: 1; }
          .animate-route-progress { animation: none; transform: scaleX(0.4); }
        }
      `}</style>
    </>
  );
}

/**
 * Smaller inline variant for use within cards/sections,
 * when the full-screen loader would be overkill.
 */
export function InlineLoader({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 animate-spin-slow-inline">
          <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
            <circle
              cx="20"
              cy="20"
              r="17"
              stroke="url(#inline-gradient)"
              strokeWidth="2.5"
              strokeDasharray="4 6"
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="inline-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#059669" />
                <stop offset="100%" stopColor="#0D9488" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div className="absolute inset-2 flex items-center justify-center">
          <div
            className="w-4 h-4 rounded-md"
            style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
          />
        </div>
      </div>
      {label && <p className="text-xs text-muted-foreground">{label}</p>}
      <style>{`
        @keyframes spin-slow-inline { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin-slow-inline { animation: spin-slow-inline 2s linear infinite; }
      `}</style>
    </div>
  );
}
