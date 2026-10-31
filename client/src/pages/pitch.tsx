/**
 * /pitch: a one-page, printable overview of DealInSec as it is today (kept out of search; see server/site-head.ts).
 * Everything here is a shipped feature, and prices and limits come from the same constants the app enforces
 * (shared/product-facts.ts, outbound-plans.ts, ai-league.ts), so the overview can't drift from the product. Pictures of
 * the coworkers are the plush artwork (lib/plush.ts); nothing claims customers, results or integrations we don't have.
 */
import { Link } from "wouter";
import {
  ArrowRight, Bot, CheckCircle2, Download, FileSignature, FileText, Globe, Handshake, MapPin, MessageSquare,
  Radar, ReceiptText, ShieldCheck, Sparkles, Target, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DealinsecLogo } from "@/components/dealinsec-logo";
import { NEST_TEAM_IMAGE, plushSrc, type PlushBot } from "@/lib/plush";
import { PRICING, TAGLINE } from "@shared/product-facts";
import { OUTBOUND_ALLOWANCE_DEFAULTS as OB, OUTBOUND_WINDOW_DAYS } from "@shared/outbound-plans";
import { LEAGUE_ALLOWANCE_DEFAULTS as LG, LEAGUE_WINDOW_DAYS } from "@shared/ai-league";
import { PRO_INCLUDED_SEATS } from "@shared/permissions";

const JOURNEY = [
  { Icon: Radar, title: "Find", text: "Client Radar researches companies online or local businesses in a city." },
  { Icon: Target, title: "Lead", text: "Save the right ones, with a next step and a follow-up date." },
  { Icon: Handshake, title: "Deal", text: "A won lead becomes a deal: client, scope, fee and dates." },
  { Icon: FileText, title: "Quotation", text: "Generated from the deal; your client accepts it online." },
  { Icon: FileSignature, title: "Agreement", text: "Your client signs online, with an audit record." },
  { Icon: ReceiptText, title: "Invoice", text: "From the agreement; track paid, pending and overdue." },
] as const;

const TEAM: { bot: PlushBot; name: string; emoji: string; role: string; tint: string; fg: string; points: string[] }[] = [
  {
    bot: "nibo", name: "Nibo", emoji: "🔎", role: "Deal Finder", tint: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900", fg: "text-amber-800 dark:text-amber-300",
    points: ["Finds potential clients and researches businesses", "Checks each company's own website, with sources", "Saves only the qualified ones to Leads", "Can run a longer research campaign and report back"],
  },
  {
    bot: "mika", name: "Mika", emoji: "💌", role: "Deal Closer", tint: "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900", fg: "text-rose-700 dark:text-rose-300",
    points: ["Drafts personalised outreach and follow-ups", "Written from what was verified about each lead", "You edit and approve the exact text", "You send it yourself: nothing is sent for you"],
  },
  {
    bot: "zee", name: "Zee", emoji: "🌱", role: "Business Buddy", tint: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900", fg: "text-emerald-700 dark:text-emerald-300",
    points: ["Today's business briefing from your own records", "Overdue invoices and what's due this week", "Follow-ups due and agreements ready to invoice", "Never invents a number"],
  },
];

const RADAR = [
  { Icon: Globe, title: "Companies online, any country", text: "Describe who you want to reach and where: India, the US, the UK, the UAE or worldwide. Each company is scored against your ideal client, with dated reasons to reach out now." },
  { Icon: MapPin, title: "Local businesses in a city", text: "Dentists in Siliguri, cafes in Pune: list businesses from Google Maps, then research all the ones with a website in one click. Businesses already researched or in your leads are skipped." },
  { Icon: Sparkles, title: "Score, AI brief and evidence", text: "Every researched company gets a score with its reasons, an AI brief, the evidence and the page it came from. Guesses are labelled as guesses." },
];

const PIPELINE = [
  { title: "Leads pipeline", text: "New → researching → qualified → contacted → replied → meeting → proposal → won or lost, with next steps, follow-up dates and a do-not-contact list.", plan: "Free" },
  { title: "Deals", text: "Retainer, fixed price, hourly, milestones and more, in your workspace's currency. Import existing deals from a CSV file.", plan: `Free: ${PRICING.freeMonthlyDeals} a month` },
  { title: "Quotations", text: "Versioned, generated from the deal, with a link your client opens and accepts online. Protection Check flags missing terms first.", plan: "Free" },
  { title: "Agreements", text: "Standard and custom terms; your client signs online through a link. Electronic acceptance with an audit record, not a certified digital signature.", plan: "Pro" },
  { title: "Invoices and payment follow-ups", text: "Single or split into advance and final, never more than the agreement. Mark payments received; AI drafts a polite reminder you send yourself.", plan: "Pro" },
  { title: "Today list and your AI team", text: "The dashboard shows what needs you today. Ask Nibo, Mika or Zee in plain words; they work through your records and ask before anything that matters.", plan: "Free" },
];

