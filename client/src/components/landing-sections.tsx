/**
 * Landing page sections. The homepage tells one story for small agencies and consultants: problem → workflow
 * (find prospects through to payment tracking) → AI Outbound → payment tracking → documents → US and India → trust.
 * Every claim here must be backed by the product (see the fact notes beside each section), and keep landing-seo.ts in step.
 */
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  Briefcase,
  Check,
  ChevronRight,
  Ban,
  CircleHelp,
  Clock,
  FileSignature,
  Fingerprint,
  FileText,
  Globe,
  LayoutDashboard,
  Mail,
  MessageSquare,
  NotebookPen,
  Receipt,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Table2,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { BRAND_GRADIENT, GradientText, SectionHeader, SplitRow, fadeUp, stagger } from "@/components/landing-shared";

const CARD =
  "rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-900/10";

// ────────────────────────────────────────────────────────────────────────────
// 1. Problem — seven tools vs one thread
// ────────────────────────────────────────────────────────────────────────────

const SCATTERED = [
  { icon: Table2, label: "Prospect sheet" },
  { icon: Mail, label: "Email" },
  { icon: MessageSquare, label: "WhatsApp" },
  { icon: FileText, label: "Proposal docs" },
  { icon: FileText, label: "PDFs" },
  { icon: Receipt, label: "Invoice tool" },
  { icon: NotebookPen, label: "Notes" },
];

const THREAD = ["Prospect", "Deal", "Quote", "Agreement", "Invoice", "Payment"];

