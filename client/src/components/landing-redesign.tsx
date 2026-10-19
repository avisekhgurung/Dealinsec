/**
 * The homepage sections ("Find clients. Win deals. Get paid."): the hero, how it works (the five workflow stages on
 * one example client), what it does by outcome, why keep the journey in one place, who it's for, the closing call to
 * action and the FAQ. landing.tsx composes them with the header, demo, pricing and footer.
 *
 * Honesty rules (see the landing notes): pictures of the product use example data and say so; nothing claims payment
 * processing (DealInSec tracks payments), sending email for you, customer counts or logos; other companies' products
 * are named generically, never by logo. Scroll-in reveals use framer; continuous motion is CSS, and everything holds
 * still for people who prefer reduced motion.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import {
  ArrowRight, Building2, Check, CheckCircle2, FileSignature, FileText, LayoutDashboard, LifeBuoy,
  Handshake, PlayCircle, ReceiptText, Search, ShieldCheck, Signature, Sparkles, UserRound, Users,
  Bot, Flame, Lightbulb, Link2, Radar, X,
} from "lucide-react";
import { PRICING } from "@shared/product-facts";
import { OUTBOUND_ALLOWANCE_DEFAULTS, OUTBOUND_WINDOW_DAYS } from "@shared/outbound-plans";
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

/** Example prospects, drawn the way AI Outbound's prospect cards show them (components/outbound/prospect-card.tsx). */
const PROSPECTS = [
  { name: "Northwind Logistics", meta: "Pune · Freight & warehousing · 60 people", score: 82, label: "Ready", tone: "emerald", strong: true, why: "Hiring · 2 Oct", line: "3 customer-support roles" },
  { name: "Bluepeak Freight", meta: "Mumbai · Logistics · 120 people", score: 74, label: "Qualified", tone: "sky", strong: false, why: "New location · Sep 2026", line: "Opened a Nashik hub" },
  { name: "Clearwater Cargo", meta: "Pune · Logistics · 25 people", score: 52, label: "Partial", tone: "amber", strong: false, why: null, line: null },
] as const;
const TONE: Record<string, string> = {
  sky: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};
