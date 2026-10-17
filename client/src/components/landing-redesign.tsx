/**
 * The homepage sections (Oct 2026 redesign, "Find Clients. Close Deals. Get Paid."): hero with the product, the six
 * things DealInSec does, the journey from prospect to payment, one workspace instead of many tools, who it's for, the
 * overview, the closing call to action and the FAQ. landing.tsx composes them with the header, pricing, demo and footer.
 *
 * Honesty rules (see the landing notes): pictures of the product use example data and say so; nothing claims payment
 * processing (DealInSec tracks payments), sending email for you, customer counts or logos; other companies' products
 * are named generically, never by logo. Scroll-in reveals use framer; continuous motion is CSS, and everything holds
 * still for people who prefer reduced motion.
 */
import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { Link } from "wouter";
import {
  ArrowRight, Building2, Check, CheckCircle2, CreditCard, FileSignature, FileText, LayoutDashboard, LifeBuoy,
  PlayCircle, Plus, ReceiptText, Search, Signature, Sparkles, UserRound, Users,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DealinsecMark, DealinsecWordmark } from "@/components/dealinsec-logo";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { LANDING_FAQS } from "@shared/landing-faqs";

const GREEN = "text-emerald-600 dark:text-emerald-400";
const ease = [0.22, 1, 0.36, 1] as const;
const reveal = { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } };
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

/** A section that reveals once, as it scrolls in. */
function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={reveal} transition={{ delay }}>
      {children}
    </motion.div>
  );
}

