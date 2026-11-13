/**
 * The homepage sections ("Find clients. Win deals. Get paid."): the hero (the product itself, with the three-step
 * journey under it), what DealInSec is (three pillars), how it works (four stages on one example client), the AI team,
 * what it does by outcome, the free Deal Suite, why keep the journey in one place, who it's for, the closing call to
 * action and the FAQ. landing.tsx composes them with the header, demo, pricing and footer.
 *
 * The hero shows the product, not the mascots: a visitor should read what it does (find clients, win deals, get paid)
 * before meeting Nibo, Mika and Zee, who have their own section. Copy that search and answer engines should carry is
 * repeated, in plain words, in server/landing-seo.ts.
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
  ArrowRight, Briefcase, Building2, Check, CheckCircle2, FileText, LifeBuoy,
  Handshake, PlayCircle, ReceiptText, ShieldCheck, Signature, Sparkles, UserRound, Users,
  Flame, Lightbulb, Link2, Radar, X, UsersRound, Lock, Wallet,
} from "lucide-react";
import { PRICING } from "@shared/product-facts";
import { OUTBOUND_ALLOWANCE_DEFAULTS, OUTBOUND_WINDOW_DAYS } from "@shared/outbound-plans";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DealinsecMark, DealinsecWordmark } from "@/components/dealinsec-logo";
import { trackEvent } from "@/lib/analytics";
import { onSectionLinkClick } from "@/components/landing-shared";
import { ProspectCard } from "@/components/outbound/prospect-card";
import type { ProspectCard as ProspectCardData } from "@/lib/outbound";
import { NEST_TEAM_IMAGE, plushSrc } from "@/lib/plush";
import { DEAL_SUITE_LABEL } from "@shared/nav-model";
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

/* ── Hero ─────────────────────────────────────────────────────────────────────────────── */

const TONE: Record<string, string> = {
  sky: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};
/**
 * The product itself, not a drawing: the app's own top bar (its real tab names, Radar open) above Client Radar's real
 * prospect card component (components/outbound/prospect-card.tsx), filled with example data on a ".example" domain, so
 * what visitors see here is what they get. Inert and hidden from assistive tech; the caption says it's example data.
 */
const HERO_PROSPECT: ProspectCardData = {
  id: 1, name: "Northwind Logistics", domain: "northwind-logistics.example", website: "https://northwind-logistics.example/",
  status: "researched", rejectReason: null, rejectLabel: null,
  score: { total: 82, knownMax: 100, unknownPoints: 6, confidence: "high", components: [], missing: [] },
  ready: true, classification: "ready", timing: "strong",
  fit: { verdict: "match", headline: "Fits your client profile", signals: [
    { key: "industry", label: "Industry", status: "match", detail: "Freight and warehousing, as you described" },
    { key: "size", label: "Size", status: "match", detail: "About 60 people, inside your 20–200 range" },
    { key: "place", label: "Location", status: "match", detail: "Based in Pune" },
  ] },
  profile: { industry: "Freight & warehousing", location: "Pune", country: "IN", employees: "60 people", serves: null },
  whyNow: { id: 1, kind: "signal", type: "hiring", label: "Hiring", value: "Hiring three customer-support executives for the Pune warehouse", status: "verified", source: "site", url: null, quote: null, observedAt: null, date: "2 Oct 2026" },
  opportunity: { id: 2, kind: "opportunity", type: "opportunity", label: "Opportunity", value: "A growing support team may handle repetitive status questions that could be partly automated.", status: "inferred", source: "ai", url: null, quote: null, observedAt: null },
  decisionMaker: { id: 3, kind: "decision_maker", type: "founder", label: "Founder", value: "R. Mehta · Founder", status: "verified", source: "site", url: null, quote: null, observedAt: null },
  evidenceCount: 5, leadId: null, researched: true, contact: "public",
};
// The app's real desktop tabs: finding clients is the whole bar.
const HERO_TABS = ["Home", "AI Team", "Radar", "Leads"] as const;
const noop = () => {};

