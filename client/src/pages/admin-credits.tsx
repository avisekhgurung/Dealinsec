/**
 * Operator screen: credit packs, allowances and rules, per-account credits, usage and revenue, the audit log.
 * Reachable only by a platform admin (users.is_platform_admin, set by hand on the database); the page shows nothing to
 * anyone else, and every /api/admin/* route re-checks on the server. Every change here is written to the audit log
 * with who, what, the old and new value, and a reason.
 */
import { useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Plus, Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseApiError } from "@/lib/api-error";
import { creditNoun, dayLabel, LEDGER_LABEL, type CreditKind } from "@/lib/credits";
import { formatRupees } from "@/hooks/use-plan-prices";
import NotFound from "@/pages/not-found";

const kinds: CreditKind[] = ["search", "draft"];
const kindLabel = (k: string) => (k === "search" ? "Searches" : "AI drafts");
const field = "h-9";

function useAdminMutation<T>(fn: (v: T) => Promise<unknown>, keys: string[], done?: string) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { keys.forEach((k) => void queryClient.invalidateQueries({ queryKey: [k] })); if (done) toast({ title: done }); },
    onError: (e) => toast({ title: "Couldn't save", description: parseApiError(e).error ?? "Something went wrong.", variant: "destructive" }),
  });
}

/* ── Overview ──────────────────────────────────────────────────────────────── */
function Overview() {
  const { data } = useQuery<any>({ queryKey: ["/api/admin/overview"] });
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const sum = (rows: any[], pick: (r: any) => boolean, f: string) => rows.filter(pick).reduce((n, r) => n + Number(r[f] ?? 0), 0);
  const tile = (label: string, value: string | number, sub?: string) => (
    <Card key={label} className="glass-card"><CardContent className="p-3"><p className="text-xl font-bold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p>{sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}</CardContent></Card>
  );
  return (
    <div className="space-y-4" data-testid="admin-overview">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kinds.map((k) => tile(`${kindLabel(k)} credits used, ${data.windowDays} days`, data.consumed.find((r: any) => r.kind === k)?.n ?? 0))}
        {kinds.map((k) => tile(`${kindLabel(k)} credits outstanding`, data.outstanding.find((r: any) => r.kind === k)?.n ?? 0, "unspent, not expired"))}
        {tile("Top-up revenue (paid, all time)", formatRupees(sum(data.revenue, (r) => r.status === "completed", "rupees")), `${formatRupees(sum(data.revenue, (r) => r.status === "completed", "rupees_30d"))} in the last ${data.windowDays} days`)}
        {tile("Refunded top-ups", formatRupees(sum(data.revenue, (r) => r.status === "refunded", "rupees")), `${sum(data.revenue, (r) => r.status === "refunded", "orders")} orders`)}
        {tile("Orders under review", sum(data.revenue, (r) => r.status === "needs_review", "orders"))}
      </div>
      <Card className="glass-card"><CardContent className="space-y-1 p-4 text-sm">
        <p className="font-semibold">Feature usage, last {data.windowDays} days</p>
        {data.runs.map((r: any, i: number) => <p key={i} className="text-muted-foreground">{r.mode === "list" ? "Bulk list sweeps" : "Client Radar searches"} ({r.funded_by === "credit" ? "paid with credits" : "from plan"}): <strong className="text-foreground">{r.n}</strong></p>)}
        {data.drafts.map((r: any, i: number) => <p key={i} className="text-muted-foreground">AI drafts ({r.funded_by === "credit" ? "paid with credits" : "from plan"}): <strong className="text-foreground">{r.n}</strong></p>)}
      </CardContent></Card>
      <div className="flex flex-wrap gap-2">
        {["users", "purchases", "ledger"].map((t) => (
          <a key={t} href={`/api/admin/export?type=${t}`} download data-testid={`admin-export-${t}`}><Button variant="outline" size="sm"><Download className="mr-1.5 h-3.5 w-3.5" />Export {t} (CSV)</Button></a>
        ))}
      </div>
    </div>
  );
}

/* ── Packs ─────────────────────────────────────────────────────────────────── */
interface PackRow { id: number; kind: CreditKind; units: number; priceRupees: number; active: boolean; sortOrder: number; expiryMonths: number | null; sold: number }

