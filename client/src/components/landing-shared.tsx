import { motion } from "framer-motion";

/**
 * Scroll to a section of this page ("#ai-team") under the sticky header (every section has scroll-mt-20), smoothly
 * unless the person prefers reduced motion, and put the hash in the address bar without a second jump. Returns false
 * when there is no such section, so the caller can let the browser handle the link.
 */
export function scrollToSection(hash: string): boolean {
  const el = typeof document !== "undefined" ? document.getElementById(hash.replace(/^#/, "")) : null;
  if (!el) return false;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  return true;
}

/**
 * onClick for an in-page <a href="#…">: scrolls with scrollToSection instead of the browser's jump. `delay` lets a
 * closing menu finish first (a collapsing mobile menu moves the page under the scroll). New-tab clicks are left alone.
 */
export function onSectionLinkClick(e: React.MouseEvent<HTMLAnchorElement>, delay = 0) {
  const href = e.currentTarget.getAttribute("href") ?? "";
  if (!href.startsWith("#") || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  if (!document.getElementById(href.slice(1))) return;
  e.preventDefault();
  if (delay > 0) window.setTimeout(() => scrollToSection(href), delay);
  else scrollToSection(href);
}

export const BRAND_GRADIENT = "linear-gradient(135deg, #059669 0%, #0D9488 100%)";

export const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

export const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

export function GradientText({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        background: "linear-gradient(135deg, #059669 0%, #14B8A6 50%, #0D9488 100%)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
      }}
    >
      {children}
    </span>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      className="text-center max-w-2xl mx-auto"
    >
      <p className="text-xs uppercase tracking-widest font-semibold text-emerald-600 dark:text-emerald-400 mb-3">
        {eyebrow}
      </p>
      <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1] mb-4 text-balance">
        {title}
      </h2>
      <p className="text-base sm:text-lg text-neutral-600 dark:text-neutral-400 leading-relaxed">{subtitle}</p>
    </motion.div>
  );
}

/** Two-column row used by the Scope / Payments / Professional sections. */
export function SplitRow({
  eyebrow,
  title,
  desc,
  children,
  visual,
  reverse,
  id,
}: {
  eyebrow: string;
  title: React.ReactNode;
  desc: string;
  children?: React.ReactNode;
  visual: React.ReactNode;
  reverse?: boolean;
  id?: string;
}) {
  return (
    <div id={id} className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className={reverse ? "lg:order-2" : ""}
      >
        <p className="text-xs uppercase tracking-widest font-semibold text-emerald-600 dark:text-emerald-400 mb-3">
          {eyebrow}
        </p>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-[1.1] mb-4 text-balance">{title}</h2>
        <p className="text-base sm:text-lg text-neutral-600 dark:text-neutral-400 leading-relaxed">{desc}</p>
        {children}
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        className={`min-w-0 ${reverse ? "lg:order-1" : ""}`}
      >
        {visual}
      </motion.div>
    </div>
  );
}
