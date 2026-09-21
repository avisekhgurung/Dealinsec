/**
 * Landing page sections that carry the freelancer story:
 * problem → workflow → scope → payment tracking → client experience →
 * global → AI → features. Every claim here must be backed by the product —
 * see the fact notes beside each section, and keep landing-seo.ts in step.
 */
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  Briefcase,
  Check,
  ChevronRight,
  Clock,
  FileSignature,
  FileText,
  Globe,
  LayoutDashboard,
  Mail,
  MessageSquare,
  NotebookPen,
  Receipt,
  Send,
  ShieldCheck,
  Sparkles,
  Table2,
  Wallet,
} from "lucide-react";
import { BRAND_GRADIENT, GradientText, SectionHeader, SplitRow, fadeUp, stagger } from "@/components/landing-shared";

const CARD =
  "rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-900/10";

// ────────────────────────────────────────────────────────────────────────────
// 1. Problem — seven tools vs one thread
// ────────────────────────────────────────────────────────────────────────────

const SCATTERED = [
  { icon: MessageSquare, label: "WhatsApp" },
  { icon: FileText, label: "Google Docs" },
  { icon: Mail, label: "Email" },
  { icon: FileText, label: "PDFs" },
  { icon: Table2, label: "Spreadsheet" },
  { icon: Receipt, label: "Invoice tool" },
  { icon: NotebookPen, label: "Notes" },
];

const THREAD = ["Quote", "Agreement", "Invoice", "Payment"];