export function ProblemSection() {
  return (
    <section id="problem" className="py-20 sm:py-28 border-y border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="The everyday mess"
          title={
            <>
              Winning and billing clients shouldn&apos;t take <GradientText>7 different apps.</GradientText>
            </>
          }
          subtitle="Prospects in a spreadsheet. Conversations in email and WhatsApp. Proposals in docs. Invoices in another tool. Who has paid lives in someone's head."
        />

        <div className="mt-14 grid md:grid-cols-[1fr_auto_1fr] gap-5 md:gap-6 items-stretch">
          {/* Without */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            className="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-white/70 dark:bg-neutral-900/40 p-6 sm:p-7"
          >
            <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 mb-5">Without DealInSec</p>
            <div className="flex flex-wrap gap-2.5">
              {SCATTERED.map(({ icon: Icon, label }, i) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 shadow-sm"
                  style={{ transform: `rotate(${[-1.5, 1, -0.5, 1.5, -1, 0.5, -1.5][i]}deg)` }}
                >
                  <Icon className="w-4 h-4 text-neutral-400" />
                  {label}
                </span>
              ))}
            </div>
            <p className="text-sm text-neutral-500 mt-6 leading-relaxed">
              Seven places to look, and the one detail you need is always in the other one.
            </p>
          </motion.div>

          <div className="flex items-center justify-center text-emerald-600">
            <ArrowDown className="w-6 h-6 md:hidden" />
            <ArrowRight className="w-6 h-6 hidden md:block" />
          </div>

          {/* With */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl border border-emerald-300 dark:border-emerald-800/60 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-neutral-900 p-6 sm:p-7 shadow-lg shadow-emerald-500/10"
          >
            <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-5">With DealInSec</p>
            <p className="text-base font-semibold mb-4">One connected workflow</p>
            <div className="flex flex-wrap items-center gap-2">
              {THREAD.map((s, i) => (
                <span key={s} className="inline-flex items-center gap-2">
                  <span
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm"
                    style={{ background: BRAND_GRADIENT }}
                  >
                    {s}
                  </span>
                  {i < THREAD.length - 1 && <ChevronRight className="w-4 h-4 text-emerald-600" />}
                </span>
              ))}
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-6 leading-relaxed">
              A prospect becomes a lead, a won lead becomes a deal, and every document is generated from that deal, so the scope and the numbers always match.
            </p>
          </motion.div>
        </div>

        <p className="text-center text-xl sm:text-2xl font-bold tracking-tight mt-12">
          One client. One record. <GradientText>From first touch to paid.</GradientText>
        </p>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Workflow — six connected steps with a tiny UI preview each
// ────────────────────────────────────────────────────────────────────────────

const STEP_PREVIEWS = [
  // 01 find prospects
  <div key="find" className="space-y-1.5">
    <p className="text-[11px] font-semibold truncate">Northwind Dental Group</p>
    <p className="text-[10px] text-neutral-500">Opened a 3rd clinic · Aug</p>
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">Qualified</span>
  </div>,
  // 02 reach out
  <div key="reach" className="space-y-1.5">
    <p className="text-[11px] font-semibold">First message</p>
    <p className="text-[10px] text-neutral-500">Drafted · you approve</p>
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">Approved, not sent</span>
  </div>,
  // 03 create a deal
  <div key="deal" className="space-y-1.5">
    <p className="text-[11px] font-semibold truncate">Website redesign</p>
    <p className="text-[10px] text-neutral-500">Cedar &amp; Co · 4 weeks</p>
    <p className="text-sm font-bold text-emerald-600">$3,200</p>
  </div>,
  // 02 quote
  <div key="quote" className="space-y-1.5">
    <div className="flex items-center justify-between">
      <p className="text-[11px] font-semibold">Quotation</p>
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">Sent</span>
    </div>
    <p className="text-[10px] text-neutral-500">Scope · price · terms</p>
    <p className="text-sm font-bold">$3,200</p>
  </div>,
  // 03 agreement
  <div key="agr" className="space-y-1.5">
    <p className="text-[11px] font-semibold">Service agreement</p>
    <p className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold"><Check className="w-3 h-3" /> You signed</p>
    <p className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold"><Check className="w-3 h-3" /> Client signed online</p>
  </div>,
  // 06 invoice and track
  <div key="inv" className="space-y-1.5">
    <p className="text-[11px] font-semibold">Advance invoice · $1,600</p>
    <div className="flex flex-wrap gap-1">
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">Paid</span>
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">Pending</span>
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">Overdue</span>
    </div>
  </div>,
];

const STEPS = [
  { icon: Search, title: "Find prospects", desc: "Describe your ideal client. DealInSec researches companies and shows the evidence for each fit." },
  { icon: Send, title: "Reach out", desc: "AI drafts a first message. You approve it, send it from your own email and mark it sent." },
  { icon: Briefcase, title: "Create the deal", desc: "A won lead becomes a deal: client, scope, timeline and fee in one record." },
  { icon: FileText, title: "Send a quote", desc: "A clean quotation with your terms, generated from the deal." },
  { icon: FileSignature, title: "Get it signed", desc: "Send a signing link. Your client signs online without an account." },
  { icon: Receipt, title: "Invoice and track", desc: "Advance, milestone or final invoices, then see what's paid, pending or overdue." },
];

export function HowItWorksSection() {
  return (
    <section id="how" className="py-20 sm:py-28 scroll-mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="How it works"
          title="From finding the client to getting paid."
          subtitle="Two connected halves of one workflow: win the client, then deliver and get paid. Use both, or start with the half you need."
        />

        <div className="mt-16 relative">
          <div className="hidden xl:block absolute top-[34px] left-[8%] right-[8%] h-0.5 bg-gradient-to-r from-transparent via-emerald-300/80 to-transparent dark:via-emerald-800/60" />
          <motion.ol
            variants={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-x-5 gap-y-10 relative"
          >
            {STEPS.map((s, i) => (
              <motion.li key={s.title} variants={fadeUp} className="relative flex flex-col items-center text-center">
                <div className="relative w-[68px] h-[68px] rounded-2xl flex items-center justify-center mb-4 bg-white dark:bg-neutral-900 border border-emerald-200 dark:border-emerald-800/50 shadow-lg shadow-emerald-900/10">
                  <s.icon className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                  <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center shadow-md">
                    0{i + 1}
                  </span>
                </div>
                <h3 className="text-base font-semibold mb-1.5">{s.title}</h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed max-w-[24ch] mb-4">{s.desc}</p>
                <div className="w-full max-w-[220px] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/70 p-3 text-left shadow-sm mt-auto min-h-[84px]">
                  {STEP_PREVIEWS[i]}
                </div>
              </motion.li>
            ))}
          </motion.ol>
        </div>
        <p className="text-center text-xs text-neutral-500 mt-10">Example data shown.</p>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Payment tracking — example dashboard
// ────────────────────────────────────────────────────────────────────────────

const PAY_STATS = [
  { label: "Total invoiced", value: "$4,850", cls: "text-neutral-900 dark:text-white", dot: "bg-neutral-400" },
  { label: "Paid", value: "$3,200", cls: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  { label: "Pending", value: "$1,150", cls: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  { label: "Overdue", value: "$500", cls: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500" },
];

const PAY_ROWS = [
  { client: "Northwind Studio", ref: "SEO retainer · October", amount: "$2,000", status: "Paid" },
  { client: "Cedar & Co", ref: "Website · Advance", amount: "$800", status: "Pending" },
  { client: "Halo Fitness", ref: "Paid ads setup", amount: "$500", status: "Overdue" },
  { client: "Fenwick Legal", ref: "Content · Milestone 2", amount: "$1,200", status: "Paid" },
  { client: "Oak & Ivy", ref: "Automation build · Sprint 1", amount: "$350", status: "Pending" },
];

const STATUS_CLS: Record<string, string> = {
  Paid: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300",
  Pending: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300",
  Overdue: "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300",
};

export function PaymentTrackingSection() {
  return (
    <section id="payments" className="py-20 sm:py-28 scroll-mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SplitRow
          reverse
          eyebrow="Payment tracking"
          title="Know exactly what you're owed."
          desc="Track every invoice from sent to paid, so nothing gets lost in your inbox."
          visual={
            <div className={`${CARD} p-4 sm:p-5`}>
              <div className="grid grid-cols-2 gap-2.5 mb-4">
                {PAY_STATS.map((s) => (
                  <div key={s.label} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/80 p-3.5">
                    <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
                      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} /> {s.label}
                    </p>
                    <p className={`text-xl sm:text-2xl font-bold mt-1 tabular-nums ${s.cls}`}>{s.value}</p>
                  </div>
                ))}
              </div>
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                {PAY_ROWS.map((r) => (
                  <li key={r.client + r.ref} className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white dark:bg-neutral-900/60">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate">{r.client}</p>
                      <p className="text-[11px] text-neutral-500 truncate">{r.ref}</p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="text-[13px] font-semibold tabular-nums">{r.amount}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_CLS[r.status]}`}>{r.status}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-neutral-400 mt-3 text-center">Example data</p>
            </div>
          }
        >
          <ul className="mt-6 space-y-3 text-[15px] text-neutral-700 dark:text-neutral-300">
            <li className="flex gap-2.5"><Check className="w-4 h-4 text-emerald-600 mt-1 shrink-0" /> Know what&apos;s pending, and stay on top of overdue invoices.</li>
            <li className="flex gap-2.5"><Check className="w-4 h-4 text-emerald-600 mt-1 shrink-0" /> When something is late, Copilot drafts the follow-up from the real invoice. You review it and send it.</li>
          </ul>
          <p className="text-xs text-neutral-500 mt-5 max-w-md">
            DealInSec tracks payments; it doesn&apos;t process them. Your client pays you directly, and you mark the invoice paid.
          </p>
        </SplitRow>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Professional client experience — three branded documents
// ────────────────────────────────────────────────────────────────────────────

function DocShell({ kind, number: reference, children }: { kind: string; number: string; children: React.ReactNode }) {
  return (
    <div className={`${CARD} p-5 h-full flex flex-col`}>
      <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg text-white text-[11px] font-bold flex items-center justify-center shrink-0" style={{ background: BRAND_GRADIENT }}>LO</span>
          <span className="text-xs font-semibold truncate">Lena Ortiz</span>
        </div>
        <div className="text-right">
          <p className="text-[9px] uppercase tracking-widest text-neutral-500">{kind}</p>
          <p className="text-[11px] font-bold whitespace-nowrap">{reference}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

export function ProfessionalSection() {
  return (
    <section id="professional" className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20 scroll-mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Client experience"
          title="Look professional from the first quote to the final invoice."
          subtitle="Give every client a clear, consistent experience with professional documents and a simple workflow."
        />

        <p className="text-center text-sm sm:text-base font-semibold text-emerald-700 dark:text-emerald-400 mt-4">
          Your client doesn&apos;t need an account to view a quote, accept it, or sign an agreement.
        </p>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid lg:grid-cols-3 gap-5 mt-14 max-w-md lg:max-w-none mx-auto"
        >
          <motion.div variants={fadeUp}>
            <DocShell kind="Quotation" number="QUO-0042">
              <div className="space-y-2 text-xs">
                <div className="flex justify-between gap-3"><span className="text-neutral-500">To</span><span className="font-semibold text-right">Cedar &amp; Co</span></div>
                <div className="flex justify-between gap-3"><span className="text-neutral-500">Project</span><span className="font-semibold text-right">Website redesign</span></div>
                <div className="flex justify-between gap-3"><span className="text-neutral-500">Valid for</span><span className="font-semibold text-right">30 days</span></div>
              </div>
              <ul className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-[11px] space-y-1 text-neutral-700 dark:text-neutral-300">
                <li>✓ 50% advance to confirm</li>
                <li>✓ Balance within 7 days of delivery</li>
                <li>✓ Two rounds of revisions</li>
              </ul>
              <div className="flex items-end justify-between mt-auto pt-4">
                <div><p className="text-[10px] uppercase text-neutral-500">Total</p><p className="text-xl font-bold text-emerald-600">$3,200</p></div>
                <span className="px-3 py-1.5 rounded-md text-white text-xs font-semibold" style={{ background: BRAND_GRADIENT }}>Send quote</span>
              </div>
            </DocShell>
          </motion.div>

          <motion.div variants={fadeUp}>
            <DocShell kind="Agreement" number="AGR-0042">
              <div className="space-y-1.5 text-[11px] text-neutral-600 dark:text-neutral-400 leading-relaxed">
                <p>This agreement confirms the terms of work between the parties&hellip;</p>
                <p className="opacity-60">1 Scope of work · 2 Fees &amp; payment</p>
                <p className="opacity-40">3 Revisions · 4 Governing law</p>
              </div>
              <div className="grid grid-cols-2 gap-2.5 mt-auto pt-4">
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-2.5">
                  <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1">You</p>
                  <p className="text-xs font-bold italic text-emerald-700 dark:text-emerald-300" style={{ fontFamily: "Georgia, serif" }}>Lena O.</p>
                  <p className="flex items-center gap-1 mt-1 text-[9px] font-semibold text-emerald-700 dark:text-emerald-400"><Check className="w-3 h-3" /> Signed</p>
                </div>
                <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-2.5">
                  <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1">Client</p>
                  <div className="h-4 rounded bg-neutral-100 dark:bg-neutral-800" />
                  <p className="flex items-center gap-1 mt-1 text-[9px] font-semibold text-amber-700 dark:text-amber-400"><Clock className="w-3 h-3" /> Awaiting copy</p>
                </div>
              </div>
            </DocShell>
          </motion.div>

          <motion.div variants={fadeUp}>
            <DocShell kind="Invoice" number="INV-0042">
              <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 p-3.5">
                <p className="text-[10px] uppercase tracking-widest text-neutral-600 dark:text-neutral-400 font-semibold">Advance · 50%</p>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">$1,600</p>
              </div>
              <div className="space-y-2 text-xs mt-4">
                <div className="flex justify-between gap-3"><span className="text-neutral-500">Billed to</span><span className="font-semibold">Cedar &amp; Co</span></div>
                <div className="flex justify-between gap-3"><span className="text-neutral-500">Due</span><span className="font-semibold">In 7 days</span></div>
                <div className="flex justify-between gap-3"><span className="text-neutral-500">Pay to</span><span className="font-semibold">Your bank details</span></div>
              </div>
              <div className="mt-auto pt-4">
                <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">Pending</span>
              </div>
            </DocShell>
          </motion.div>
        </motion.div>

        <p className="text-center text-lg sm:text-xl font-semibold mt-12 text-balance">
          Your work is professional. Your client experience should be too.
        </p>
        <p className="text-center text-xs text-neutral-500 mt-2">Example documents. Add your own business details and terms.</p>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// AI Outbound — finding clients, with the evidence and the human in charge.
// Facts: a run turns a plain description into an ideal-client profile the user confirms, researches companies,
// scores fit with per-reason evidence and dates, and labels inferences and unknowns (server/outbound/service.ts,
// components/outbound/prospect-card.tsx). Prospects can be exported or added to Leads. First messages are AI drafts a
// person approves; DealInSec does not send email (Gmail sending is off), the person sends from their own email and
// marks it sent. Daily limits apply per workspace (server/outbound/limits.ts). No contact data without a provider.
// ────────────────────────────────────────────────────────────────────────────

const PROSPECT_EVIDENCE = [
  { text: "Opened a third clinic in Austin", source: "Their news page", date: "Aug 2026" },
  { text: "Hiring a marketing coordinator", source: "Careers page", date: "Sep 2026" },
];

export function AiOutboundSection() {
  return (
    <section id="outbound" className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/30 scroll-mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SplitRow
          eyebrow="AI Outbound"
          title={<>Find clients who fit, <GradientText>with the evidence.</GradientText></>}
          desc="Describe the clients you want, like “US dental groups opening new locations”. DealInSec researches companies, checks each one against your ideal client, and shows why it fits."
          visual={
            <div className={`${CARD} p-4 sm:p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">Prospect</p>
                  <p className="text-base font-bold truncate">Northwind Dental Group</p>
                  <p className="text-[11px] text-neutral-500">Dental clinics · Texas · 3 locations</p>
                </div>
                <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">Qualified</span>
              </div>
              <p className="mt-4 text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Why it fits</p>
              <ul className="mt-1.5 space-y-1.5">
                {PROSPECT_EVIDENCE.map((e) => (
                  <li key={e.text} className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2">
                    <p className="text-[13px] font-medium">{e.text}</p>
                    <p className="text-[10px] text-neutral-500">{e.source} · {e.date}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">What isn&apos;t known</p>
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-neutral-600 dark:text-neutral-400"><CircleHelp className="w-3.5 h-3.5 shrink-0" aria-hidden /> Marketing budget not stated</p>
              <div className="mt-4 flex items-center justify-between gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/40 px-3 py-2">
                <p className="text-[12px] font-semibold">First message</p>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">Draft · needs your approval</span>
              </div>
              <p className="text-[10px] text-neutral-400 mt-3 text-center">Example data</p>
            </div>
          }
        >
          <ul className="mt-6 space-y-3 text-[15px] text-neutral-700 dark:text-neutral-300">
            <li className="flex gap-2.5"><Target className="w-4 h-4 text-emerald-600 mt-1 shrink-0" aria-hidden /> Every prospect is marked qualified, partial, not a fit, or not enough evidence, with the reasons.</li>
            <li className="flex gap-2.5"><Clock className="w-4 h-4 text-emerald-600 mt-1 shrink-0" aria-hidden /> Evidence shows its source and how recent it is. Guesses are labelled as guesses, and gaps are shown, not filled in.</li>
            <li className="flex gap-2.5"><Send className="w-4 h-4 text-emerald-600 mt-1 shrink-0" aria-hidden /> Add the best ones to your pipeline. AI drafts a first message; you approve every word, send it from your own email, and mark it sent.</li>
            <li className="flex gap-2.5"><Ban className="w-4 h-4 text-emerald-600 mt-1 shrink-0" aria-hidden /> Your do-not-contact list is checked before anything is drafted or approved.</li>
          </ul>
          <p className="text-xs text-neutral-500 mt-5 max-w-md">
            DealInSec doesn&apos;t send email for you and never contacts anyone on its own. Research has daily limits per workspace.
          </p>
        </SplitRow>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// US and India — the same product, set up for how each country bills.
// Facts: org country sets currency, invoice numbering (India: April financial year; elsewhere: January),
// tax ID labels (shared/region.ts, shared/invoice-numbering.ts). Invoice tax lines are off everywhere
// (shared/invoice-tax.ts), so no tax-calculation claims. Checkout is India-only (₹, Razorpay); the free plan and
// the 7-day trial are open in every country (client/src/hooks/use-plan-prices.ts, server/routes.ts).
// ────────────────────────────────────────────────────────────────────────────

const COUNTRY_COLUMNS = [
  {
    key: "us",
    title: "Agencies in the United States",
    points: [
      "Quote, agree and invoice in US dollars, with your business details on every document.",
      "Invoice numbers restart each calendar year.",
      "DealInSec doesn't calculate sales tax; add it to your price where it applies.",
      "Use the free plan and the 7-day Pro trial today. Paid plans can't be bought from the US yet.",
    ],
  },
  {
    key: "in",
    title: "Agencies in India",
    points: [
      "Quote, agree and invoice in rupees, with your PAN and GSTIN on documents.",
      "Invoice numbers follow the financial year, from 1 April.",
      "In-app invoices aren't GST tax invoices; the free GST invoice generator is built for those.",
      "Pro is ₹99 a month or ₹999 a year, paid securely through Razorpay.",
    ],
  },
];

export function CountrySection() {
  return (
    <section id="countries" className="py-20 sm:py-28 scroll-mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="United States and India"
          title="One workspace, set up for how you bill."
          subtitle="Choose your country when you sign up. Your currency, document details and invoice numbering follow it, and you can change it until your first record exists."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {COUNTRY_COLUMNS.map((c) => (
            <div key={c.key} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 p-6 sm:p-7" data-testid={`country-${c.key}`}>
              <h3 className="text-lg font-bold tracking-tight">{c.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {c.points.map((pt) => (
                  <li key={pt} className="flex gap-2.5 text-[15px] text-neutral-700 dark:text-neutral-300">
                    <Check className="w-4 h-4 text-emerald-600 mt-1 shrink-0" aria-hidden />{pt}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-neutral-500">
          <Globe className="inline w-4 h-4 mr-1 -mt-0.5" aria-hidden />
          Clients elsewhere? Bill in any of 50 currencies, including EUR, GBP, CAD, AUD and AED.
        </p>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Trust — only what the product actually does.
// Facts: outreach needs a person's approval of the exact text and checks the do-not-contact list
// (server/sales/outreach.ts); payments are recorded, never collected (shared/paymentState.ts); signing stores
// name, time, IP and a SHA-256 fingerprint and is not a certified e-signature (server/agreementSign.ts);
// roles and permissions per workspace (shared/permissions.ts); AI drafts are reviewed before anything is created.
// ────────────────────────────────────────────────────────────────────────────

const TRUST_POINTS = [
  { Icon: Send, title: "Nothing goes out without you", body: "Every outreach message, quotation share and signing link is your decision. AI drafts; you approve." },
  { Icon: Ban, title: "Do-not-contact, respected", body: "Add an address or a whole domain once and DealInSec won't draft or approve messages to it." },
  { Icon: Wallet, title: "Your clients' money never touches us", body: "DealInSec tracks what's paid and overdue. Your client pays you directly, the way they already do." },
  { Icon: Fingerprint, title: "Signatures with an audit record", body: "Each online signature records who signed, when, from which IP, and a fingerprint of the exact agreement. It isn't a certified digital signature." },
  { Icon: Users, title: "Roles for your team", body: "Owner, Admin, Sales and Accounts roles, or your own, decide who can see and change what." },
  { Icon: ShieldCheck, title: "AI you can check", body: "AI drafts deals and messages from real records and labels what it inferred. Nothing is created until you confirm it." },
];

export function TrustSection() {
  return (
    <section id="trust" className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800 scroll-mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Trust and control"
          title="Built so you stay in charge."
          subtitle="What DealInSec does, and what it deliberately doesn't."
        />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRUST_POINTS.map(({ Icon, title, body }) => (
            <li key={title} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 p-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/50">
                <Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
              </span>
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