const scoreTone = (n: number) => (n >= 70
  ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
  : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300");

/** The product, drawn: AI Outbound's prospects with example data, and an interested reply becoming a deal. */
function HeroProduct() {
  const side = [
    { Icon: LayoutDashboard, label: "Dashboard" }, { Icon: Search, label: "AI Outbound", active: true }, { Icon: Users, label: "Leads" },
    { Icon: Building2, label: "Deals" }, { Icon: FileText, label: "Quotes" }, { Icon: FileSignature, label: "Agreements" }, { Icon: ReceiptText, label: "Invoices" },
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
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-[15px] font-bold">Prospects</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white"><Sparkles className="h-3 w-3" />New search</span>
            </div>
            <p className="mb-3 truncate rounded-lg border border-neutral-100 bg-neutral-50 px-2.5 py-1.5 text-[10.5px] text-neutral-600 dark:border-neutral-800 dark:bg-neutral-800/40 dark:text-neutral-300">
              <Search className="mr-1 inline h-3 w-3" />Logistics companies in Pune and Mumbai · 20–200 people
            </p>
            <ul className="space-y-2">
              {PROSPECTS.map((p, i) => (
                <li key={p.name} style={{ animationDelay: `${0.6 + i * 0.12}s` }} className="dis-row-in flex gap-2.5 rounded-xl border border-neutral-100 p-2.5 dark:border-neutral-800">
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-[13px] font-extrabold tabular-nums", scoreTone(p.score))}>{p.score}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <b className="truncate text-[12px]">{p.name}</b>
                      <span className="flex shrink-0 gap-1">
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", TONE[p.tone])}>{p.label}</span>
                        {p.strong && <span className="hidden rounded-full bg-orange-50 px-1.5 py-0.5 text-[9px] font-semibold text-orange-700 sm:inline dark:bg-orange-500/15 dark:text-orange-300">Strong timing</span>}
                      </span>
                    </span>
                    <span className="block truncate text-[10px] text-neutral-500">{p.meta}</span>
                    {p.why
                      ? <span className="mt-1 block truncate text-[10.5px]"><b className="text-orange-700 dark:text-orange-400">Why now · {p.why}</b> <span className="text-neutral-600 dark:text-neutral-300">{p.line}</span></span>
                      : <span className="mt-1 block truncate text-[10.5px] text-neutral-400">No dated reason to reach out yet</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 text-[10px] font-semibold">
              <span className="rounded-md border border-neutral-200 px-2 py-1 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">AI brief</span>
              <span className="rounded-md bg-emerald-600 px-2 py-1 text-white">Add to Leads</span>
            </div>
          </div>
        </div>
      </div>
      <div
        className="dis-invoice-in absolute -bottom-8 left-2 flex items-center gap-3 rounded-xl border border-neutral-200/80 bg-white px-3.5 py-2.5 shadow-xl sm:-left-6 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/15"><Handshake className="h-4 w-4 text-emerald-600" /></span>
        <span className="text-[11px] leading-tight"><b className="block text-[12px]">Interested reply 🎉</b><span className="text-neutral-500">Northwind Logistics → new deal</span></span>
      </div>
    </div>
  );
}

export function HeroSection({ isAuthenticated, onPrimary }: { isAuthenticated: boolean; onPrimary: () => void }) {
  return (
    <section className="relative overflow-hidden pb-20 pt-10 sm:pt-14 lg:pb-28 lg:pt-16">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1fr_1.12fr] lg:gap-10 lg:px-8">
        <div className="min-w-0 max-w-xl">
          <p style={{ animationDelay: "0.05s" }} className="dis-hero-in inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-white/80 px-3 py-1 text-[11.5px] font-semibold text-emerald-700 shadow-sm backdrop-blur dark:border-emerald-800/50 dark:bg-neutral-900/70 dark:text-emerald-300">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
            For freelancers and service providers in India
          </p>
          <h1 style={{ animationDelay: "0.13s" }} className="dis-hero-in mt-5 text-[2.75rem] font-extrabold leading-[1.02] tracking-[-0.035em] text-[#111B22] sm:text-6xl lg:text-[4.1rem] dark:text-white">
            Find clients.<br />Win <span className={GREEN}>deals.</span><br /><span className="dis-gradient-text">Get paid.</span>
          </h1>
          <p style={{ animationDelay: "0.21s" }} className="dis-hero-in mt-5 max-w-lg text-base leading-relaxed text-neutral-600 sm:text-lg dark:text-neutral-400">
            DealInSec is a simple business workspace for Indian freelancers and service providers. Track leads and deals, prepare quotations and agreements, create invoices and follow up on payments, with AI coworkers to help along the way.
          </p>
          <div style={{ animationDelay: "0.29s" }} className="dis-hero-in mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={() => { trackEvent("hero_cta_click", { label: isAuthenticated ? "dashboard" : "start_free" }); onPrimary(); }} data-testid="button-hero-cta"
              className="group inline-flex h-12 items-center justify-center whitespace-nowrap rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-6 text-[15px] font-semibold text-white shadow-lg shadow-emerald-600/25 transition hover:shadow-emerald-600/40">
              {isAuthenticated ? "Go to Home" : "Get started free"}<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <a href="#how" onClick={() => trackEvent("hero_cta_click", { label: "see_how" })} data-testid="link-hero-demo"
              className="inline-flex h-12 items-center justify-center whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-5 text-[15px] font-semibold shadow-sm transition hover:border-emerald-300 dark:border-neutral-700 dark:bg-neutral-900">
              <PlayCircle className="mr-2 h-5 w-5 text-emerald-600" />See how it works
            </a>
          </div>
          <p style={{ animationDelay: "0.33s" }} className="dis-hero-in mt-4 flex items-start gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-200" data-testid="hero-approval">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />AI coworkers research and draft; you approve every message and send it yourself. Nothing is sent automatically.
          </p>
          <ul style={{ animationDelay: "0.37s" }} className="dis-hero-in mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-neutral-500 dark:text-neutral-400">
            {["No credit card required", `Free: ${PRICING.freeMonthlyDeals} new deals a month with quotations`, `${OUTBOUND_ALLOWANCE_DEFAULTS.free.monthlySearches} AI research searches every ${OUTBOUND_WINDOW_DAYS} days`, `Pro ₹${PRICING.proMonthlyInr}/month in India`].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-600" />{t}</li>
            ))}
          </ul>
        </div>
        <div className="relative min-w-0 lg:pl-4">
          <HeroProduct />
          <p className="mt-12 text-center text-[11px] text-neutral-400">Illustration with example data.</p>
        </div>
      </div>
    </section>
  );
}

/* ── How it works: the real workflow on one example client ───────────────────────────── */

/**
 * The five stages DealInSec runs, walked through on ONE made-up client (labelled as a demonstration): research the
 * company (evidence vs inference kept apart, as the product keeps them), save and work the lead, create the deal and
 * its quotation, the agreement and its signature, the invoice and its payment. Example domains use the reserved
 * ".example" TLD so no real company is implied. Each stage names the plan it needs.
 */
const WALK = [
  { key: "research", label: "Research a potential client", plan: "Free" },
  { key: "lead", label: "Save the prospect and manage the lead", plan: "Free" },
  { key: "quote", label: "Create a deal and send a quotation", plan: "Free" },
  { key: "agreement", label: "Create an agreement and collect a signature", plan: "Pro" },
  { key: "invoice", label: "Generate an invoice and track payment", plan: "Pro" },
] as const;
type WalkKey = (typeof WALK)[number]["key"];

function Source({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-neutral-500"><Link2 className="h-3 w-3" aria-hidden />{children}</span>;
}
const box = "rounded-xl border border-neutral-200 p-3.5 dark:border-neutral-800";
const label = "text-[10px] font-bold uppercase tracking-wider";
const Row = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) => (
  <div className="flex items-center justify-between gap-3 py-1.5 text-sm"><span className="text-neutral-500">{k}</span><span className={cn("text-right font-semibold", tone)}>{v}</span></div>
);
const Pill = ({ children, tone = "emerald" }: { children: React.ReactNode; tone?: keyof typeof TONE }) => <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[tone])}>{children}</span>;