/** The three things the product does, in the order they happen: the hero's strip and the "what it is" section agree. */
const JOURNEY = [
  { Icon: Radar, title: "Find clients", text: "Client Radar researches companies that fit, with evidence and a reason to reach out now." },
  { Icon: Handshake, title: "Win deals", text: "Outreach you approve and send, with every lead's facts, replies and follow-ups on one record." },
  { Icon: Wallet, title: "Get paid", text: "Quotation, agreement signed online, invoice and payment tracking: free on every plan." },
] as const;

function HeroProduct() {
  return (
    <div className="relative" aria-hidden="true">
      {/* The desktop app, in a browser window */}
      <div style={{ animationDelay: ".25s" }}
        className="dis-hero-in overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-[0_30px_80px_-30px_rgba(6,78,59,0.35)] dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-1.5 border-b border-neutral-200/80 bg-neutral-100 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-800/60">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
          <span className="mx-auto flex h-6 min-w-0 max-w-[60%] flex-1 items-center justify-center gap-1 truncate rounded-md bg-white px-3 text-[10.5px] text-neutral-500 dark:bg-neutral-900">
            <Lock className="h-2.5 w-2.5 shrink-0" />dealinsec.com/outbound
          </span>
          <span className="w-10" />
        </div>
        {/* The app's top bar, as it is */}
        <div className="dis-topnav flex h-11 items-center gap-1 overflow-hidden px-3 text-white">
          <span className="mr-2 flex shrink-0 items-center gap-1.5"><DealinsecMark size={18} /><DealinsecWordmark size={12} tone="inverse" className="hidden sm:inline" /></span>
          {HERO_TABS.map((t) => (
            <span key={t} className={cn("whitespace-nowrap rounded-full px-2 py-1 text-[10.5px] font-semibold", t === "Radar" ? "bg-white/15 text-white" : "text-white/70")}>{t}</span>
          ))}
        </div>
        {/* A window onto the page: the top of the screen, fading out at the bottom. */}
        <div className="pointer-events-none relative max-h-[330px] select-none space-y-3 overflow-hidden bg-neutral-50/60 p-4 sm:max-h-[380px] sm:p-5 dark:bg-neutral-950/40" {...{ inert: "" }}>
          <div>
            <p className="text-lg font-bold tracking-tight">Client Radar <span aria-hidden>🔎</span></p>
            <p className="text-xs text-neutral-500">Logistics companies in Pune and Mumbai · 20–200 people</p>
          </div>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-600 dark:text-neutral-400"><b className="text-neutral-900 dark:text-neutral-100">25</b> discovered<b className="text-neutral-900 dark:text-neutral-100">11</b> match your client profile<b className="text-neutral-900 dark:text-neutral-100">3</b> ready for outreach</p>
          <ProspectCard p={HERO_PROSPECT} onOpen={noop} onAdd={noop} adding={false} canEdit />
          <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent dark:from-neutral-900" />
        </div>
      </div>
      {/* The journey under the product: what the search leads to, in three steps. */}
      <ol style={{ animationDelay: ".5s" }} className="dis-hero-in mt-4 grid grid-cols-3 gap-2">
        {JOURNEY.map(({ Icon, title, text }, i) => (
          <li key={title} className="rounded-xl border border-neutral-200/80 bg-white/90 p-3 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">{i + 1}</span>
              <Icon className="h-3.5 w-3.5 shrink-0" />{title}
            </span>
            <p className="mt-1 hidden text-[11px] leading-snug text-neutral-500 sm:block">{text}</p>
          </li>
        ))}
      </ol>
      {/* The coworkers, small: they do the legwork, they are not the headline. */}
      <p style={{ animationDelay: ".65s" }} className="dis-hero-in mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
        <span className="font-semibold text-neutral-700 dark:text-neutral-200">Your AI team does the legwork:</span>
        {TEAM.map((m) => (
          <span key={m.key} className="inline-flex items-center gap-1">
            <img {...plushSrc(m.key)} sizes="20px" width={20} height={20} alt="" loading="eager" decoding="async" draggable={false} className="h-5 w-5 select-none rounded-full object-cover" />
            <b className={m.fg}>{m.name}</b> {m.verb}
          </span>
        ))}
      </p>
    </div>
  );
}