export function ProblemSection() {
  return (
    <section id="problem" className="py-20 sm:py-28 border-y border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="The everyday mess"
          title={
            <>
              Your freelance business shouldn&apos;t live across <GradientText>7 different apps.</GradientText>
            </>
          }
          subtitle="Client messages in WhatsApp. Scope in Google Docs. Quotes in PDFs. Invoices somewhere else. Payment tracking in a spreadsheet."
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
              Each document is generated from the same deal, so the numbers and the scope always match.
            </p>
          </motion.div>
        </div>

        <p className="text-center text-xl sm:text-2xl font-bold tracking-tight mt-12">
          One client. One deal. <GradientText>One source of truth.</GradientText>
        </p>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Workflow — five connected steps with a tiny UI preview each
// ────────────────────────────────────────────────────────────────────────────

const STEP_PREVIEWS = [
  // 01 create a deal
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
    <p className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold"><Check className="w-3 h-3" /> Signed copy on file</p>
  </div>,
  // 04 invoice
  <div key="inv" className="space-y-1.5">
    <p className="text-[11px] font-semibold">Advance invoice</p>
    <p className="text-[10px] text-neutral-500">50% to start</p>
    <p className="text-sm font-bold">$1,600</p>
  </div>,
  // 05 track
  <div key="trk" className="flex flex-col gap-1.5">
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 w-fit">Paid</span>
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 w-fit">Pending</span>
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 w-fit">Overdue</span>
  </div>,
];

const STEPS = [
  { icon: Briefcase, title: "Create a deal", desc: "Client, scope, timeline and fee in one record." },
  { icon: FileText, title: "Send a quote", desc: "A clean quotation with your terms, generated from the deal." },
  { icon: FileSignature, title: "Get the agreement signed", desc: "Sign with your saved signature, send the PDF, and upload the signed copy." },
  { icon: Receipt, title: "Send the invoice", desc: "Advance, milestone or final, drawn from the agreement." },
  { icon: Wallet, title: "Track payment", desc: "See what's paid, pending or overdue at a glance." },
];

export function HowItWorksSection() {
  return (
    <section id="how" className="py-20 sm:py-28 scroll-mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="How it works"
          title="From client conversation to paid."
          subtitle="Turn every new client into a clear, professional workflow."
        />

        <div className="mt-16 relative">
          <div className="hidden lg:block absolute top-[34px] left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-transparent via-emerald-300/80 to-transparent dark:via-emerald-800/60" />
          <motion.ol
            variants={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-x-5 gap-y-10 relative"
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
// 3. Scope — the agreement UI
// ────────────────────────────────────────────────────────────────────────────

const SCOPE_ROWS = [
  { label: "Deliverables", value: "Homepage + 4 inner pages, mobile layouts, source files" },
  { label: "Timeline", value: "4 weeks from kickoff" },
  { label: "Revisions", value: "2 rounds included; extra rounds quoted separately" },
  { label: "Payment terms", value: "50% advance, 50% within 7 days of delivery" },
];

export function ScopeSection() {
  return (
    <section id="scope" className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800 bg-gradient-to-b from-neutral-50/50 to-white dark:from-neutral-900/30 dark:to-neutral-950 scroll-mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SplitRow
          eyebrow="Scope protection"
          title="Get the scope clear before the work begins."
          desc="Define deliverables, timelines, revisions and payment terms before you start. Keep everyone on the same page."
          visual={
            <div className={`${CARD} p-5 sm:p-6`}>
              <div className="flex items-center gap-3 pb-4 mb-4 border-b border-neutral-200 dark:border-neutral-800">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                  <FileSignature className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold">Service Agreement</p>
                  <p className="text-[11px] text-neutral-500 truncate">Lena Ortiz · Cedar &amp; Co</p>
                </div>
              </div>
              <dl className="space-y-3">
                {SCOPE_ROWS.map((r) => (
                  <div key={r.label} className="rounded-lg border-l-2 border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20 px-3.5 py-2.5">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">{r.label}</dt>
                    <dd className="text-[13px] mt-0.5 text-neutral-800 dark:text-neutral-200">{r.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex items-end justify-between mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-neutral-500">Total project value</p>
                  <p className="text-2xl font-bold text-emerald-600">$3,200</p>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  <Clock className="w-3.5 h-3.5" /> Awaiting signed copy
                </span>
              </div>
            </div>
          }
        >
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="w-4 h-4" /> Clear scope. Fewer misunderstandings.
          </div>
          <ul className="mt-6 space-y-3 text-[15px] text-neutral-700 dark:text-neutral-300">
            <li className="flex gap-2.5"><Check className="w-4 h-4 text-emerald-600 mt-1 shrink-0" /> You sign with your saved signature and send the PDF. Upload the client\u2019s signed copy and the agreement is marked Signed, with the date.</li>
            <li className="flex gap-2.5"><Check className="w-4 h-4 text-emerald-600 mt-1 shrink-0" /> Protection Check flags vague wording like &ldquo;unlimited revisions&rdquo; or a missing advance before you send.</li>
          </ul>
          <p className="text-xs text-neutral-500 mt-5 max-w-md">
            A written record of what was agreed &mdash; not legal advice, and it can&apos;t make a client pay.
          </p>
        </SplitRow>
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
  { client: "Northwind Studio", ref: "Brand identity · Final", amount: "$2,000", status: "Paid" },
  { client: "Cedar & Co", ref: "Website · Advance", amount: "$800", status: "Pending" },
  { client: "Halo Fitness", ref: "Reels · March", amount: "$500", status: "Overdue" },
  { client: "Fenwick Legal", ref: "Copywriting · Milestone 2", amount: "$1,200", status: "Paid" },
  { client: "Oak & Ivy", ref: "Consulting · Sprint 1", amount: "$350", status: "Pending" },
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
        <p className="text-center text-xs text-neutral-500 mt-2">Example documents. Add your own name, logo and terms.</p>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 6. Global — only currencies the app really supports (shared/money.ts)
// ────────────────────────────────────────────────────────────────────────────

const CURRENCY_CHIPS = ["USD", "EUR", "GBP", "CAD", "AUD", "INR", "AED"];

const LOCAL_RULES = [
  { label: "Your currency", line: "Quote and invoice in the currency you charge in, from a list of 50." },
  { label: "Your tax field", line: "The tax ID your country uses, on the invoice: VAT number, EIN, GSTIN and others." },
  { label: "Your bank labels", line: "Sort code, routing number or IFSC: labelled the way your bank labels them." },
  { label: "Your country's wording", line: "Agreement wording follows the country you work from." },
];

export function GlobalSection() {
  return (
    <section id="global" className="py-20 sm:py-28 scroll-mt-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Global by design"
          title="Built for freelancers, wherever you work."
          subtitle="Work with clients across borders while keeping your deals, documents and invoices organized in one place."
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          className="flex flex-wrap items-center justify-center gap-2.5 mt-10"
        >
          {CURRENCY_CHIPS.map((c) => (
            <span key={c} className="rounded-full border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-1.5 text-sm font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
              {c}
            </span>
          ))}
          <span className="rounded-full border border-neutral-200 dark:border-neutral-800 px-4 py-1.5 text-sm font-medium text-neutral-500">
            + 43 more
          </span>
        </motion.div>

        <div className="grid sm:grid-cols-2 gap-4 mt-10">
          {LOCAL_RULES.map((r) => (
            <div key={r.label} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-5">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-1.5">
                <Globe className="w-3.5 h-3.5" /> {r.label}
              </p>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{r.line}</p>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-neutral-500 mt-6 max-w-xl mx-auto">
          Pick your country once at signup. DealInSec records payments in the currency you billed; it does not move money between countries.
        </p>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 7. AI — message in, structured deal out, human in the loop
// ────────────────────────────────────────────────────────────────────────────

const AI_FIELDS = [
  { k: "Client", v: "Acme" },
  { k: "Budget", v: "$1,500" },
  { k: "Timeline", v: "2 weeks" },
  { k: "Deliverables", v: "Design + Development" },
  { k: "Revisions", v: "2 rounds" },
];

export function AiSection({ onCta }: { onCta: () => void }) {
  return (
    <section id="ai" className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20 scroll-mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="AI-assisted"
          title="Spend less time turning conversations into paperwork."
          subtitle="Use AI to help turn client requirements into structured deal information."
        />

        <div className="mt-14 grid md:grid-cols-[1fr_auto_1fr] gap-5 md:gap-6 items-center max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            className={`${CARD} p-5`}
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-3">Client message</p>
            <div className="rounded-2xl rounded-tl-md bg-neutral-100 dark:bg-neutral-800 px-4 py-3 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
              I need a landing page for my SaaS. Budget is $1,500. Need it within 2 weeks. Includes design and development. Two rounds of revisions.
            </div>
          </motion.div>

          <div className="flex items-center justify-center text-emerald-600">
            <ArrowDown className="w-6 h-6 md:hidden" />
            <ArrowRight className="w-6 h-6 hidden md:block" />
          </div>

          <motion.div
            initial={{ opacity: 0, x: 16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: 0.1 }}
            className={`${CARD} p-5 border-emerald-200 dark:border-emerald-800/60`}
          >
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-3">
              <Sparkles className="w-3.5 h-3.5" /> DealInSec AI · draft
            </p>
            <dl className="space-y-2">
              {AI_FIELDS.map((f) => (
                <div key={f.k} className="flex items-baseline justify-between gap-3 text-sm">
                  <dt className="text-neutral-500">{f.k}</dt>
                  <dd className="font-semibold text-right">{f.v}</dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              onClick={onCta}
              className="mt-4 w-full h-10 rounded-md text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-md shadow-emerald-500/25"
              style={{ background: BRAND_GRADIENT }}
            >
              Create deal <Send className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-8 text-sm text-neutral-600 dark:text-neutral-400">
          <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-600" /> AI-assisted</span>
          <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-600" /> Review before creating</span>
          <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-600" /> Generate and edit</span>
        </div>
        <p className="text-center text-xs text-neutral-500 mt-4 max-w-lg mx-auto">
          Example only. AI can miss or misread details, so nothing is created until you check the draft and confirm it.
        </p>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 8. Features — grouped around the deal
// ────────────────────────────────────────────────────────────────────────────

const FEATURE_GROUPS = [
  {
    eyebrow: "Win the deal",
    icon: Briefcase,
    items: [
      { t: "Deals", d: "Client, scope, dates and fee in one record." },
      { t: "Quotes", d: "Scope, price and terms in a clean PDF." },
      { t: "Your terms", d: "Standard clauses, or write your own." },
    ],
  },
  {
    eyebrow: "Protect the work",
    icon: ShieldCheck,
    items: [
      { t: "Agreements", d: "Generated from the accepted quote." },
      { t: "Scope & deliverables", d: "Revisions and exclusions spelled out." },
      { t: "Signatures", d: "Your signature applied; signed copy kept as proof." },
    ],
  },
  {
    eyebrow: "Get paid",
    icon: Receipt,
    items: [
      { t: "Invoices", d: "Advance, milestone or final." },
      { t: "Payment tracking", d: "Paid, pending or overdue." },
      { t: "Payment reminders", d: "Drafted for you. You send." },
    ],
  },
  {
    eyebrow: "Stay organized",
    icon: LayoutDashboard,
    items: [
      { t: "Dashboard", d: "Deals, agreements and money at a glance." },
      { t: "Documents", d: "Every quote, agreement and invoice as a PDF." },
      { t: "Free tools", d: "Quote, invoice and agreement templates, no sign-up." },
    ],
  },
];

export function FeatureGroupsSection() {
  return (
    <section id="features" className="py-20 sm:py-28 scroll-mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Product"
          title="Everything you need to manage the client deal."
          subtitle="Grouped the way a deal actually moves."
        />
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5 mt-14"
        >
          {FEATURE_GROUPS.map((g) => (
            <motion.div
              key={g.eyebrow}
              variants={fadeUp}
              className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-6 hover:border-emerald-300 dark:hover:border-emerald-700/70 hover:shadow-xl hover:shadow-emerald-500/10 transition-all duration-300"
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center mb-4">
                <g.icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-4">{g.eyebrow}</p>
              <ul className="space-y-3.5">
                {g.items.map((i) => (
                  <li key={i.t}>
                    <p className="text-sm font-semibold">{i.t}</p>
                    <p className="text-[13px] text-neutral-600 dark:text-neutral-400 leading-snug">{i.d}</p>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
