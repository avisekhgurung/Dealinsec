import { motion } from "framer-motion";

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