export function HeroSection({ isAuthenticated, onPrimary }: { isAuthenticated: boolean; onPrimary: () => void }) {
  return (
    <section className="relative overflow-hidden pb-16 pt-10 sm:pt-14 lg:pb-24 lg:pt-16">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10 lg:px-8">
        <div className="min-w-0 max-w-xl">
          <p style={{ animationDelay: "0.05s" }} className="dis-hero-in inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-white/80 px-3 py-1 text-[11.5px] font-semibold text-emerald-700 shadow-sm backdrop-blur dark:border-emerald-800/50 dark:bg-neutral-900/70 dark:text-emerald-300">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
            For freelancers and service providers in India
          </p>
          <h1 style={{ animationDelay: "0.13s" }} className="dis-hero-in mt-5 text-[clamp(2.1rem,3.6vw,3.6rem)] font-bold leading-[1.02] tracking-[-0.03em] text-[#111B22] dark:text-white">
            Find clients.<br />Win deals.<br /><span className="dis-gradient-text">Get paid.</span>
          </h1>
          <p style={{ animationDelay: "0.21s" }} className="dis-hero-in mt-5 max-w-[66ch] text-base font-normal leading-relaxed text-neutral-600 dark:text-neutral-400 sm:text-lg">
            DealInSec finds potential clients for Indian freelancers, consultants and small agencies, with evidence behind every name, drafts the outreach you approve, and turns each won deal into a quotation, a signed agreement and an invoice. You pay only for finding clients; deal to invoice is free on every plan.
          </p>
          <div style={{ animationDelay: "0.29s" }} className="dis-hero-in mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={() => { trackEvent("hero_cta_click", { label: isAuthenticated ? "dashboard" : "start_free" }); onPrimary(); }} data-testid="button-hero-cta"
              className="group inline-flex h-12 items-center justify-center whitespace-nowrap rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-6 text-md font-semibold text-white shadow-lg shadow-emerald-600/25 transition hover:shadow-emerald-600/40">
              {isAuthenticated ? "Go to Home" : "Get started free"}<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <a href="#how" onClick={(e) => { trackEvent("hero_cta_click", { label: "see_how" }); onSectionLinkClick(e); }} data-testid="link-hero-demo"
              className="inline-flex h-12 items-center justify-center whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-5 text-md font-semibold shadow-sm transition hover:border-emerald-300 dark:border-neutral-700 dark:bg-neutral-900">
              <PlayCircle className="mr-2 h-5 w-5 text-emerald-600" />See how it works
            </a>
          </div>
          <p style={{ animationDelay: "0.33s" }} className="dis-hero-in mt-4 flex items-start gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-200" data-testid="hero-approval">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />AI coworkers research and draft; you approve every message and send it yourself. Nothing is sent automatically.
          </p>
          <ul style={{ animationDelay: "0.37s" }} className="dis-hero-in mt-3 grid gap-x-5 gap-y-1.5 text-sm text-neutral-500 dark:text-neutral-400 sm:grid-cols-2">
            {["No credit card required", `Free: ${OUTBOUND_ALLOWANCE_DEFAULTS.free.monthlySearches} AI research searches every ${OUTBOUND_WINDOW_DAYS} days`, "Deal to invoice: free on every plan", `Pro ₹${PRICING.proMonthlyInr}/month in India`].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 shrink-0 text-emerald-600" />{t}</li>
            ))}
          </ul>
        </div>
        <div className="relative min-w-0 lg:pl-4">
          <HeroProduct />
          <p className="mt-3 text-left text-[11px] text-neutral-400">Real DealInSec screen (Client Radar), with example data.</p>
        </div>
      </div>
    </section>
  );
}

/* ── What DealInSec is: three pillars ───────────────────────────────────────────────────── */