const TRUST = [
  "AI researches and drafts; you approve every message and send it yourself. Nothing is sent automatically.",
  "Your client pays you directly: DealInSec records payments and never collects or moves money.",
  "App invoices don't calculate tax and aren't GST tax invoices; your PAN and GSTIN are printed on documents.",
  "No guaranteed clients or replies, and not a contact database: contact details are only what companies publish.",
];

export default function PitchPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 print:bg-white">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" aria-label="DealInSec home"><DealinsecLogo size="sm" withText /></Link>
          <Button onClick={() => window.print()} className="shrink-0" aria-label="Export PDF" data-testid="button-export-pdf"><Download className="mr-2 h-4 w-4" /><span className="hidden sm:inline">Export&nbsp;</span>PDF</Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-14 px-4 py-10 print:space-y-8 print:py-4">
        {/* Hero */}
        <section className="grid items-center gap-8 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">For freelancers and service providers in India</p>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight md:text-5xl print:text-3xl">{TAGLINE}</h1>
            <p className="mt-4 text-lg text-muted-foreground print:text-base">
              DealInSec is a simple business workspace for freelancers, consultants and small agencies. Find potential clients with Client Radar,
              get help from your AI team in The Nest, and run every deal from quotation to agreement, invoice and payment follow-up in one place.
            </p>
            <ul className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
              {["Free plan, no credit card required", `Pro ₹${PRICING.proMonthlyInr}/month in India`, "You approve everything that reaches a client", "Works on phone and desktop"].map((t) => (
                <li key={t} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />{t}</li>
              ))}
            </ul>
          </div>
          <img {...NEST_TEAM_IMAGE} sizes="(min-width: 1024px) 560px, 100vw" loading="eager" decoding="async" className="h-auto w-full rounded-3xl shadow-xl print:shadow-none" />
        </section>

        {/* The journey */}
        <section aria-labelledby="journey-h">
          <h2 id="journey-h" className="text-center text-2xl font-bold print:text-xl">The whole client journey, in one place</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground">One record carries the client from first research to paid invoice, so the scope and the numbers never have to be typed twice.</p>
          <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-6 print:grid-cols-3">
            {JOURNEY.map(({ Icon, title, text }, i) => (
              <li key={title} className="rounded-2xl border bg-card p-4">
                <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">{i + 1}</span>{title}</span>
                <Icon className="mt-3 h-5 w-5 text-primary" aria-hidden />
                <p className="mt-2 text-sm text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Client Radar */}
        <section aria-labelledby="radar-h" className="rounded-3xl border bg-card p-6 sm:p-8 print:break-inside-avoid">
          <p className="text-sm font-semibold text-primary">Find clients</p>
          <h2 id="radar-h" className="mt-1 text-2xl font-bold print:text-xl">Client Radar 🔎</h2>
          <p className="mt-2 max-w-3xl text-muted-foreground">Research the clients you want, with the evidence behind each one. Nobody is contacted and no lead is created until you choose.</p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {RADAR.map(({ Icon, title, text }) => (
              <div key={title} className="rounded-2xl bg-muted/40 p-4">
                <Icon className="h-5 w-5 text-primary" aria-hidden />
                <h3 className="mt-2 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Free: {OB.free.monthlySearches} searches every {OUTBOUND_WINDOW_DAYS} days · Pro: {OB.pro.monthlySearches} searches · up to {OB.pro.maxCompanies} companies each, at most 5 a day. Research is never unlimited.</p>
        </section>

        {/* The Nest */}
        <section aria-labelledby="nest-h" className="print:break-inside-avoid">
          <p className="text-center text-sm font-semibold text-primary">Your AI team</p>
          <h2 id="nest-h" className="mt-1 text-center text-2xl font-bold print:text-xl">The Nest 🪺: meet Nibo, Mika and Zee</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground">Three AI coworkers who work in the background through DealInSec's own features. They keep going when you close the page, can ask each other for help, and always ask before anything that matters.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {TEAM.map((m) => (
              <article key={m.bot} className={`rounded-2xl border p-5 ${m.tint}`}>
                <div className="flex items-center gap-3">
                  <img {...plushSrc(m.bot)} sizes="72px" width={72} height={72} loading="lazy" decoding="async" alt={`${m.name}, the ${m.role}`} className="h-[72px] w-[72px] rounded-full object-cover shadow-md ring-2 ring-white" />
                  <div>
                    <h3 className="text-lg font-bold">{m.name} <span aria-hidden>{m.emoji}</span></h3>
                    <p className={`text-sm font-semibold ${m.fg}`}>{m.role}</p>
                  </div>
                </div>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {m.points.map((p) => <li key={p} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />{p}</li>)}
                </ul>
              </article>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">Free: {LG.free.monthlyRuns} coworker tasks every {LEAGUE_WINDOW_DAYS} days · Pro: {LG.pro.monthlyRuns}. Tasks can be scheduled daily, on weekdays or weekly. AI results may be incomplete or inaccurate; check important details before contacting a client.</p>
        </section>

        {/* Pipeline and documents */}
        <section aria-labelledby="run-h">
          <h2 id="run-h" className="text-center text-2xl font-bold print:text-xl">Win the deal and get paid</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-muted-foreground">Everything after the first reply: the pipeline, the deal and the documents that get you paid.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PIPELINE.map((f) => (
              <div key={f.title} className="rounded-2xl border bg-card p-5 print:break-inside-avoid">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{f.title}</h3>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{f.plan}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section aria-labelledby="trust-h" className="rounded-3xl border bg-card p-6 sm:p-8 print:break-inside-avoid">
          <h2 id="trust-h" className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden />Built so you stay in charge</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {TRUST.map((t) => <li key={t} className="flex gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />{t}</li>)}
          </ul>
          <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <p className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" aria-hidden />Team roles: Owner, Admin, Sales, Accounts or your own</p>
            <p className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" aria-hidden />WhatsApp share links for documents</p>
            <p className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" aria-hidden />AI drafts from your real records</p>
          </div>
        </section>

        {/* Pricing */}
        <section aria-labelledby="price-h" className="print:break-inside-avoid">
          <h2 id="price-h" className="text-center text-2xl font-bold print:text-xl">Start free. Upgrade when you need more.</h2>
          <div className="mx-auto mt-8 grid max-w-4xl gap-4 md:grid-cols-2">
            <div className="rounded-2xl border bg-card p-6">
              <p className="font-semibold">Free</p>
              <p className="mt-2 text-3xl font-bold">₹0 <span className="text-sm font-normal text-muted-foreground">forever, no credit card</span></p>
              <ul className="mt-4 space-y-2 text-sm">
                {[`${OB.free.monthlySearches} Client Radar searches every ${OUTBOUND_WINDOW_DAYS} days`, "Leads pipeline and outreach drafts you approve", `${PRICING.freeMonthlyDeals} deals a month, each with its quotation`, `${LG.free.monthlyRuns} AI coworker tasks every ${LEAGUE_WINDOW_DAYS} days`].map((t) => (
                  <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />{t}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border-2 border-primary bg-card p-6">
              <p className="font-semibold">DealInSec Pro</p>
              <p className="mt-2 text-3xl font-bold">₹{PRICING.proMonthlyInr} <span className="text-sm font-normal text-muted-foreground">/ month in India</span></p>
              <ul className="mt-4 space-y-2 text-sm">
                {[`${OB.pro.monthlySearches} Client Radar searches every ${OUTBOUND_WINDOW_DAYS} days`, "Unlimited deals and quotations", "Agreements signed online, invoices and payment tracking", `${LG.pro.monthlyRuns} AI coworker tasks every ${LEAGUE_WINDOW_DAYS} days`, `Up to ${PRO_INCLUDED_SEATS} team members`].map((t) => (
                  <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />{t}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">Paid once a month through Razorpay (UPI, cards, netbanking), with no tax added on top and no auto-renewal. Paid plans can't be bought outside India yet.</p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-3xl bg-gradient-to-br from-emerald-700 to-teal-700 px-6 py-10 text-center text-white print:hidden">
          <h2 className="text-2xl font-bold sm:text-3xl">Find your next client. Get paid for the last one.</h2>
          <p className="mx-auto mt-2 max-w-xl text-emerald-50/90">Start on the free plan: research potential clients, save leads, create deals and send quotations.</p>
          <a href="/auth?mode=signup" className="mt-6 inline-flex h-11 items-center rounded-lg bg-white px-6 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">Get started free<ArrowRight className="ml-2 h-4 w-4" aria-hidden /></a>
        </section>
        <p className="hidden text-center text-sm print:block">dealinsec.com · {TAGLINE} · support@dealinsec.com</p>
      </main>
    </div>
  );
}