function WalkPanel({ step }: { step: WalkKey }) {
  switch (step) {
    case "research":
      return (
        <div className="space-y-3">
          <div className={box}>
            <p className={cn(label, "text-neutral-500")}>You describe who you want</p>
            <p className="mt-1 text-sm font-medium">Logistics companies in Pune and Mumbai with 20–200 people</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-300 bg-emerald-50 text-base font-extrabold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">82</span>
            <div className="min-w-0">
              <p className="font-bold">Northwind Logistics</p>
              <p className="text-xs text-neutral-500">northwind-logistics.example · Pune · about 60 people</p>
            </div>
          </div>
          <div className="rounded-xl bg-orange-50 p-3.5 dark:bg-orange-950/30">
            <p className={cn(label, "flex items-center gap-1.5 text-orange-700 dark:text-orange-400")}><Flame className="h-3 w-3" />Why now · Hiring · 2 Oct 2026</p>
            <p className="mt-1 text-sm">Hiring three customer-support executives for the Pune warehouse.</p>
            <Source>northwind-logistics.example/careers · stated on their site</Source>
          </div>
          <div className="rounded-xl border border-dashed border-neutral-300 p-3.5 dark:border-neutral-700">
            <p className={cn(label, "flex items-center gap-1.5 text-neutral-500")}><Lightbulb className="h-3 w-3" />Possible opportunity · inference</p>
            <p className="mt-1 text-sm">A growing support team may handle repetitive status questions that could be partly automated.</p>
          </div>
        </div>
      );
    case "lead":
      return (
        <div className="space-y-3">
          <div className={box}>
            <div className="flex items-center justify-between gap-2"><b>Northwind Logistics</b><Pill tone="sky">Replied</Pill></div>
            <Row k="Next step" v="Send a proposal · due Fri" />
            <Row k="Facts" v="3 facts, each with its source" />
            <Row k="Contact" v="Founder, named on their site" />
          </div>
          <div className={box}>
            <p className={cn(label, "text-emerald-700 dark:text-emerald-400")}>First message · approved by you</p>
            <p className="mt-1 text-sm">Drafted by AI from the verified facts, edited and approved by you, then sent from your own email and marked sent. A follow-up task was added.</p>
          </div>
          <p className="text-xs text-neutral-500">Stages: new → researching → qualified → contacted → replied → meeting → proposal → won or lost.</p>
        </div>
      );
    case "quote":
      return (
        <div className="space-y-3">
          <div className={box}>
            <p className={cn(label, "text-neutral-500")}>Deal</p>
            <Row k="Engagement" v="Fixed-price project" />
            <Row k="Service" v="AI automation · support assistant" />
            <Row k="Value" v="₹85,000 · 4 weeks" />
          </div>
          <div className={box}>
            <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-emerald-600" />Quotation · version 1</span><Pill>Accepted online</Pill></div>
            <p className="mt-1.5 text-xs text-neutral-500">Generated from the deal and shared as a link the client opened and accepted. Print or PDF anytime.</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
            <b className="text-amber-800 dark:text-amber-300">Protection Check:</b> no advance agreed yet. Ask for one before work starts.
          </div>
        </div>
      );
    case "agreement":
      return (
        <div className="space-y-3">
          <div className={box}>
            <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold"><Signature className="h-4 w-4 text-emerald-600" />Agreement</span><Pill>Signed</Pill></div>
            <ul className="mt-2 space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
              <li>· Scope and fee carried over from the deal</li>
              <li>· 50% advance, balance within 7 days of delivery</li>
              <li>· Two rounds of revisions</li>
            </ul>
          </div>
          <div className={box}>
            <p className={cn(label, "text-neutral-500")}>Audit record</p>
            <p className="mt-1 text-sm">Signed online through a signing link, with who signed and when recorded.</p>
          </div>
          <p className="text-xs text-neutral-500">Electronic acceptance with an audit record. It isn&apos;t a certified digital signature, and DealInSec gives no legal advice.</p>
        </div>
      );
    case "invoice":
      return (
        <div className="space-y-3">
          <div className={box}>
            <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold"><ReceiptText className="h-4 w-4 text-emerald-600" />Advance invoice · 50%</span><Pill>Paid</Pill></div>
            <Row k="Amount" v="₹42,500" />
          </div>
          <div className={box}>
            <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold"><ReceiptText className="h-4 w-4 text-emerald-600" />Final invoice · 50%</span><Pill tone="amber">Pending</Pill></div>
            <Row k="Amount" v="₹42,500" />
          </div>
          <p className="text-xs text-neutral-500">Invoices come from the agreement and can't exceed it. You mark them paid; DealInSec records payments and never collects or moves your client&apos;s money.</p>
        </div>
      );
  }
}