/** Handwritten note (Caveat, subset in index.html) with a hand-drawn arrow. Decorative. */
function Scribble({ children, className, arrow = "down" }: { children: React.ReactNode; className?: string; arrow?: "down" | "down-left" | "down-right" | "up" }) {
  const up = arrow === "up";
  const d = arrow === "down" || up ? "M20 4C26 14 26 24 18 34" : arrow === "down-left" ? "M34 4C30 16 20 24 6 30" : "M6 4C10 16 20 24 34 30";
  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute flex select-none font-['Caveat',cursive] text-[19px] leading-tight text-neutral-700 dark:text-neutral-300", up ? "flex-col-reverse" : "flex-col", className)}>
      {children}
      <svg className={cn("block h-9 w-10 text-neutral-500", up ? "mb-1 rotate-180" : "mt-1")} viewBox="0 0 40 36" fill="none">
        <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="dis-draw" />
        <path d={arrow === "down" || up ? "M13 29l5 6 5-5" : arrow === "down-left" ? "M10 25l-4 5 6 1" : "M29 25l5 5-6 1"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────────────────────── */

const DEAL_ROWS = [
  { client: "Acme Marketing", value: "$3,500", stage: "Quote sent", tone: "sky", when: "2 days ago" },
  { client: "Pixel Studio", value: "$7,200", stage: "Negotiating", tone: "amber", when: "4 days ago" },
  { client: "BrandBoost", value: "$1,800", stage: "Won", tone: "emerald", when: "1 week ago" },
  { client: "GrowthLabs", value: "$4,500", stage: "Quote sent", tone: "sky", when: "1 week ago" },
  { client: "DesignCraft", value: "$2,200", stage: "Lost", tone: "rose", when: "2 weeks ago" },
] as const;
const TONE: Record<string, string> = {
  sky: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

/** The product, drawn: the Deals screen with example data, and an invoice marked paid. */
function HeroProduct() {
  const side = [
    { Icon: LayoutDashboard, label: "Dashboard" }, { Icon: Search, label: "Prospects" }, { Icon: Users, label: "Leads" },
    { Icon: Building2, label: "Deals", active: true }, { Icon: FileText, label: "Quotes" }, { Icon: FileSignature, label: "Agreements" }, { Icon: ReceiptText, label: "Invoices" },
  ];
  return (
    <div className="relative" aria-hidden="true">
      <Scribble className="-top-14 right-4 hidden text-right lg:block" arrow="down-left">From prospect<br />to payment</Scribble>
      <div style={{ animationDelay: ".25s" }}
        className="dis-hero-in overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-[0_30px_80px_-30px_rgba(6,78,59,0.35)] dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex">
          <div className="hidden w-[150px] shrink-0 border-r border-neutral-100 bg-neutral-50/70 p-3 sm:block dark:border-neutral-800 dark:bg-neutral-900/60">
            <div className="mb-4 flex items-center gap-1.5 px-1"><DealinsecMark size={18} /><DealinsecWordmark size={12} /></div>
            <ul className="space-y-0.5 text-[11px]">
              {side.map(({ Icon, label, active }) => (
                <li key={label} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5", active ? "bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "text-neutral-500")}>
                  <Icon className="h-3.5 w-3.5" />{label}
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[15px] font-bold">Deals</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white"><Plus className="h-3 w-3" />Create deal</span>
            </div>
            <div className="mb-3 flex gap-3 border-b border-neutral-100 pb-2 text-[10px] text-neutral-500 dark:border-neutral-800">
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">All</span><span>Quote sent</span><span>Negotiating</span><span>Won</span><span className="hidden sm:inline">Lost</span>
            </div>
            <div className="grid grid-cols-[1.5fr_.8fr_1fr_.9fr] gap-2 px-1 pb-1.5 text-[9.5px] font-medium uppercase tracking-wide text-neutral-400">
              <span>Client</span><span>Value</span><span>Stage</span><span className="text-right">Updated</span>
            </div>
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {DEAL_ROWS.map((r, i) => (
                <li key={r.client} style={{ animationDelay: `${0.6 + i * 0.09}s` }}
                  className="dis-row-in grid grid-cols-[1.5fr_.8fr_1fr_.9fr] items-center gap-2 px-1 py-2 text-[11px]">
                  <span className="truncate font-medium">{r.client}</span>
                  <span className="tabular-nums">{r.value}</span>
                  <span><span className={cn("rounded-full px-2 py-0.5 text-[9.5px] font-semibold", TONE[r.tone])}>{r.stage}</span></span>
                  <span className="text-right text-neutral-400">{r.when}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div
        className="dis-invoice-in absolute -bottom-7 right-2 flex items-center gap-3 rounded-xl border border-neutral-200/80 bg-white px-3.5 py-2.5 shadow-xl sm:-right-6 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/15"><CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" /></span>
        <span className="text-[11px] leading-tight"><b className="block text-[12px]">Invoice paid 🎉</b><span className="text-neutral-500">$3,500 from Acme Marketing</span></span>
        <span className="ml-1 flex h-7 items-end gap-0.5">
          {[40, 65, 50, 100].map((h, i) => <span key={i} className="dis-bar w-1.5 rounded-sm bg-gradient-to-t from-emerald-600 to-emerald-400" style={{ height: `${h}%`, animationDelay: `${1.4 + i * 0.1}s` }} />)}
        </span>
      </div>
    </div>
  );
}

export function HeroSection({ isAuthenticated, onPrimary }: { isAuthenticated: boolean; onPrimary: () => void }) {
  return (
    <section className="relative overflow-hidden pb-20 pt-10 sm:pt-14 lg:pb-28 lg:pt-16">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1fr_1.12fr] lg:gap-10 lg:px-8">
        <div className="max-w-xl">
          <p style={{ animationDelay: "0.05s" }} className="dis-hero-in inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-white/80 px-3 py-1 text-[11.5px] font-semibold text-emerald-700 shadow-sm backdrop-blur dark:border-emerald-800/50 dark:bg-neutral-900/70 dark:text-emerald-300">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
            AI-assisted client acquisition, from deal to payment
          </p>
          <h1 style={{ animationDelay: "0.13s" }} className="dis-hero-in mt-5 text-[2.75rem] font-extrabold leading-[1.02] tracking-[-0.035em] text-[#111B22] sm:text-6xl lg:text-[4.1rem] dark:text-white">
            Find Clients.<br />Close <span className={GREEN}>Deals.</span><br /><span className="dis-gradient-text">Get Paid.</span>
          </h1>
          <p style={{ animationDelay: "0.21s" }} className="dis-hero-in mt-5 max-w-lg text-base leading-relaxed text-neutral-600 sm:text-lg dark:text-neutral-400">
            DealInSec helps small agencies and consultants research the right clients, send professional quotations, get agreements signed and track every payment, all in one place.
          </p>
          <div style={{ animationDelay: "0.29s" }} className="dis-hero-in mt-7 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => { trackEvent("hero_cta_click", { label: isAuthenticated ? "dashboard" : "start_free" }); onPrimary(); }} data-testid="button-hero-cta"
              className="group inline-flex h-12 items-center justify-center rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-6 text-[15px] font-semibold text-white shadow-lg shadow-emerald-600/25 transition hover:shadow-emerald-600/40">
              {isAuthenticated ? "Go to dashboard" : "Start for free"}<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            {/* The live demo is for visitors; a signed-in person sees how it works instead. */}
            <a href={isAuthenticated ? "#how" : "#try"} onClick={() => trackEvent("hero_cta_click", { label: isAuthenticated ? "see_how" : "live_demo" })} data-testid="link-hero-demo"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-neutral-200 bg-white px-6 text-[15px] font-semibold shadow-sm transition hover:border-emerald-300 dark:border-neutral-700 dark:bg-neutral-900">
              <PlayCircle className="mr-2 h-5 w-5 text-emerald-600" />{isAuthenticated ? "See how it works" : "Try the live demo"}
            </a>
          </div>
          <ul style={{ animationDelay: "0.37s" }} className="dis-hero-in mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-neutral-600 dark:text-neutral-400">
            {["No credit card required", "Free plan: 4 deals a month", "Set up in minutes"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-600" />{t}</li>
            ))}
          </ul>
        </div>
        <div className="relative lg:pl-4">
          <HeroProduct />
          <p className="mt-12 text-center text-[11px] text-neutral-400">Illustration with example data.</p>
        </div>
      </div>
    </section>
  );
}

/* ── Everything you need ─────────────────────────────────────────────────────────────── */

const FEATURES = [
  { Icon: Search, title: "Find prospects", text: "Discover companies that fit, with the evidence behind each one." },
  { Icon: Users, title: "Create deals", text: "Track every opportunity from first contact to won." },
  { Icon: FileText, title: "Send quotes", text: "Professional quotations in minutes, in your brand." },
  { Icon: Signature, title: "Sign agreements", text: "Get agreements signed online by your client." },
  { Icon: ReceiptText, title: "Create invoices", text: "Raise invoices straight from the agreed scope." },
  { Icon: CreditCard, title: "Get paid", text: "Track payments and stay on top of cash flow." },
];

export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">Everything you need to <span className={GREEN}>grow your business</span></h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">Stop juggling separate tools. DealInSec brings your whole client journey together.</p>
        </Reveal>
        <motion.ul initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} variants={stagger} className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
          {FEATURES.map(({ Icon, title, text }) => (
            <motion.li key={title} variants={reveal}
              className="group rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-900/5 sm:p-5 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-emerald-800">
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 transition group-hover:scale-105 group-hover:bg-emerald-600 group-hover:text-white dark:bg-emerald-500/15 dark:text-emerald-300">
                <Icon className="h-5 w-5" strokeWidth={2} />
              </span>
              <h3 className="text-[15px] font-bold">{title}</h3>
              <p className="mt-1 text-[13px] leading-snug text-neutral-500 dark:text-neutral-400">{text}</p>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}

/* ── From finding the client to getting paid ─────────────────────────────────────────── */

const STEPS = [
  { title: "Find and add prospects", text: "Discover companies that fit, or import your own list." },
  { title: "Create a deal", text: "Track the opportunity and its details." },
  { title: "Send a professional quote", text: "A clear, branded quotation your client can accept online." },
  { title: "Get the agreement signed", text: "The agreed scope becomes an agreement they sign online." },
  { title: "Invoice and track payment", text: "Raise the invoice and see when it's paid." },
];
const RAIL = [
  { Icon: UserRound, label: "Prospect" }, { Icon: Users, label: "Deal" }, { Icon: FileText, label: "Quote" },
  { Icon: Signature, label: "Agreement" }, { Icon: ReceiptText, label: "Invoice" }, { Icon: CreditCard, label: "Payment" },
];

export function JourneySection({ showDemo = true }: { showDemo?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-120px" });
  return (
    <section id="how" className="scroll-mt-20 bg-gradient-to-b from-emerald-50/50 to-transparent py-16 sm:py-24 dark:from-emerald-950/20">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:px-8">
        <Reveal>
          <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />How it works</p>
          <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-[-0.025em] sm:text-[2.6rem]">From finding the client<br className="hidden sm:block" /> to getting paid.</h2>
          <p className="mt-3 max-w-md text-neutral-600 dark:text-neutral-400">One connected process, so you win more of the right clients and get paid faster.</p>
          <ol className="mt-7 space-y-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white shadow-md shadow-emerald-600/25">{i + 1}</span>
                <span><b className="block text-[15px]">{s.title}</b><span className="text-sm text-neutral-500 dark:text-neutral-400">{s.text}</span></span>
              </li>
            ))}
          </ol>
          {showDemo && <a href="#try" className="mt-8 inline-flex h-11 items-center rounded-lg bg-emerald-700 px-5 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-800">Try the live demo<ArrowRight className="ml-2 h-4 w-4" /></a>}
        </Reveal>

        <div ref={ref} aria-hidden="true" className={cn("dis-journey relative grid grid-cols-[auto_1fr] items-center gap-5 sm:gap-8", seen && "dis-journey-on")}>
          <ul className="relative flex flex-col gap-4 sm:gap-5">
            <span className="absolute left-[17px] top-4 bottom-4 w-px bg-emerald-200 dark:bg-emerald-900" />
            {RAIL.map(({ Icon, label }, i) => (
              <li key={label} className="dis-rail-step relative flex items-center gap-2.5" style={{ animationDelay: `${0.2 + i * 0.25}s` }}>
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-600 dark:border-emerald-800 dark:bg-neutral-900"><Icon className="h-4 w-4" /></span>
                <span className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[13px] font-semibold shadow-sm dark:border-neutral-800 dark:bg-neutral-900">{label}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-4">
            <div className="dis-slide rounded-2xl border border-neutral-200 bg-white p-4 shadow-lg shadow-emerald-900/5 dark:border-neutral-800 dark:bg-neutral-900" style={{ animationDelay: ".4s" }}>
              <div className="flex items-start justify-between"><span className="flex items-center gap-2 text-[12px] font-semibold"><FileText className="h-4 w-4 text-emerald-600" />Quote #Q-001</span><span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">Sent</span></div>
              <p className="mt-1 text-[11px] text-neutral-500">Acme Marketing</p>
              <p className="mt-1 text-lg font-extrabold tabular-nums">$3,500</p>
              <div className="mt-2 flex justify-end"><span className="rounded-md border border-neutral-200 px-2 py-0.5 text-[10px] text-neutral-500 dark:border-neutral-700">View quote</span></div>
            </div>
            <div className="dis-slide ml-0 rounded-2xl border border-neutral-200 bg-white p-4 shadow-lg shadow-emerald-900/5 sm:ml-6 dark:border-neutral-800 dark:bg-neutral-900" style={{ animationDelay: ".7s" }}>
              <div className="flex items-start justify-between"><span className="flex items-center gap-2 text-[12px] font-semibold"><Signature className="h-4 w-4 text-emerald-600" />Agreement</span><span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">Signed</span></div>
              <svg viewBox="0 0 160 40" className="mt-2 h-10 w-40 text-neutral-800 dark:text-neutral-200" fill="none">
                <path className="dis-sign" d="M6 30C14 8 20 6 22 14S18 34 26 30 38 10 44 16 40 32 52 26 66 12 72 20 78 30 90 24 108 14 118 20 130 26 152 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="dis-slide rounded-2xl border border-neutral-200 bg-white p-4 shadow-lg shadow-emerald-900/5 dark:border-neutral-800 dark:bg-neutral-900" style={{ animationDelay: "1s" }}>
              <div className="flex items-start justify-between"><span className="flex items-center gap-2 text-[12px] font-semibold"><ReceiptText className="h-4 w-4 text-emerald-600" />Invoice #INV-001</span><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">● Paid</span></div>
              <p className="mt-1 text-[11px] text-neutral-500">Acme Marketing</p>
              <p className="mt-1 text-lg font-extrabold tabular-nums">$3,500</p>
              <div className="mt-2 flex justify-end"><span className="rounded-md border border-neutral-200 px-2 py-0.5 text-[10px] text-neutral-500 dark:border-neutral-700">View invoice</span></div>
            </div>
            <p className="text-right text-[11px] text-neutral-400">Example data.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── One workspace instead of many tools ─────────────────────────────────────────────── */

/** The jobs people stitch together with separate apps, named generically (no logos, no claim about other products). */
const SCATTERED = [
  { label: "Spreadsheets", x: "18%", y: "8%" }, { label: "Docs", x: "54%", y: "0%" }, { label: "E-sign app", x: "4%", y: "38%" },
  { label: "Task board", x: "40%", y: "40%" }, { label: "Invoice app", x: "70%", y: "30%" }, { label: "Notes", x: "12%", y: "72%" },
  { label: "Reminders", x: "52%", y: "74%" },
];

export function OneWorkspaceSection() {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">Clients shouldn't take <span className={GREEN}>7 different apps.</span></h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">No more copying the same client between spreadsheets, docs, e-sign tools and invoice apps. DealInSec keeps the whole client journey in one place.</p>
        </Reveal>
        <div className="mt-12 grid items-center gap-10 md:grid-cols-[1fr_auto_1fr]">
          <div aria-hidden="true" className="relative mx-auto h-60 w-full max-w-md">
            <Scribble className="-left-2 -top-10 -rotate-12" arrow="down-right">Too many tools</Scribble>
            {SCATTERED.map((t, i) => (
              <span key={t.label} className="dis-float absolute rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-neutral-700 shadow-md dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                style={{ left: t.x, top: t.y, animationDelay: `${i * 0.45}s`, rotate: `${((i % 3) - 1) * 2}deg` }}>
                {t.label}
              </span>
            ))}
            <Scribble className="-bottom-16 left-[30%] hidden rotate-[-4deg] sm:flex" arrow="up">So much time wasted</Scribble>
          </div>
          <ArrowRight aria-hidden="true" className="dis-nudge mx-auto h-9 w-9 rotate-90 text-neutral-400 md:rotate-0" />
          <Reveal className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-[0_24px_60px_-28px_rgba(6,78,59,0.35)] sm:p-8 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex flex-col items-center gap-6 sm:flex-row">
              <div className="flex flex-col items-center">
                <DealinsecMark size={86} className="drop-shadow-[0_10px_18px_rgba(6,95,70,0.25)]" />
                <DealinsecWordmark size={22} className="mt-2" />
              </div>
              <div>
                <p className="mb-2 text-lg font-extrabold">One workspace</p>
                <ul className="space-y-2 text-sm">
                  {["Prospects to payment in one place", "A simple, connected workflow", "Built for small agencies and consultants", "Less admin, more client work"].map((t) => (
                    <li key={t} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ── Who it's for ────────────────────────────────────────────────────────────────────── */

const AUDIENCES = [
  { Icon: Users, title: "Marketing, SEO & growth agencies", text: "Research prospects with evidence, then quote, sign and bill retainers in one place.", href: null },
  { Icon: Building2, title: "AI automation, web & software studios", text: "Scope builds as milestones, get the agreement signed online, and invoice each stage.", href: null },
  { Icon: UserRound, title: "Consultants & specialist services", text: "Independent B2B consultants, content and lead-generation agencies. Freelancers work the same way.", href: "/for-freelancers" },
];

export function AudienceCards() {
  return (
    <section id="audiences" className="scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">Built for small B2B service businesses</h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">Founder-led agencies and consultants of about 1 to 10 people, in the United States, India and beyond.</p>
        </Reveal>
        <motion.ul initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} variants={stagger} className="mt-10 grid gap-4 md:grid-cols-3">
          {AUDIENCES.map(({ Icon, title, text, href }) => (
            <motion.li key={title} variants={reveal} className="group rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-900/60">
              <Icon className="h-7 w-7 text-emerald-600" strokeWidth={1.8} />
              <h3 className="mt-4 text-lg font-bold">{title}</h3>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{text}</p>
              {href && <Link href={href} className="mt-3 inline-flex items-center text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-300">DealInSec for freelancers<ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>}
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}

/* ── Know where your business stands ─────────────────────────────────────────────────── */

function CountUp({ to, prefix = "", run }: { to: number; prefix?: string; run: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setN(to); return; }
    const start = performance.now(), ms = 1100;
    let raf = 0;
    const tick = (t: number) => { const p = Math.min(1, (t - start) / ms); setN(Math.round(to * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const done = setTimeout(() => setN(to), ms + 200); // lands on the number even where frames don't run
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, [run, to]);
  return <>{prefix}{n.toLocaleString("en-US")}</>;
}

export function OverviewSection() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-100px" });
  const stats = [
    { label: "New deals", to: 12, prefix: "", delta: "+20%" },
    { label: "Total value", to: 18500, prefix: "$", delta: "+32%" },
    { label: "Paid invoices", to: 9200, prefix: "$", delta: "+10%" },
  ];
  const activity = [
    { Icon: Signature, text: "Acme Marketing signed the agreement", when: "2h ago" },
    { Icon: ReceiptText, text: "Invoice #INV-001 paid · $3,500", when: "5h ago" },
    { Icon: Users, text: "New deal from Pixel Studio", when: "1d ago" },
    { Icon: FileText, text: "Quote #Q-002 sent", when: "1d ago" },
  ];
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div ref={ref} aria-hidden="true" className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-[0_24px_60px_-28px_rgba(6,78,59,0.35)] sm:p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-sm font-bold">This month</p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-2.5 sm:p-3 dark:border-neutral-800 dark:bg-neutral-800/40">
                <p className="text-[10px] text-neutral-500 sm:text-[11px]">{s.label}</p>
                <p className="mt-1 text-lg font-extrabold tabular-nums sm:text-2xl"><CountUp to={s.to} prefix={s.prefix} run={seen} /></p>
                <p className="mt-0.5 text-[10px] font-semibold text-emerald-600 sm:text-[11px]">↑ {s.delta}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-sm font-bold">Recent activity</p>
          <motion.ul initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
            {activity.map(({ Icon, text, when }) => (
              <motion.li key={text} variants={reveal} className="flex items-center gap-3 py-2.5 text-[13px]">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15"><Icon className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1 truncate">{text}</span>
                <span className="text-[11px] text-neutral-400">{when}</span>
              </motion.li>
            ))}
          </motion.ul>
          <p className="mt-2 text-right text-[11px] text-neutral-400">Example data.</p>
        </div>
        <Reveal>
          <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Stay in control</p>
          <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-[-0.025em] sm:text-[2.6rem]">Know exactly where your business stands.</h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">A clear view of your deals, what they're worth and what's been paid, with a list of what needs you today.</p>
          <ul className="mt-6 space-y-3">
            {["Track your pipeline and its value", "See which invoices are paid, due or overdue", "A daily list of what needs your attention", "Follow-up reminders, so nothing slips"].map((t) => (
              <li key={t} className="flex items-center gap-2.5 text-[15px]"><CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />{t}</li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Closing call to action ──────────────────────────────────────────────────────────── */

export function CtaBanner({ isAuthenticated, onPrimary }: { isAuthenticated: boolean; onPrimary: () => void }) {
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-800 px-6 py-12 text-center text-white sm:px-12 sm:py-16">
          <span aria-hidden="true" className="dis-orb absolute -left-16 -top-16 h-64 w-64 rounded-full bg-emerald-400/30 blur-3xl" />
          <span aria-hidden="true" className="dis-orb absolute -bottom-20 -right-10 h-72 w-72 rounded-full bg-teal-300/25 blur-3xl" style={{ animationDelay: "2s" }} />
          <div className="relative">
            <h2 className="text-3xl font-extrabold leading-tight tracking-[-0.025em] sm:text-5xl">Find your next client.<br />Get paid for the last one.</h2>
            <p className="mx-auto mt-4 max-w-xl text-emerald-50/90">Start free with prospects, your pipeline and quotations. Agreements, invoices and payment tracking are in the 7-day Pro trial.</p>
            <button type="button" onClick={onPrimary} data-testid="button-final-cta"
              className="group mt-7 inline-flex h-12 items-center rounded-lg bg-white px-6 text-sm font-semibold text-emerald-800 shadow-xl transition hover:bg-emerald-50">
              {isAuthenticated ? "Go to dashboard" : "Start for free"}<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <p className="mt-4 text-xs text-emerald-50/75">No credit card required · Free plan: 4 deals a month</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── FAQ (the single source: shared/landing-faqs.ts, also the crawler's FAQPage) ─────── */

export function FaqSection() {
  const half = Math.ceil(LANDING_FAQS.length / 2);
  const cols = [LANDING_FAQS.slice(0, half), LANDING_FAQS.slice(half)];
  return (
    <section id="faq" className="scroll-mt-20 py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="text-2xl font-extrabold tracking-[-0.02em] sm:text-3xl">Frequently asked questions</h2>
          <p className="mt-1 text-sm text-neutral-500">Straight answers about what DealInSec does, and what it doesn't.</p>
        </Reveal>
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr_0.75fr]">
          {cols.map((items, c) => (
            <Accordion key={c} type="single" collapsible className="space-y-2.5">
              {items.map((f, i) => (
                <AccordionItem key={f.q} value={`faq-${c}-${i}`} className="rounded-xl border border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900/50">
                  <AccordionTrigger className="py-3.5 text-left text-[13.5px] font-semibold hover:no-underline">{f.q}</AccordionTrigger>
                  <AccordionContent className="pb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ))}
          <div className="h-fit rounded-2xl border border-emerald-100 bg-emerald-50/60 p-6 text-center dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <LifeBuoy className="mx-auto h-7 w-7 text-emerald-600" />
            <p className="mt-3 font-bold">Still have questions?</p>
            <p className="text-sm text-neutral-500">We're here to help.</p>
            <a href="mailto:support@dealinsec.com" className="mt-4 inline-flex h-10 items-center rounded-lg border border-neutral-200 bg-white px-4 text-sm font-semibold shadow-sm hover:border-emerald-300 dark:border-neutral-700 dark:bg-neutral-900">
              <Sparkles className="mr-1.5 h-4 w-4 text-emerald-600" />Contact support
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

