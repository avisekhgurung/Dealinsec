import { Link } from "wouter";

type LogoSize = "sm" | "md" | "lg" | "xl";

interface DealinsecLogoProps {
  size?: LogoSize;
  withText?: boolean;
  asLink?: boolean;
  className?: string;
  variant?: "default" | "mono-light" | "mono-dark";
}

const SIZE_MAP: Record<LogoSize, { box: number; text: string; gap: string }> = {
  sm: { box: 28, text: "text-base", gap: "gap-2" },
  md: { box: 36, text: "text-lg", gap: "gap-2.5" },
  lg: { box: 44, text: "text-xl", gap: "gap-3" },
  xl: { box: 56, text: "text-2xl", gap: "gap-3" },
};

export function DealinsecLogo({
  size = "md",
  withText = true,
  asLink = false,
  className = "",
  variant = "default",
}: DealinsecLogoProps) {
  const { box, text, gap } = SIZE_MAP[size];
  const uid = `dls-${size}-${variant}`;

  const content = (
    <div className={`inline-flex items-center ${gap} ${className}`}>
      <svg
        width={box}
        height={box}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0 drop-shadow-sm"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#10B981" />
            <stop offset="0.55" stopColor="#059669" />
            <stop offset="1" stopColor="#0D9488" />
          </linearGradient>
          <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="white" stopOpacity="0.28" />
            <stop offset="0.5" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-accent`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#FBBF24" />
            <stop offset="1" stopColor="#F59E0B" />
          </linearGradient>
        </defs>

        {/* Rounded gradient tile */}
        <rect width="48" height="48" rx="13" fill={variant === "mono-light" ? "white" : variant === "mono-dark" ? "#0F172A" : `url(#${uid}-bg)`} />

        {/* Subtle top sheen */}
        {variant === "default" && (
          <rect width="48" height="48" rx="13" fill={`url(#${uid}-sheen)`} />
        )}

        {/* Inner 'D' — bold geometric letterform */}
        <path
          d="M13.5 12 H22.5 C29.9558 12 34 16.9249 34 24 C34 31.0751 29.9558 36 22.5 36 H13.5 V12 Z M18.5 17 V31 H22.3 C26.6 31 29 28.4 29 24 C29 19.6 26.6 17 22.3 17 H18.5 Z"
          fill={variant === "mono-dark" ? "white" : variant === "mono-light" ? "#0F172A" : "white"}
          fillRule="evenodd"
        />

        {/* Signature accent — the 'insec' seal */}
        <circle
          cx="35.5"
          cy="33.5"
          r="3.2"
          fill={variant === "default" ? `url(#${uid}-accent)` : variant === "mono-dark" ? "#FBBF24" : "#F59E0B"}
          stroke={variant === "mono-light" ? "white" : variant === "mono-dark" ? "#0F172A" : "url(#" + uid + "-bg)"}
          strokeWidth="1.8"
        />
      </svg>

      {withText && (
        <span className={`${text} font-bold tracking-tight leading-none`}>
          <span className="text-neutral-900 dark:text-white">Deal</span>
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
        </span>
      )}
    </div>
  );

  if (asLink) {
    return (
      <Link href="/" className="inline-flex items-center outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 rounded-md">
        {content}
      </Link>
    );
  }

  return content;
}

export default DealinsecLogo;