/** The product's workflow near the top of the page: what each stage produces, on one example client. */
export function WorkflowWalkthrough() {
  const [step, setStep] = useState<WalkKey>("research");
  const choose = (k: WalkKey) => { setStep(k); trackEvent("landing_walkthrough_step", { step: k }); };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const next = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const k = WALK[(next + WALK.length) % WALK.length].key;
    choose(k);
    document.getElementById(`walk-tab-${k}`)?.focus();
  };
  return (
    <section id="how" className="scroll-mt-20 bg-gradient-to-b from-emerald-50/50 to-transparent py-16 sm:py-20 dark:from-emerald-950/20" data-testid="landing-walkthrough">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-400">How it works</p>
          <h2 className="mt-2 text-balance text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">From a potential client to a paid invoice</h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">One example client through every stage. Each stage carries the details forward, so nothing is typed twice.</p>
        </Reveal>

        <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div role="tablist" aria-label="Workflow stages" aria-orientation="vertical" className="flex flex-col gap-1.5">
            {WALK.map(({ key, label: text, plan }, i) => {
              const on = key === step;
              return (
                <button key={key} id={`walk-tab-${key}`} type="button" role="tab" aria-selected={on} aria-controls="walk-panel" tabIndex={on ? 0 : -1}
                  onClick={() => choose(key)} onKeyDown={(e) => onKey(e, i)} data-testid={`walk-step-${key}`}
                  className={cn("flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                    on ? "border-emerald-400 bg-white shadow-sm dark:border-emerald-700 dark:bg-neutral-900" : "border-transparent text-neutral-600 hover:bg-white/70 dark:text-neutral-400 dark:hover:bg-neutral-900/50")}>
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", on ? "bg-emerald-600 text-white" : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300")}>{i + 1}</span>
                  <span className="flex-1">{text}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", plan === "Free" ? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300")}>{plan}</span>
                </button>
              );
            })}
          </div>
          <div id="walk-panel" role="tabpanel" aria-labelledby={`walk-tab-${step}`} className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-5 shadow-lg shadow-emerald-900/5 sm:p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <WalkPanel step={step} />
            <p className="mt-5 border-t border-neutral-100 pt-3 text-[11px] text-neutral-400 dark:border-neutral-800">Demonstration with example data. Research results depend on what each company publishes.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── What it does, by outcome ──────────────────────────────────────────────────────────── */