const PILLARS = [
  {
    Icon: Radar, eyebrow: "Client Radar", title: "Find clients", plan: "Free and Pro", href: "#how",
    text: "Describe the clients you want and where. Client Radar searches the web, or lists local businesses in your city from Google Maps, checks each company's own website against your profile and gives you a dated reason to reach out, a named decision maker where one is published, and a score with its reasons.",
    points: ["Every fact with its source and date", "Guesses labelled as guesses", "Nobody contacted until you choose"],
  },
  {
    Icon: UsersRound, eyebrow: "AI Team", title: "Nibo, Mika and Zee do the legwork", plan: "Free and Pro", href: "#ai-team",
    text: "Three AI coworkers work in the background through the same features: Nibo researches and saves qualified companies, Mika drafts first messages and follow-ups from verified facts, Zee briefs you on what needs you today.",
    points: ["They ask before anything that matters", "You approve every message", "They never send, pay or sign"],
  },
  {
    Icon: ReceiptText, eyebrow: DEAL_SUITE_LABEL, title: "Win the deal and get paid", plan: "Free on every plan", href: "#deal-suite",
    text: "A won lead becomes a deal. From it: a quotation your client accepts online, the agreement they sign online, the invoice and payment tracking, all from the same record so the scope and figures always match.",
    points: ["No monthly cap, no card", "Protection Check before you send", "Your currency, PAN and GSTIN on documents"],
  },
] as const;

