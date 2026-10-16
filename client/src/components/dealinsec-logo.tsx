/**
 * The DealInSec logo: the geometric D (a shadowed bar, a top ribbon sweeping round the bowl, a bottom ribbon folding up
 * from the corner) and the wordmark, "Deal" in charcoal and "InSec" in the emerald gradient. The same geometry as the
 * files in client/public/brand/ (dealinsec-mark.svg, dealinsec-logo*.svg, dealinsec-lockup*.svg) and the server pages'
 * LOGO_SVG (server/tools/layout.ts).
 *
 *   <DealinsecLogo />                      mark + wordmark, light or dark following the theme
 *   <DealinsecLogo withText={false} />     the mark alone (compact navigation, small icons)
 *   <DealinsecLogo tagline />              with "Find Clients. Close Deals. Get Paid." (landing, auth, footer)
 *   <DealinsecLogo tone="dark" />          for a dark neutral surface whatever the theme (the app bar)
 *   <DealinsecLogo tone="inverse" />       for a coloured (emerald) surface: white mark, white and pale-emerald wordmark
 *   variant "mono-light" / "mono-dark"     a single-colour mark: white for coloured backgrounds, charcoal for print
 *
 * The slogan is never shown in compact places: callers opt in.
 */
import { useId } from "react";
import { Link } from "wouter";

export const BRAND_NAME = "DealInSec";
export const BRAND_SLOGAN = "Find Clients. Close Deals. Get Paid.";

type LogoSize = "xs" | "sm" | "md" | "lg" | "xl";
type Tone = "auto" | "light" | "dark" | "inverse";

interface DealinsecLogoProps {
  size?: LogoSize;
  withText?: boolean;
  /** Show the slogan under the wordmark (not for compact navigation). */
  tagline?: boolean;
  asLink?: boolean;
  className?: string;
  /** "auto" follows the app's light/dark theme; "dark" is for a dark surface in either theme. */
  tone?: Tone;
  variant?: "default" | "mono-light" | "mono-dark";
}

/** Mark size (px), wordmark size (px), gap. The mark's height matches the wordmark's cap height plus a little. */
const SIZE_MAP: Record<LogoSize, { box: number; text: number; gap: string }> = {
  xs: { box: 22, text: 16, gap: "gap-1.5" },
  sm: { box: 28, text: 19, gap: "gap-2" },
  md: { box: 34, text: 23, gap: "gap-2.5" },
  lg: { box: 44, text: 30, gap: "gap-3" },
  xl: { box: 60, text: 40, gap: "gap-3.5" },
};

const BAR = "M8 8C10 14.6 14.2 19 20 19V45L8 56Z";
const TOP = "M8 8H30C45.5 8 57 18.5 57 32C57 45.5 45.5 56 30 56H28V45H29.5C37 45 42.5 39.4 42.5 32C42.5 24.6 37 19 29.5 19H20C14.2 19 10 14.6 8 8Z";
const BOTTOM = "M8 56L20 45H31V56Z";
const SOLID = "M8 8H30C45.5 8 57 18.5 57 32C57 45.5 45.5 56 30 56H8ZM20 19V45H29.5C37 45 42.5 39.4 42.5 32C42.5 24.6 37 19 29.5 19Z";

/** The D on its own, transparent. Decorative unless given a label. */
export function DealinsecMark({ size = 32, variant = "default", className = "", label }: { size?: number; variant?: DealinsecLogoProps["variant"]; className?: string; label?: string }) {
  const id = useId().replace(/:/g, "");
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  if (variant !== "default") {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={`shrink-0 ${className}`} {...a11y}>
        <path d={SOLID} fill={variant === "mono-light" ? "#FFFFFF" : "#111B22"} fillRule="evenodd" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={`shrink-0 ${className}`} {...a11y}>
      <defs>
        <linearGradient id={`${id}t`} x1="10" y1="8" x2="56" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2FE6A0" /><stop offset=".45" stopColor="#14BF8F" /><stop offset="1" stopColor="#0C8E7B" />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="14" y1="10" x2="14" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#086B5F" /><stop offset=".35" stopColor="#0E9A85" /><stop offset=".8" stopColor="#0E9883" /><stop offset="1" stopColor="#0A7B6C" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="8" y1="56" x2="31" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#33EBA4" /><stop offset=".55" stopColor="#1CCB94" /><stop offset="1" stopColor="#10A584" />
        </linearGradient>
      </defs>
      <path d={BAR} fill={`url(#${id}l)`} />
      <path d={TOP} fill={`url(#${id}t)`} />
      <path d={BOTTOM} fill={`url(#${id}b)`} />
    </svg>
  );
}

/** "Deal" + "InSec", as live text (Inter 800), so it stays crisp and searchable. */
export function DealinsecWordmark({ size = 23, tone = "auto", className = "" }: { size?: number; tone?: Tone; className?: string }) {
  const deal = tone === "dark" || tone === "inverse" ? "text-[#F3F6F7]" : tone === "light" ? "text-[#111B22]" : "text-[#111B22] dark:text-[#F3F6F7]";
  // The accent gradient: light surfaces get the deeper emerald, dark ones the brighter (index.css; "auto" follows .dark).
  const accent = tone === "inverse" ? "dis-wordmark-accent dis-on-color" : tone === "dark" ? "dis-wordmark-accent dis-on-dark" : tone === "light" ? "dis-wordmark-accent dis-on-light" : "dis-wordmark-accent";
  return (
    <span className={`dis-wordmark whitespace-nowrap leading-none ${className}`} style={{ fontSize: size }}>
      <span className={deal}>Deal</span><span className={accent}>InSec</span>
    </span>
  );
}

export function DealinsecLogo({ size = "md", withText = true, tagline = false, asLink = false, className = "", tone = "auto", variant = "default" }: DealinsecLogoProps) {
  const { box, text, gap } = SIZE_MAP[size];
  const sloganTone = tone === "inverse" ? "text-white/75" : tone === "dark" ? "text-[#A3B3BD]" : tone === "light" ? "text-[#3A4550]" : "text-[#3A4550] dark:text-[#A3B3BD]";
  const markSize = withText && tagline ? Math.round(box * 1.3) : box;

  const content = (
    <span className={`inline-flex items-center ${gap} ${className}`} {...(!withText ? { role: "img", "aria-label": BRAND_NAME } : {})}>
      <DealinsecMark size={markSize} variant={tone === "inverse" && variant === "default" ? "mono-light" : variant} />
      {withText && (
        <span className="flex min-w-0 flex-col">
          <DealinsecWordmark size={text} tone={tone} />
          {tagline && (
            <span className={`dis-slogan mt-1 whitespace-nowrap font-medium leading-none ${sloganTone}`} style={{ fontSize: Math.max(11, Math.round(text * 0.36)) }}>
              {BRAND_SLOGAN}
            </span>
          )}
        </span>
      )}
    </span>
  );

  if (asLink) {
    return (
      <Link href="/" aria-label={`${BRAND_NAME} home`} className="inline-flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50">
        {content}
      </Link>
    );
  }
  return content;
}

export default DealinsecLogo;