const OUTCOMES: { Icon: typeof Radar; title: string; plan: string; text: string; points: string[] }[] = [
  {
    Icon: Radar, title: "Find opportunities", plan: "Free and Pro, with limits",
    text: "Describe the clients you want and where. AI Outbound searches the web, or lists local businesses in a city from Google Maps, and checks each company's own website against your profile.",
    points: ["Companies in any country, or local businesses in your city", "A score and the reasons for it", "Dated signals with their sources; guesses labelled", "First messages drafted from verified facts, approved by you"],
  },
  {
    Icon: Users, title: "Manage leads and deals", plan: "Free and Pro",
    text: "Save a researched prospect as a lead, work it through stages, and turn a yes into a deal.",
    points: ["Stages, next steps and follow-up dates", "Deals by engagement model: retainer, fixed price, hourly, milestones and more", "A dashboard of what needs you today"],
  },
  {
    Icon: FileText, title: "Send clear quotations", plan: "Free and Pro",
    text: "Generate a professional quotation from the deal and share a link your client can open and accept online.",
    points: ["Versioned when the scope changes", "Print or PDF", "Protection Check flags missing terms before you send"],
  },
  {
    Icon: Signature, title: "Prepare agreements", plan: "Pro",
    text: "Create the agreement from the deal with your terms, and send a link your client signs online.",
    points: ["Standard and custom terms", "An audit record of who signed and when", "Or upload a signed paper copy"],
  },
  {
    Icon: ReceiptText, title: "Invoices and payment follow-ups", plan: "Pro",
    text: "Generate invoices from the agreement, single or split into an advance and a final payment, and track each to paid.",
    points: ["Paid, pending and overdue at a glance", "Payment reminders drafted for late invoices; you send them", "Your business and tax details printed"],
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">One workspace for the <span className={GREEN}>client journey</span></h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">Find opportunities, manage deals, prepare quotations and agreements, then create invoices and follow up on payments. AI coworkers help with research and drafts; you approve everything that reaches a client.</p>
        </Reveal>
        <motion.ul initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} variants={stagger} className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {OUTCOMES.map(({ Icon, title, plan, text, points }) => (
            <motion.li key={title} variants={reveal} className="flex flex-col rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60">
              <div className="flex items-center justify-between gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"><Icon className="h-5 w-5" aria-hidden /></span>
                <span className="text-[11px] font-semibold text-neutral-500">{plan}</span>
              </div>
              <h3 className="mt-3 text-[17px] font-bold">{title}</h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{text}</p>
              <ul className="mt-3 space-y-1.5 text-[13px] text-neutral-600 dark:text-neutral-400">
                {points.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />{p}</li>)}
              </ul>
            </motion.li>
          ))}
          <motion.li variants={reveal} className="flex flex-col justify-center rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-50 to-white p-5 dark:border-emerald-800 dark:from-emerald-950/40 dark:to-neutral-900">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white"><Handshake className="h-5 w-5" aria-hidden /></span>
            <h3 className="mt-3 text-[17px] font-bold">One connected client record</h3>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">The prospect becomes the lead, the lead the deal, and every quotation, agreement and invoice comes from that deal, so the scope and the numbers always match.</p>
          </motion.li>
        </motion.ul>
      </div>
    </section>
  );
}