export function WhatIsSection() {
  return (
    <section id="what" className="scroll-mt-20 border-t border-neutral-200/70 py-16 sm:py-20 dark:border-neutral-800" data-testid="landing-what">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-400">What DealInSec is</p>
          <h2 className="mt-2 text-balance text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">Client-finding software for freelancers and small agencies in India</h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">One workspace that finds the client, wins the deal and gets you paid: AI research with evidence, outreach you approve, and the paperwork for free. Not a contact database, not a marketplace, and never a tool that sends on its own.</p>
        </Reveal>
        <motion.ol initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} variants={stagger} className="mt-10 grid gap-4 md:grid-cols-3">
          {PILLARS.map(({ Icon, eyebrow, title, plan, href, text, points }, i) => (
            <motion.li key={title} variants={reveal} className="relative flex flex-col rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60" data-testid={`landing-pillar-${i + 1}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white"><Icon className="h-5 w-5" aria-hidden /></span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", plan.startsWith("Free on") ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300")}>{plan}</span>
              </div>
              <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">{i + 1} · {eyebrow}</p>
              <h3 className="mt-1 text-xl font-extrabold tracking-tight">{title}</h3>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{text}</p>
              <ul className="mt-3 space-y-1.5 text-sm text-neutral-600 dark:text-neutral-400">
                {points.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />{p}</li>)}
              </ul>
              <a href={href} onClick={onSectionLinkClick} className="mt-4 inline-flex items-center text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-300">See how<ArrowRight className="ml-1 h-3.5 w-3.5" /></a>
            </motion.li>
          ))}
        </motion.ol>
      </div>
    </section>
  );
}

/* ── How it works: the real workflow on one example client ───────────────────────────── */

/**
 * The three stages DealInSec runs, walked through on ONE made-up client (labelled as a demonstration): research the
 * company (evidence vs inference kept apart, as the product keeps them), approve and send the first message, then
 * work the lead's replies and follow-ups. Example domains use the reserved ".example" TLD so no real company is
 * implied. Each stage names the plan it needs.
 */
const WALK = [
  { key: "research", label: "Describe who you want; AI researches", plan: "Free" },
  { key: "outreach", label: "Approve the first message and send it", plan: "Free" },
  { key: "lead", label: "Track replies, next steps and follow-ups", plan: "Free" },
  { key: "win", label: "Win the work: quotation, agreement, invoice", plan: "Free" },
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
    case "outreach":
      return (
        <div className="space-y-3">
          <div className={box}>
            <p className={cn(label, "text-rose-700 dark:text-rose-400")}>First message · drafted by Mika <span aria-hidden>💌</span></p>
            <p className="mt-1 text-sm">&ldquo;Hi, saw you&apos;re hiring three support executives for the Pune warehouse. We build support assistants that take the repetitive status questions off a growing team&hellip;&rdquo;</p>
            <Source>Every claim comes from a verified fact with its source</Source>
          </div>
          <div className={box}>
            <Row k="You approve" v="The exact text, edited by you" />
            <Row k="You send" v="From your own email" />
            <Row k="Follow-up" v={<>Task added · in 3 days</>} />
          </div>
          <p className="text-xs text-neutral-500">Nothing is sent automatically, and your do-not-contact list is checked before a draft even exists.</p>
        </div>
      );
    case "lead":
      return (
        <div className="space-y-3">
          <div className={box}>
            <div className="flex items-center justify-between gap-2"><b>Northwind Logistics</b><Pill tone="sky">Replied</Pill></div>
            <Row k="Next step" v="Book a call · due Fri" />
            <Row k="Facts" v="3 facts, each with its source" />
            <Row k="Contact" v="Founder, named on their site" />
          </div>
          <div className={box}>
            <p className={cn(label, "text-emerald-700 dark:text-emerald-400")}>Nothing slips</p>
            <p className="mt-1 text-sm">Each lead keeps its facts, messages, next step and follow-up date in one place, and the dashboard shows what needs you today.</p>
          </div>
          <p className="text-xs text-neutral-500">Stages: new → researching → qualified → contacted → replied → meeting → proposal → won or lost.</p>
        </div>
      );
    case "win":
      return (
        <div className="space-y-3">
          <div className={box}>
            <div className="flex items-center justify-between gap-2"><b>Northwind Logistics</b><Pill tone="emerald">Won → Deal</Pill></div>
            <Row k="Quotation" v={<>Accepted online · via the link</>} />
            <Row k="Agreement" v={<>Signed online · audit record</>} />
            <Row k="Invoices" v={<>Advance now · balance on delivery</>} />
            <Row k="Payment" v={<>Advance paid · balance pending</>} tone="text-emerald-700 dark:text-emerald-400" />
          </div>
          <div className="rounded-xl bg-emerald-50 p-3.5 dark:bg-emerald-950/30">
            <p className={cn(label, "flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400")}><ShieldCheck className="h-3 w-3" />Protection Check · before the quotation went out</p>
            <p className="mt-1 text-sm">Flagged “no advance” and “no revision limit” in the terms, with what to ask. Nothing changed until you said so.</p>
          </div>
          <p className="text-xs text-neutral-500">Deal to invoice is free on every plan, with no monthly cap. Your client pays you directly; DealInSec records it.</p>
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
          <h2 className="mt-2 text-balance text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">How to use it: from a search to a paid invoice</h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">One example prospect, from a search to a conversation to a paid invoice. Each stage carries the evidence forward, you approve everything that reaches the client, and every stage is on the free plan.</p>
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
    text: "Describe the clients you want and where. Client Radar searches the web, or lists local businesses in a city from Google Maps, and checks each company's own website against your profile.",
    points: ["Companies in any country, or local businesses in your city", "A score and the reasons for it", "Dated signals with their sources; guesses labelled", "First messages drafted from verified facts, approved by you"],
  },
  {
    Icon: Sparkles, title: "Outreach you approve", plan: "Free and Pro",
    text: "Mika drafts a personalised first message from the verified facts about each company. You edit and approve the exact text, send it from your own email, and follow-ups keep moving.",
    points: ["Drafts from evidence, never from guesses", "Nothing is sent automatically", "Follow-up tasks so nobody slips", "Your do-not-contact list is always respected"],
  },
  {
    Icon: Users, title: "A pipeline that remembers", plan: "Free and Pro",
    text: "Save a researched prospect as a lead and work it through stages, with every fact, message and next step on one record.",
    points: ["Stages, next steps and follow-up dates", "A dashboard of what needs you today", "Zee briefs you each day from your own records"],
  },
  {
    Icon: ReceiptText, title: "Deal to invoice, free", plan: "Free on every plan",
    text: "When you win the work, the paperwork follows from the same deal: a quotation your client accepts online, the agreement they sign online, the invoice and payment tracking.",
    points: ["No monthly cap, no card, on every plan", "Protection Check flags risky terms first", "Your currency, PAN and GSTIN on every document", "DealInSec records payments; it never handles your money"],
  },
  {
    Icon: Building2, title: "Local businesses in your city", plan: "Free and Pro",
    text: "Dentists in Siliguri, cafes in Pune, coaching institutes in Kota: list local businesses straight from Google Maps and research the ones you choose.",
    points: ["Address, phone and website when listed", "You pick which ones get researched", "Save a business straight to Leads"],
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">Why freelancers and agencies use it</h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">Research, outreach, follow-through and the paperwork in one place, with AI coworkers doing the legwork, and evidence, not guesswork, behind every company on your list.</p>
        </Reveal>
        <motion.ul initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} variants={stagger} className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {OUTCOMES.map(({ Icon, title, plan, text, points }) => (
            <motion.li key={title} variants={reveal} className="flex flex-col rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60">
              <div className="flex items-center justify-between gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"><Icon className="h-5 w-5" aria-hidden /></span>
                <span className="text-[11px] font-semibold text-neutral-500">{plan}</span>
              </div>
              <h3 className="mt-3 text-lg font-bold">{title}</h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{text}</p>
              <ul className="mt-3 space-y-1.5 text-sm text-neutral-600 dark:text-neutral-400">
                {points.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />{p}</li>)}
              </ul>
            </motion.li>
          ))}
          <motion.li variants={reveal} className="flex flex-col justify-center rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-50 to-white p-5 dark:border-emerald-800 dark:from-emerald-950/40 dark:to-neutral-900">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white"><Handshake className="h-5 w-5" aria-hidden /></span>
            <h3 className="mt-3 text-lg font-bold">One connected client record</h3>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">The prospect becomes the lead, and every fact, source, message and follow-up stays on that one record — so you always know where each conversation stands and why.</p>
          </motion.li>
        </motion.ul>
      </div>
    </section>
  );
}

/* ── The AI team: Nibo, Mika and Zee ──────────────────────────────────────────────────────── */
// What each coworker really does (server/ai-league; the /ai-coworkers page says the same). Plain <img> with both sizes,
// lazy: the homepage doesn't load the app's coworker code for these pictures (lib/plush.ts is dependency-free).
const TEAM = [
  {
    key: "nibo", name: "Nibo", role: "Deal Finder", emoji: "🔎", verb: "finds", does: "discovers and researches potential clients", bar: "bg-amber-700", tint: "bg-amber-50 dark:bg-amber-950/40", fg: "text-amber-800 dark:text-amber-300",
    line: "Discovers and researches potential clients for your services. Describe who you want to work with; Nibo searches, reads each company's own website and saves the ones that fit.",
    points: ["Evidence and the source page for every company", "Only qualified companies reach your leads", "Asks before it uses one of your searches"],
  },
  {
    key: "mika", name: "Mika", role: "Deal Closer", emoji: "💌", verb: "drafts", does: "drafts personalised outreach and follow-ups", bar: "bg-rose-600", tint: "bg-rose-50 dark:bg-rose-950/40", fg: "text-rose-700 dark:text-rose-300",
    line: "Drafts personalised outreach and follow-ups: a short, specific first email for each lead, from what was verified about them.",
    points: ["Drafts only: nothing is sent for you", "You edit and approve the exact text", "Skips anyone on your do-not-contact list"],
  },
  {
    key: "zee", name: "Zee", role: "Business Buddy", emoji: "🌱", verb: "briefs", does: "tells you which follow-ups are due and which messages are waiting", bar: "bg-emerald-600", tint: "bg-emerald-50 dark:bg-emerald-950/40", fg: "text-emerald-700 dark:text-emerald-300",
    line: "Keeps you on top of the hunt: a morning briefing from your own records, follow-up tasks due and messages waiting for you.",
    points: ["A briefing each day, from your own records", "Follow-ups due and messages waiting", "Never invents a number: checked against your records"],
  },
] as const;

export function AiTeamSection() {
  return (
    <section id="ai-team" className="scroll-mt-20 py-16 sm:py-20" data-testid="landing-ai-team">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">AI Team</span>
          <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">Meet Nibo, Mika and Zee, <span className={GREEN}>your AI team</span></h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">They live in AI Team inside DealInSec, and help with the legwork in the background: Nibo finds potential clients, Mika drafts outreach and follow-ups, and Zee keeps you on top of what needs your attention. They keep working when you close the page, and they ask before anything that matters. AI results may be incomplete or inaccurate, so check important details before contacting a client.</p>
        </Reveal>
        <Reveal className="mx-auto mt-8 max-w-3xl">
          <img {...NEST_TEAM_IMAGE} sizes="(min-width: 800px) 768px, 100vw" loading="lazy" decoding="async" draggable={false}
            className="h-auto w-full select-none rounded-3xl shadow-[0_30px_60px_-30px_rgba(60,40,20,0.45)]" data-testid="landing-nest-team" />
        </Reveal>
        <motion.ul initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} variants={stagger} className="mt-8 grid gap-4 md:grid-cols-3">
          {TEAM.map((m) => (
            <motion.li key={m.key} variants={reveal} className="relative flex flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60" data-testid={`landing-ai-${m.key}`}>
              <span className={cn("absolute inset-x-0 top-0 h-1", m.bar)} aria-hidden />
              <div className="flex items-center gap-4">
                <span className={cn("nest-float-soft block h-24 w-24 shrink-0 overflow-hidden rounded-full shadow-[0_8px_18px_-10px_rgba(60,40,20,0.6)] ring-2 ring-white dark:ring-neutral-800", m.tint)}>
                  <img {...plushSrc(m.key)} sizes="96px" width={96} height={96} loading="lazy" decoding="async" draggable={false}
                    alt={`${m.name}, the DealInSec AI coworker who ${m.does}`} className="h-24 w-24 select-none object-cover" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-xl font-extrabold">{m.name} <span aria-hidden>{m.emoji}</span></h3>
                  <p className={cn("text-sm font-semibold", m.fg)}>{m.role}</p>
                </div>
              </div>
              <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">{m.line}</p>
              <ul className="mt-3 space-y-1.5 text-sm text-neutral-600 dark:text-neutral-400">
                {m.points.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />{p}</li>)}
              </ul>
            </motion.li>
          ))}
        </motion.ul>
        <Reveal className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="flex gap-3 rounded-2xl border border-neutral-200/80 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/60">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"><Sparkles className="h-5 w-5" aria-hidden /></span>
            <div>
              <h3 className="font-bold">Just ask your team</h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Each coworker has its own chat, and a voice call too. Ask in plain words; they work through your records and ask you before anything that matters.</p>
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
      </div>
    </section>
  );
}

/* ── Why keep it together ──────────────────────────────────────────────────────────────── */

const SPREAD = [
  "Prospects in browser tabs and a spreadsheet",
  "Outreach and replies scattered across your inbox",
  "Follow-ups on sticky notes and phone reminders",
  "No record of why a company was worth contacting",
  "Good prospects going cold because nobody chased",
  "The quote, the contract and the invoice retyped in three tools",
];
const TOGETHER = [
  "Researched prospects saved straight into your lead pipeline",
  "Each lead's facts, sources, next steps and follow-ups in one place",
  "Outreach drafted from the evidence, approved by you",
  "What needs you today on one dashboard",
  "Won work becomes the quotation, agreement and invoice from the same record, free",
  "Your AI team keeps working when you close the page",
];

export function ManualWorkflowSection() {
  return (
    <section className="py-16 sm:py-20" data-testid="landing-manual-vs">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">Why keep the whole hunt <span className={GREEN}>in one place</span></h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">When each step lives in a different tool, details get re-typed, follow-ups slip and good prospects go cold.</p>
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
        <p className="mx-auto mt-5 max-w-2xl text-center text-xs text-neutral-500">DealInSec doesn&apos;t guarantee clients or replies: it keeps the work of finding and winning a client together, with you approving everything that goes out.</p>
      </div>
    </section>
  );
}

/* ── Who it's for ────────────────────────────────────────────────────────────────────── */

const AUDIENCES = [
  { Icon: Building2, title: "Freelance web developers", text: "Research businesses in your city or niche and reach out with evidence, not guesswork.", href: "/for-freelancers" },
  { Icon: Sparkles, title: "Designers and creatives", text: "Find companies that fit the work you want to do, send a first message you approved, and win the project.", href: "/for-freelancers" },
  { Icon: Users, title: "Digital marketers and SEO consultants", text: "Find companies in your niche with evidence and dated reasons to reach out, then land the retainer.", href: "/for-freelancers" },
  { Icon: UserRound, title: "Independent consultants", text: "Turn a researched prospect into a conversation, with the follow-ups that make it real work.", href: "/for-freelancers" },
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

/* ── The Deal Suite: deal to invoice, free on every plan ─────────────────────────────── */

const SUITE_STEPS = [
  { Icon: Briefcase, title: "Deal", text: "The client, the engagement model (retainer, fixed price, hourly, milestones), the value, dates and deliverables. A won lead becomes one in a step." },
  { Icon: FileText, title: "Quotation", text: "Versioned, generated from the deal, with a link your client opens and accepts online, or a PDF." },
  { Icon: Signature, title: "Agreement", text: "Standard and custom terms from the same deal; your client signs online, with an audit record of who signed and when." },
  { Icon: ReceiptText, title: "Invoice", text: "One invoice, an advance and a balance, or milestones, never more than the agreement; your business and tax details printed." },
  { Icon: Wallet, title: "Payment tracking", text: "Mark each invoice paid as the money arrives and see what's paid, pending and overdue; a reminder is drafted for you to send." },
] as const;

const SUITE_FACTS = [
  "Free on every plan, with no monthly cap and no card",
  "Protection Check flags risky or missing terms (no advance, unlimited revisions, no payment timeline) before you send",
  "Your own currency on every document: rupees with PAN and GSTIN in India, 50 currencies for clients elsewhere",
  "Electronic acceptance with an audit record, not a certified digital signature; in-app invoices aren't GST tax invoices",
  "Your client pays you directly. DealInSec records the payment and never collects or holds the money",
];

export function DealSuiteSection({ isAuthenticated, onPrimary }: { isAuthenticated: boolean; onPrimary: () => void }) {
  return (
    <section id="deal-suite" className="scroll-mt-20 bg-gradient-to-b from-emerald-50/60 to-transparent py-16 sm:py-20 dark:from-emerald-950/20" data-testid="landing-deal-suite">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{DEAL_SUITE_LABEL} · free on every plan</span>
          <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-[-0.025em] sm:text-4xl">Won the work? <span className={GREEN}>Deal to invoice is free.</span></h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">Create the deal, send a quotation your client accepts online, generate the agreement they sign online, raise the invoice and track what's paid. Every document comes from the same deal, so the scope and the figures always match, and none of it costs anything, on any plan.</p>
        </Reveal>
        <motion.ol initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} variants={stagger} className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {SUITE_STEPS.map(({ Icon, title, text }, i) => (
            <motion.li key={title} variants={reveal} className="relative rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60" data-testid={`landing-suite-${i + 1}`}>
              {i < SUITE_STEPS.length - 1 && <ArrowRight className="absolute -right-3 top-6 hidden h-4 w-4 text-emerald-400 lg:block" aria-hidden />}
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white"><Icon className="h-5 w-5" aria-hidden /></span>
              <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Step {i + 1}</p>
              <h3 className="text-lg font-bold">{title}</h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{text}</p>
            </motion.li>
          ))}
        </motion.ol>
        <Reveal className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <ul className="grid gap-2 rounded-2xl border border-neutral-200/80 bg-white p-5 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300 sm:grid-cols-2">
            {SUITE_FACTS.map((t) => <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />{t}</li>)}
          </ul>
          <div className="flex flex-col justify-center rounded-2xl bg-gradient-to-br from-emerald-700 to-teal-800 p-6 text-white">
            <p className="text-lg font-bold">Start with the paperwork, add the client-finding when you want it.</p>
            <p className="mt-1 text-sm text-emerald-50/85">Plenty of people sign up for the free quotation, agreement and invoice flow first, then let Client Radar fill the next month.</p>
            <button type="button" onClick={onPrimary} data-testid="button-suite-cta"
              className="group mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-emerald-800 shadow-lg transition hover:bg-emerald-50">
              {isAuthenticated ? "Create a deal" : "Create your first deal, free"}<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <a href="/tools" className="mt-3 text-xs font-medium text-emerald-100 underline-offset-2 hover:underline">No account yet? Free quotation, invoice and agreement tools, no sign-up</a>
          </div>
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
            <h2 className="text-3xl font-extrabold leading-tight tracking-[-0.025em] sm:text-5xl">Your next client is out there.<br />Send your AI team to find them.</h2>
            <p className="mx-auto mt-4 max-w-xl text-emerald-50/90">Start free: research potential clients, save leads, send outreach you approve, and run every won deal from quotation to invoice at no cost. Upgrade for more searches and drafts, or add a booster pack when a month runs short.</p>
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
                  <AccordionTrigger className="py-3.5 text-left text-sm font-semibold hover:no-underline">{f.q}</AccordionTrigger>
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