function PackDialog({ pack, defaultExpiry, onClose }: { pack: Partial<PackRow> | null; defaultExpiry: number | null; onClose: () => void }) {
  const editing = !!pack?.id;
  const [kind, setKind] = useState<CreditKind>(pack?.kind ?? "search");
  const [units, setUnits] = useState(String(pack?.units ?? ""));
  const [price, setPrice] = useState(String(pack?.priceRupees ?? ""));
  const [expiry, setExpiry] = useState(pack?.id ? (pack.expiryMonths == null ? "" : String(pack.expiryMonths)) : defaultExpiry == null ? "" : String(defaultExpiry));
  const [order, setOrder] = useState(String(pack?.sortOrder ?? 0));
  const [active, setActive] = useState(pack?.active ?? true);
  const [reason, setReason] = useState("");
  const save = useAdminMutation(async () => {
    const body = { kind, units: Number(units), priceRupees: Number(price), expiryMonths: expiry.trim() === "" ? null : Number(expiry), sortOrder: Number(order) || 0, active, reason: reason || undefined };
    await apiRequest(editing ? "PATCH" : "POST", editing ? `/api/admin/packs/${pack!.id}` : "/api/admin/packs", body);
  }, ["/api/admin/packs", "/api/credits/packs"], "Pack saved");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="admin-pack-dialog">
        <DialogHeader><DialogTitle>{editing ? "Edit pack" : "New pack"}</DialogTitle><DialogDescription>Changes apply to new purchases at once. Orders already placed keep the terms they were shown.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Credits for</Label><select className={`${field} w-full rounded-md border bg-background px-2`} value={kind} onChange={(e) => setKind(e.target.value as CreditKind)} disabled={editing && (pack?.sold ?? 0) > 0} data-testid="pack-kind">{kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}</select></div>
          <div><Label>Quantity</Label><Input className={field} inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} data-testid="pack-units" /></div>
          <div><Label>Price (₹)</Label><Input className={field} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="pack-price" /></div>
          <div><Label>Expires after (months, empty = never)</Label><Input className={field} inputMode="numeric" value={expiry} onChange={(e) => setExpiry(e.target.value)} data-testid="pack-expiry" /></div>
          <div><Label>Display order</Label><Input className={field} inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} /></div>
          <div className="flex items-end gap-2"><Switch checked={active} onCheckedChange={setActive} id="pack-active" data-testid="pack-active" /><Label htmlFor="pack-active">On sale</Label></div>
        </div>
        <div><Label>Reason (optional, kept in the audit log)</Label><Input className={field} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate(undefined as never, { onSuccess: onClose })} data-testid="pack-save">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Packs() {
  const { data } = useQuery<{ packs: PackRow[]; defaultExpiryMonths: number | null }>({ queryKey: ["/api/admin/packs"] });
  const [editing, setEditing] = useState<Partial<PackRow> | null>(null);
  const del = useAdminMutation((id: number) => apiRequest("DELETE", `/api/admin/packs/${id}`), ["/api/admin/packs", "/api/credits/packs"], "Pack deleted");
  const toggle = useAdminMutation((p: PackRow) => apiRequest("PATCH", `/api/admin/packs/${p.id}`, { active: !p.active }), ["/api/admin/packs", "/api/credits/packs"]);
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-3" data-testid="admin-packs">
      <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">Packs are rows in the database: edit quantity, price, expiry and visibility here, no deploy needed.</p><Button size="sm" onClick={() => setEditing({})} data-testid="pack-new"><Plus className="mr-1.5 h-3.5 w-3.5" />New pack</Button></div>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[40rem] text-sm">
          <thead><tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground"><th className="py-1.5 pr-3 font-medium">For</th><th className="px-2 font-medium">Quantity</th><th className="px-2 font-medium">Price</th><th className="px-2 font-medium">Expiry</th><th className="px-2 font-medium">Sold</th><th className="px-2 font-medium">On sale</th><th /></tr></thead>
          <tbody>
            {data.packs.map((p) => (
              <tr key={p.id} className="border-b last:border-0" data-testid={`admin-pack-${p.id}`}>
                <td className="py-1.5 pr-3">{kindLabel(p.kind)}</td><td className="px-2 tabular-nums">{p.units}</td><td className="px-2 tabular-nums">{formatRupees(p.priceRupees)}</td>
                <td className="px-2">{p.expiryMonths == null ? "Never" : `${p.expiryMonths} months`}</td><td className="px-2 tabular-nums">{p.sold}</td>
                <td className="px-2"><Switch checked={p.active} onCheckedChange={() => toggle.mutate(p)} aria-label="On sale" /></td>
                <td className="space-x-1 py-1 text-right"><Button size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Button>
                  <Button size="icon" variant="ghost" aria-label="Delete pack" onClick={() => { if (window.confirm(p.sold ? "This pack has orders, so it can only be switched off." : "Delete this pack?")) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <PackDialog pack={editing} defaultExpiry={data.defaultExpiryMonths} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ── Allowances and rules ──────────────────────────────────────────────────── */
const ALLOWANCE_ROWS: [string, string][] = [
  ["monthlySearches", "Client Radar searches"], ["monthlyLists", "Bulk list sweeps"], ["monthlySocialScans", "Social Intent scans"],
  ["monthlyProspects", "Researched prospects"], ["monthlyDrafts", "AI drafts"], ["monthlySends", "Sends"],
];

function Rules() {
  const { data } = useQuery<any>({ queryKey: ["/api/admin/config"] });
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const set = useAdminMutation(({ key, value }: { key: string; value: unknown }) => apiRequest("PUT", `/api/admin/config/${key}`, { value, reason: reason || undefined }), ["/api/admin/config", "/api/outbound/usage"], "Saved");
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const cfg = data.config;
  const val = (k: string, fallback: unknown) => (draft && k in draft ? draft[k] : String(fallback ?? ""));
  const edit = (k: string, v: string) => setDraft({ ...(draft ?? {}), [k]: v });
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const allowKey = (tier: string, f: string) => `a:${tier}:${f}`;
  const saveAllowances = () => {
    const out: any = { free: {}, pro: {} };
    for (const tier of ["free", "pro"]) for (const [f] of ALLOWANCE_ROWS) {
      const k = allowKey(tier, f); const raw = draft && k in draft ? draft[k] : String(cfg.allowances?.[tier]?.[f] ?? "");
      out[tier][f] = num(raw);
    }
    set.mutate({ key: "allowances", value: out });
  };
  const diverges = (tier: string, f: string) => { const o = cfg.allowances?.[tier]?.[f]; return o != null && o !== data.allowances.codeDefaults[tier][f]; };
  const anyDiverges = ["free", "pro"].some((t) => ALLOWANCE_ROWS.some(([f]) => diverges(t, f)));
  return (
    <div className="space-y-5" data-testid="admin-rules">
      <div><Label>Reason for the next change (kept in the audit log)</Label><Input className={field} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} data-testid="rules-reason" /></div>

      <Card className="glass-card"><CardContent className="space-y-3 p-4">
        <p className="font-semibold">Monthly allowances</p>
        <p className="text-xs text-muted-foreground">Blank = no override (the environment value, then the built-in default, applies). The numbers shown as the placeholder are what applies right now.</p>
        <table className="w-full text-sm"><thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground"><th className="py-1 font-medium">Allowance</th><th className="font-medium">Free</th><th className="font-medium">Pro</th></tr></thead>
          <tbody>{ALLOWANCE_ROWS.map(([f, label]) => (
            <tr key={f}><td className="py-1 pr-3">{label}</td>
              {["free", "pro"].map((tier) => (
                <td key={tier} className="pr-2"><Input className={`${field} w-28`} inputMode="numeric" placeholder={String(data.allowances.effective[tier][f])} value={val(allowKey(tier, f), cfg.allowances?.[tier]?.[f])} onChange={(e) => edit(allowKey(tier, f), e.target.value)} data-testid={`allow-${tier}-${f}`} />
                  {diverges(tier, f) && <span className="ml-1 text-[11px] text-amber-700 dark:text-amber-400">default {data.allowances.codeDefaults[tier][f]}</span>}</td>
              ))}</tr>
          ))}</tbody></table>
        {anyDiverges && <p className="text-xs text-amber-700 dark:text-amber-400" role="status" data-testid="allow-diverges">An override changes what people get, but the public pricing and landing pages quote the built-in defaults (shared/outbound-plans.ts). Change those in code too, or the pages will say something different.</p>}
        <Button size="sm" disabled={set.isPending} onClick={saveAllowances} data-testid="allow-save">Save allowances</Button>
      </CardContent></Card>

      <Card className="glass-card"><CardContent className="space-y-3 p-4">
        <p className="font-semibold">Notifications</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label>Warn at (% used)</Label><Input className={field} inputMode="numeric" value={val("warn", cfg.warnPercent)} onChange={(e) => edit("warn", e.target.value)} data-testid="cfg-warn" /></div>
          <div className="flex items-end gap-2"><Switch checked={draft?.notifyWarn !== undefined ? draft.notifyWarn === "1" : cfg.notify.warn} onCheckedChange={(v) => edit("notifyWarn", v ? "1" : "0")} id="n-warn" /><Label htmlFor="n-warn">Show the warning</Label></div>
          <div className="flex items-end gap-2"><Switch checked={draft?.notifyEx !== undefined ? draft.notifyEx === "1" : cfg.notify.exhausted} onCheckedChange={(v) => edit("notifyEx", v ? "1" : "0")} id="n-ex" /><Label htmlFor="n-ex">Offer top-up at 100%</Label></div>
        </div>
        <Button size="sm" disabled={set.isPending} onClick={() => { set.mutate({ key: "warn_percent", value: Number(val("warn", cfg.warnPercent)) }); set.mutate({ key: "notify", value: { warn: draft?.notifyWarn !== undefined ? draft.notifyWarn === "1" : cfg.notify.warn, exhausted: draft?.notifyEx !== undefined ? draft.notifyEx === "1" : cfg.notify.exhausted } }); }} data-testid="cfg-notify-save">Save notifications</Button>
      </CardContent></Card>

      <Card className="glass-card"><CardContent className="space-y-3 p-4">
        <p className="font-semibold">Credit costs and spend headroom</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div><Label>Credits per search</Label><Input className={field} inputMode="numeric" value={val("cs", cfg.creditCost.search)} onChange={(e) => edit("cs", e.target.value)} data-testid="cfg-cost-search" /></div>
          <div><Label>Credits per AI draft</Label><Input className={field} inputMode="numeric" value={val("cd", cfg.creditCost.draft)} onChange={(e) => edit("cd", e.target.value)} data-testid="cfg-cost-draft" /></div>
          <div><Label>Spend headroom per search credit ($)</Label><Input className={field} inputMode="decimal" value={val("hs", cfg.spendHeadroomUsd.search)} onChange={(e) => edit("hs", e.target.value)} /></div>
          <div><Label>Per draft credit ($)</Label><Input className={field} inputMode="decimal" value={val("hd", cfg.spendHeadroomUsd.draft)} onChange={(e) => edit("hd", e.target.value)} /></div>
        </div>
        <p className="text-xs text-muted-foreground">The cost applies to purchased credits only; plan allowances always count actions. Headroom raises a workspace&apos;s AI spend ceiling by this much for each purchased credit it actually spends.</p>
        <Button size="sm" disabled={set.isPending} onClick={() => { set.mutate({ key: "credit_cost", value: { search: Number(val("cs", cfg.creditCost.search)), draft: Number(val("cd", cfg.creditCost.draft)) } }); set.mutate({ key: "spend_headroom_usd", value: { search: Number(val("hs", cfg.spendHeadroomUsd.search)), draft: Number(val("hd", cfg.spendHeadroomUsd.draft)) } }); }} data-testid="cfg-cost-save">Save costs</Button>
      </CardContent></Card>

      <Card className="glass-card"><CardContent className="space-y-3 p-4">
        <p className="font-semibold">Expiry and reset rules</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label>New packs expire after (months, empty = never)</Label><Input className={field} inputMode="numeric" value={val("exp", cfg.defaultExpiryMonths)} onChange={(e) => edit("exp", e.target.value)} data-testid="cfg-expiry" /></div>
        </div>
        <Button size="sm" disabled={set.isPending} onClick={() => set.mutate({ key: "default_expiry_months", value: num(val("exp", cfg.defaultExpiryMonths)) })} data-testid="cfg-expiry-save">Save expiry default</Button>
        <p className="text-xs text-muted-foreground" data-testid="cfg-reset-rule">Plan allowances reset on a <strong>rolling {data.resetRule.windowDays}-day window</strong>: each use frees up {data.resetRule.windowDays} days after it was made. This is shown, not editable here: changing the window re-counts everyone&apos;s usage at once and is a deliberate code change.</p>
      </CardContent></Card>
    </div>
  );
}

/* ── Accounts ──────────────────────────────────────────────────────────────── */
function AccountDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useQuery<any>({ queryKey: [`/api/admin/users/${id}`] });
  const [action, setAction] = useState<"grant" | "deduct">("grant");
  const [kind, setKind] = useState<CreditKind>("search");
  const [units, setUnits] = useState("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const { toast } = useToast();
  const op = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/users/${id}/credits`, { action, kind, units: Number(units), reason, requestId: requestId.current, ...(action === "grant" && days.trim() ? { expiresInDays: Number(days) } : {}) })).json(),
    onSuccess: (r: any) => {
      toast({ title: r.replay ? "Already applied" : action === "grant" ? "Credits granted" : `Removed ${r.removed} credit${r.removed === 1 ? "" : "s"}` });
      requestId.current = crypto.randomUUID(); setUnits(""); setReason(""); setDays("");
      void queryClient.invalidateQueries({ queryKey: [`/api/admin/users/${id}`] }); void queryClient.invalidateQueries({ queryKey: ["/api/admin/audit"] });
    },
    onError: (e) => toast({ title: "Couldn't apply", description: parseApiError(e).error ?? "Something went wrong.", variant: "destructive" }),
  });
  const u = data?.user, w = data?.wallet;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="admin-account">
        <DialogHeader><DialogTitle>{u?.email ?? "Account"}</DialogTitle><DialogDescription>{u ? `${u.tier} plan · ${u.orgRole}${u.planExpiresAt ? ` · Pro until ${dayLabel(u.planExpiresAt)}` : ""}` : "Loading…"}</DialogDescription></DialogHeader>
        {w && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              {kinds.map((k) => <div key={k} className="rounded-lg border p-2"><p className="font-semibold">{kindLabel(k)}</p>
                <p className="text-muted-foreground">Plan: {(k === "search" ? w.plan?.searches : w.plan?.drafts)?.used ?? "–"} of {(k === "search" ? w.plan?.searches : w.plan?.drafts)?.limit ?? "–"} used</p>
                <p className="text-muted-foreground">Purchased: <strong className="text-foreground" data-testid={`admin-balance-${k}`}>{w.credits[k].balance}</strong></p></div>)}
            </div>
            <p className="font-semibold">Recent credit movements</p>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
              {w.ledger.slice(0, 20).map((r: any) => <li key={r.id} className="flex justify-between gap-2"><span>{dayLabel(r.createdAt)} · {LEDGER_LABEL[r.reason] ?? r.reason} · {r.kind}{r.note ? ` · ${r.note}` : ""}</span><span className="tabular-nums">{r.delta > 0 ? `+${r.delta}` : r.delta}</span></li>)}
              {!w.ledger.length && <li className="text-muted-foreground">None yet.</li>}
            </ul>
            <p className="font-semibold">Purchases</p>
            <ul className="space-y-0.5 text-xs">{w.purchases.map((p: any) => <li key={p.orderId}>{p.createdAt ? dayLabel(p.createdAt) : "–"} · {p.units} {creditNoun(p.kind, p.units)} · {formatRupees(p.priceRupees)} · {p.status}</li>)}{!w.purchases.length && <li className="text-muted-foreground">None.</li>}</ul>
          </div>
        )}
        {u?.organizationId ? (
          <div className="space-y-2 rounded-lg border p-3" data-testid="admin-credit-form">
            <p className="text-sm font-semibold">Grant or deduct credits</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <select className={`${field} rounded-md border bg-background px-2`} value={action} onChange={(e) => setAction(e.target.value as any)} data-testid="op-action"><option value="grant">Grant</option><option value="deduct">Deduct</option></select>
              <select className={`${field} rounded-md border bg-background px-2`} value={kind} onChange={(e) => setKind(e.target.value as CreditKind)} data-testid="op-kind">{kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}</select>
              <Input className={field} inputMode="numeric" placeholder="How many" value={units} onChange={(e) => setUnits(e.target.value)} data-testid="op-units" />
              {action === "grant" && <Input className={field} inputMode="numeric" placeholder="Expires in days (optional)" value={days} onChange={(e) => setDays(e.target.value)} />}
            </div>
            <Input className={field} placeholder="Reason (required, at least 5 characters; kept in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} data-testid="op-reason" />
            <Button size="sm" disabled={op.isPending || reason.trim().length < 5 || !Number(units)} onClick={() => op.mutate()} data-testid="op-submit">{action === "grant" ? "Grant credits" : "Deduct credits"}</Button>
          </div>
        ) : u ? <p className="text-sm text-muted-foreground">This account has no workspace to hold credits.</p> : null}
      </DialogContent>
    </Dialog>
  );
}

function Accounts() {
  const [q, setQ] = useState(""), [plan, setPlan] = useState(""), [withCredits, setWithCredits] = useState(false), [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const qs = new URLSearchParams({ q, page: String(page), ...(plan ? { plan } : {}), ...(withCredits ? { credits: "1" } : {}) }).toString();
  const { data } = useQuery<any>({ queryKey: [`/api/admin/users?${qs}`] });
  return (
    <div className="space-y-3" data-testid="admin-accounts">
      <div className="flex flex-wrap items-center gap-2">
        <Input className={`${field} max-w-xs`} placeholder="Search email, name, user or workspace id" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="admin-search" />
        <select className={`${field} rounded-md border bg-background px-2`} value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1); }}><option value="">Any plan</option><option value="pro">Pro</option><option value="free">Free</option></select>
        <label className="flex items-center gap-1.5 text-sm"><Switch checked={withCredits} onCheckedChange={(v) => { setWithCredits(v); setPage(1); }} />Holding credits</label>
      </div>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[40rem] text-sm">
          <thead><tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground"><th className="py-1.5 pr-3 font-medium">Account</th><th className="px-2 font-medium">Plan</th><th className="px-2 text-right font-medium">Search credits</th><th className="px-2 text-right font-medium">Draft credits</th><th /></tr></thead>
          <tbody>{(data?.users ?? []).map((u: any) => (
            <tr key={u.id} className="border-b last:border-0"><td className="py-1.5 pr-3">{u.email ?? u.id}<span className="block text-[11px] text-muted-foreground">{[u.first_name, u.last_name].filter(Boolean).join(" ")} · {u.org_role}</span></td>
              <td className="px-2">{u.plan === "pro" && u.plan_expires_at && new Date(u.plan_expires_at) > new Date() ? "Pro" : "Free"}</td><td className="px-2 text-right tabular-nums">{u.search_credits}</td><td className="px-2 text-right tabular-nums">{u.draft_credits}</td>
              <td className="py-1 text-right"><Button size="sm" variant="outline" onClick={() => setOpen(u.id)} data-testid={`admin-open-${u.id}`}>Open</Button></td></tr>
          ))}</tbody>
        </table>
      </div>
      {data && <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{data.total} account{data.total === 1 ? "" : "s"}</span><span className="space-x-1"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button></span></div>}
      {open && <AccountDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ── Audit ─────────────────────────────────────────────────────────────────── */
function Audit() {
  const { data } = useQuery<{ entries: { id: number; adminUserId: string; action: string; target: string | null; reason: string | null; detail: unknown; createdAt: string }[] }>({ queryKey: ["/api/admin/audit"] });
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <ul className="space-y-1.5 text-xs" data-testid="admin-audit">
      {data.entries.map((e) => <li key={e.id} className="rounded-lg border p-2"><span className="font-semibold">{e.action}</span> · {e.target ?? "–"} · {new Date(e.createdAt).toLocaleString()}{e.reason ? <span className="block text-muted-foreground">Reason: {e.reason}</span> : null}<details className="mt-0.5 text-muted-foreground"><summary className="cursor-pointer">Detail</summary><pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(e.detail, null, 1)}</pre></details></li>)}
      {!data.entries.length && <li className="text-muted-foreground">No changes yet.</li>}
    </ul>
  );
}

export default function AdminCreditsPage() {
  const { user, isLoading } = useAuth();
  // Display gate only: every /api/admin route re-checks on the server.
  if (isLoading) return null;
  if (!(user as { platformAdmin?: boolean } | undefined)?.platformAdmin) return <NotFound />;
  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 flex items-center gap-3 px-4 py-3 lg:mx-auto lg:max-w-[1600px] lg:px-8 lg:py-5">
        <Link href="/dashboard"><Button variant="ghost" size="icon" data-testid="button-back"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold lg:text-2xl"><Shield className="h-5 w-5 text-primary" aria-hidden />Credits admin</h1>
      </header>
      <main className="p-4 lg:mx-auto lg:max-w-[1200px] lg:px-8 lg:py-6">
        <Tabs defaultValue="overview">
          <TabsList className="mb-4 flex-wrap"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="packs">Packs</TabsTrigger><TabsTrigger value="rules">Allowances &amp; rules</TabsTrigger><TabsTrigger value="accounts">Accounts</TabsTrigger><TabsTrigger value="audit">Audit log</TabsTrigger></TabsList>
          <TabsContent value="overview"><Overview /></TabsContent>
          <TabsContent value="packs"><Packs /></TabsContent>
          <TabsContent value="rules"><Rules /></TabsContent>
          <TabsContent value="accounts"><Accounts /></TabsContent>
          <TabsContent value="audit"><Audit /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