/* ── The AI team: Nibo, Mika and Zee ──────────────────────────────────────────────────────── */
// What each coworker really does (server/ai-league; the /ai-coworkers page says the same). Plain <img> with both sizes,
// lazy: the homepage doesn't load the app's AI League code for three pictures.
const TEAM = [
  {
    key: "nibo", name: "Nibo", role: "Opportunity Scout", does: "finds and researches potential clients", bar: "bg-blue-600", tint: "bg-blue-50 dark:bg-blue-950/40", fg: "text-blue-700 dark:text-blue-300",
    line: "Find and research potential clients for your services. Describe who you want to work with; Nibo searches, reads each company's own website and saves the ones that fit.",
    points: ["Evidence and the source page for every company", "Only qualified companies reach your leads", "Asks before it uses one of your searches"],
  },
  {
    key: "mika", name: "Mika", role: "Deal Closer", does: "drafts outreach and follow-ups", bar: "bg-rose-600", tint: "bg-rose-50 dark:bg-rose-950/40", fg: "text-rose-700 dark:text-rose-300",
    line: "Prepare personalised outreach and follow-ups. Mika drafts a short, specific first email for each lead from what was verified about them.",
    points: ["Drafts only: nothing is sent for you", "You edit and approve the exact text", "Skips anyone on your do-not-contact list"],
  },
  {
    key: "zee", name: "Zee", role: "Business Guardian", does: "shows what needs your attention", bar: "bg-emerald-600", tint: "bg-emerald-50 dark:bg-emerald-950/40", fg: "text-emerald-700 dark:text-emerald-300",
    line: "See what needs attention across your deals, follow-ups and payments. Zee reads your own invoices, deals and follow-ups and tells you what needs you today.",
    points: ["Overdue invoices and what's due this week", "Follow-ups due and messages waiting", "Never invents a number: checked against your records"],
  },
] as const;

export function AiTeamSection() {
  return (
    <section id="ai-team" className="scroll-mt-20 py-16 sm:py-20" data-testid="landing-ai-team">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"><Bot className="h-3.5 w-3.5" aria-hidden />AI coworkers</span>
          <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">Meet Nibo, Mika and Zee, <span className={GREEN}>your AI coworkers</span></h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">Three AI coworkers help with the legwork in the background: Nibo researches potential clients, Mika drafts outreach and Zee shows what needs your attention. They keep working when you close the page, and they ask before anything that matters. AI results may be incomplete or inaccurate, so check important details before contacting a client.</p>
        </Reveal>
        <motion.ul initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} variants={stagger} className="mt-10 grid gap-4 md:grid-cols-3">
          {TEAM.map((m) => (
            <motion.li key={m.key} variants={reveal} className="relative flex flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60" data-testid={`landing-ai-${m.key}`}>
              <span className={cn("absolute inset-x-0 top-0 h-1", m.bar)} aria-hidden />
              <div className="flex items-center gap-4">
                <span className={cn("flex h-24 w-24 shrink-0 items-center justify-center rounded-full", m.tint)}>
                  <img src={`/ai-league/${m.key}-mascot.webp`} srcSet={`/ai-league/${m.key}-mascot-sm.webp 192w, /ai-league/${m.key}-mascot.webp 512w`} sizes="88px"
                    width={88} height={88} loading="lazy" decoding="async" alt={`${m.name}, the DealInSec AI coworker who ${m.does}`} className="h-[88px] w-[88px] object-contain" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-xl font-extrabold">{m.name}</h3>
                  <p className={cn("text-sm font-semibold", m.fg)}>{m.role}</p>
                </div>
              </div>
              <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">{m.line}</p>
              <ul className="mt-3 space-y-1.5 text-[13px] text-neutral-600 dark:text-neutral-400">
                {m.points.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />{p}</li>)}
              </ul>
            </motion.li>
          ))}
        </motion.ul>
        <Reveal className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="flex gap-3 rounded-2xl border border-neutral-200/80 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/60">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"><Sparkles className="h-5 w-5" aria-hidden /></span>
            <div>
              <h3 className="font-bold">Agent mode: just ask</h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">"Which invoices are overdue?" "Make a deal from this client email." Ask DealInSec in plain words; it works through your records and asks you to approve every change.</p>
            </div>
          </div>
          <div className="flex gap-3 rounded-2xl border border-neutral-200/80 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/60">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"><Users className="h-5 w-5" aria-hidden /></span>
            <div>
              <h3 className="font-bold">A team that talks it over</h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Coworkers ask each other for help and hold a short team huddle on your question. Handing work from one to another always asks you first.</p>
            </div>
          </div>
        </Reveal>
        <p className="mt-6 text-center text-sm">
          <a href="/ai-coworkers" onClick={() => trackEvent("landing_cta_click", { label: "ai_coworkers" })} className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline dark:text-emerald-400" data-testid="landing-ai-team-more">
            How the AI coworkers work<ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </p>
      </div>
    </section>
  );
}

/* ── Why keep it together ──────────────────────────────────────────────────────────────── */

const SPREAD = [
  "Prospects in browser tabs and a spreadsheet",
  "Outreach and replies scattered across your inbox",
  "Quotations and agreements in separate documents",
  "Invoices in another tool, payments in your bank app",
  "Re-typing the client, the scope and the fee at every step",
];
const TOGETHER = [
  "Researched prospects saved straight into your lead pipeline",
  "Each lead's facts, sources, next steps and follow-ups in one place",
  "Quotation, agreement and invoices generated from the same deal",
  "What's paid, pending and overdue on one dashboard",
  "AI drafts; you approve everything that reaches a client",
];

export function ManualWorkflowSection() {
  return (
    <section className="py-16 sm:py-20" data-testid="landing-manual-vs">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">Why keep the client journey <span className={GREEN}>in one place</span></h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">When each step lives in a different tool, details get re-typed, follow-ups slip and nobody is sure what was agreed or paid.</p>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Reveal className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-6 dark:border-neutral-800 dark:bg-neutral-900/40">
            <h3 className="font-bold text-neutral-700 dark:text-neutral-300">Spread across tools</h3>
            <ul className="mt-4 space-y-2.5 text-sm text-neutral-600 dark:text-neutral-400">
              {SPREAD.map((t) => <li key={t} className="flex gap-2"><X className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" aria-hidden />{t}</li>)}
            </ul>
          </Reveal>
          <Reveal delay={0.08} className="rounded-2xl border border-emerald-300 bg-white p-6 shadow-sm dark:border-emerald-800 dark:bg-neutral-900">
            <h3 className="font-bold text-emerald-800 dark:text-emerald-300">In DealInSec</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {TOGETHER.map((t) => <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />{t}</li>)}
            </ul>
          </Reveal>
        </div>
        <p className="mx-auto mt-5 max-w-2xl text-center text-xs text-neutral-500">DealInSec doesn&apos;t replace your accounting software, and it doesn&apos;t guarantee clients or replies: it keeps the work of winning and billing a client together.</p>
      </div>
    </section>
  );
}

/* ── Who it's for ────────────────────────────────────────────────────────────────────── */

const AUDIENCES = [
  { Icon: Building2, title: "Freelance web developers", text: "Research businesses in your city or niche, quote a build as milestones and invoice each stage.", href: "/for-freelancers" },
  { Icon: Sparkles, title: "Designers and creatives", text: "Spell out deliverables and revision rounds in the quotation, get the agreement signed, then invoice.", href: "/for-freelancers" },
  { Icon: Users, title: "Digital marketers and SEO consultants", text: "Find companies in your niche with evidence, then quote, sign and bill monthly retainers.", href: "/for-freelancers" },
  { Icon: UserRound, title: "Independent consultants", text: "Turn a conversation into a deal, send a professional quotation and keep track of what you're owed.", href: "/for-freelancers" },
];

export function AudienceCards() {
  return (
    <section id="audiences" className="scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">Built for people who sell services</h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">Freelancers and solo service providers first, and small agencies of up to about 10 people: web development, digital marketing, SEO, AI automation and other service businesses.</p>
        </Reveal>
        <motion.ul initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} variants={stagger} className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AUDIENCES.map(({ Icon, title, text, href }) => (
            <motion.li key={title} variants={reveal} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60">
              <Icon className="h-6 w-6 text-emerald-600" strokeWidth={1.8} aria-hidden />
              <h3 className="mt-3 font-bold">{title}</h3>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{text}</p>
              {href && <Link href={href} className="mt-3 inline-flex items-center text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-300">How freelancers use it<ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>}
            </motion.li>
          ))}
        </motion.ul>
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
            <p className="mx-auto mt-4 max-w-xl text-emerald-50/90">Start free: research potential clients, save leads, create deals and send quotations. Upgrade when you need agreements, invoices and payment tracking.</p>
            <button type="button" onClick={onPrimary} data-testid="button-final-cta"
              className="group mt-7 inline-flex h-12 items-center rounded-lg bg-white px-6 text-sm font-semibold text-emerald-800 shadow-xl transition hover:bg-emerald-50">
              {isAuthenticated ? "Go to Home" : "Get started free"}<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <p className="mt-4 text-xs text-emerald-50/75">No credit card required · Free plan · Pro ₹{PRICING.proMonthlyInr}/month in India</p>
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

