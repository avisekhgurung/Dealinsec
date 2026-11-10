/**
 * Client profiles (the /api/client-profiles endpoints): who you want as clients, saved and named.
 *
 * Two jobs on the Client Radar page:
 *   - start a search from a saved profile in one click. The server turns the profile into the same search proposal a
 *     typed request gets, by plain rules (no AI call), and the person still confirms every chip before anything runs;
 *   - keep the profiles: create one from a starting point (freelancer, marketing agency, software agency) or from
 *     blank, edit, copy, set a default, delete.
 *
 * On a server where the feature isn't set up the whole thing renders nothing: Client Radar works as before.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import { Copy, Loader2, Pencil, Plus, Settings2, Star, Trash2, UserRoundSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { leadCall, leadError } from "@/lib/leads";
import { COUNTRY_NAME, countryName, type ParsedIcp } from "@/lib/outbound";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { OUTREACH_CHANNELS, OUTREACH_CHANNEL_LABEL, OUTREACH_TONES, OUTREACH_TONE_LABEL, PROFILE_KIND_LABEL, type AcquisitionProfile, type AcquisitionProfileInput, type OutreachChannel, type OutreachTone, type ProfileKind } from "@shared/acquisition-profile";
import { REQUIREMENT_HELP, REQUIREMENT_KEYS, REQUIREMENT_LABEL, WANTED_SIGNALS, type RequirementKey, type WantedSignal } from "@shared/profile-keys";
import { SIGNAL_LABEL } from "@shared/prospect";

export const CLIENT_PROFILES_URL = "/api/client-profiles";
interface ProfilesResponse { profiles: AcquisitionProfile[]; max: number; templates: { kind: Exclude<ProfileKind, "custom">; label: string; note: string }[] }
type Draft = AcquisitionProfileInput & { id?: number };

const BLANK: Draft = {
  name: "", kind: "custom", services: [], industries: [], keywords: [], countries: ["IN"], locations: [], employeeMin: null, employeeMax: null, exclusions: [],
  signals: [], requirements: [], roles: [], outreach: { channels: ["email"], tone: "friendly", note: "" },
};
const chipCls = "rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-left text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
const sizeLine = (p: Pick<AcquisitionProfile, "employeeMin" | "employeeMax">) => (p.employeeMin && p.employeeMax ? `${p.employeeMin}–${p.employeeMax} people` : p.employeeMax ? `up to ${p.employeeMax} people` : p.employeeMin ? `${p.employeeMin}+ people` : "");
/** One line a person can read at a glance: "D2C brand, edtech company · India · 5–200 people". */
export const profileLine = (p: AcquisitionProfile) => [p.industries.slice(0, 3).join(", ") + (p.industries.length > 3 ? ` +${p.industries.length - 3}` : ""), [...p.countries.map(countryName), ...p.locations].join(", "), sizeLine(p)].filter(Boolean).join(" · ");

/** Short phrases as chips: Enter or a comma adds one, the × removes it. */
function TagField({ id, label, hint, value, onChange, max, maxLength = 60, placeholder }: { id: string; label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; max: number; maxLength?: number; placeholder?: string }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(",").map((x) => x.replace(/\s+/g, " ").trim().slice(0, maxLength)).filter(Boolean);
    if (parts.length) { const have = new Set(value.map((x) => x.toLowerCase())); const next = [...value]; for (const p of parts) if (!have.has(p.toLowerCase()) && next.length < max) { have.add(p.toLowerCase()); next.push(p); } onChange(next); }
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label} {hint && <span className="font-normal text-muted-foreground">· {hint}</span>}</label>
      {value.length > 0 && <div className="flex flex-wrap gap-1.5">{value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs">{v}<button type="button" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove ${v}`}><X className="h-3 w-3" /></button></span>
      ))}</div>}
      <Input id={id} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={add} maxLength={maxLength * 3} disabled={value.length >= max}
        placeholder={value.length >= max ? `Up to ${max}` : placeholder ?? "Type one and press Enter"} data-testid={`profile-${id}`} />
    </div>
  );
}

const Toggle = ({ on, onClick, children, title, testId }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string; testId?: string }) => (
  <button type="button" role="checkbox" aria-checked={on} onClick={onClick} title={title} data-testid={testId}
    className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", on ? "border-emerald-600 bg-emerald-600 text-white" : "bg-background hover:bg-muted")}>{children}</button>
);
const flip = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
const numOrNull = (v: string) => { const n = Math.floor(Number(v)); return v.trim() && Number.isFinite(n) && n > 0 ? n : null; };

function Editor({ draft, onChange, onSave, onCancel, saving }: { draft: Draft; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void; saving: boolean }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const canSave = draft.name.trim().length > 0 && draft.industries.length > 0 && !(draft.requirements.includes("wanted_signal") && !draft.signals.length);
  return (
    <div className="space-y-5" data-testid="profile-editor">
      <div className="space-y-1.5">
        <label htmlFor="profile-name" className="text-sm font-medium">Name</label>
        <Input id="profile-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} placeholder="For example: D2C brands in Bengaluru" data-testid="profile-name" />
      </div>

      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Who to look for</h4>
        <TagField id="industries" label="Kinds of company" hint="a search covers one kind at a time" value={draft.industries} onChange={(industries) => set({ industries })} max={8} maxLength={80} placeholder="D2C brand, edtech company…" />
        <TagField id="keywords" label="Other words they use for themselves" hint="optional" value={draft.keywords} onChange={(keywords) => set({ keywords })} max={8} placeholder="online store, consumer brand…" />
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Countries <span className="font-normal text-muted-foreground">· none means worldwide</span></span>
          <div className="flex flex-wrap items-center gap-1.5">
            {draft.countries.map((c) => <span key={c} className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs">{countryName(c)}<button type="button" onClick={() => set({ countries: draft.countries.filter((x) => x !== c) })} aria-label={`Remove ${countryName(c)}`}><X className="h-3 w-3" /></button></span>)}
            <select value="" disabled={draft.countries.length >= 5} onChange={(e) => { const c = e.target.value; if (c && !draft.countries.includes(c)) set({ countries: [...draft.countries, c] }); }}
              className="h-8 w-auto rounded-md border bg-background px-2 text-xs" aria-label="Add a country" data-testid="profile-add-country">
              <option value="">+ Add a country</option>
              {Object.entries(COUNTRY_NAME).filter(([c]) => !draft.countries.includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </div>
        </div>
        <TagField id="locations" label="Cities or regions" hint="optional" value={draft.locations} onChange={(locations) => set({ locations })} max={5} placeholder="Bengaluru, Pune…" />
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Company size <span className="font-normal text-muted-foreground">· people, optional</span></span>
          <div className="flex items-center gap-2 text-sm">
            <Input type="number" min={1} value={draft.employeeMin ?? ""} onChange={(e) => set({ employeeMin: numOrNull(e.target.value) })} className="w-24" placeholder="From" aria-label="Smallest company size" data-testid="profile-size-min" />
            <span className="text-muted-foreground">to</span>
            <Input type="number" min={1} value={draft.employeeMax ?? ""} onChange={(e) => set({ employeeMax: numOrNull(e.target.value) })} className="w-24" placeholder="To" aria-label="Largest company size" data-testid="profile-size-max" />
          </div>
          {draft.employeeMin !== null && draft.employeeMax !== null && draft.employeeMin > draft.employeeMax && <p className="text-xs text-rose-600">The smallest size must not be bigger than the largest.</p>}
        </div>
        <TagField id="exclusions" label="Never show me" hint="optional" value={draft.exclusions} onChange={(exclusions) => set({ exclusions })} max={10} placeholder="gambling, government…" />
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">What you sell, and to whom</h4>
        <TagField id="services" label="Services you offer them" hint="also finds businesses asking for this work" value={draft.services} onChange={(services) => set({ services })} max={6} placeholder="SEO, Shopify development…" />
        <TagField id="roles" label="Who to reach there" hint="most relevant first" value={draft.roles} onChange={(roles) => set({ roles })} max={6} placeholder="Founder, Head of Marketing…" />
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">What makes a company worth your time</h4>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Buying signals you care about</span>
          <div className="flex flex-wrap gap-1.5" data-testid="profile-signals">
            {WANTED_SIGNALS.map((s) => <Toggle key={s} on={draft.signals.includes(s)} onClick={() => set({ signals: flip<WantedSignal>(draft.signals, s) })} testId={`profile-signal-${s}`}>{SIGNAL_LABEL[s]}</Toggle>)}
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">A company must have</span>
          <ul className="space-y-1.5" data-testid="profile-requirements">
            {REQUIREMENT_KEYS.map((k) => (
              <li key={k}>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={draft.requirements.includes(k)} onChange={() => set({ requirements: flip<RequirementKey>(draft.requirements, k) })} data-testid={`profile-req-${k}`} />
                  <span><span className="font-medium">{REQUIREMENT_LABEL[k]}</span><span className="block text-xs text-muted-foreground">{REQUIREMENT_HELP[k]}</span></span>
                </label>
              </li>
            ))}
          </ul>
          {draft.requirements.includes("wanted_signal") && !draft.signals.length && <p className="text-xs text-rose-600">Tick at least one buying signal above, or untick "One of your buying signals".</p>}
          <p className="text-xs text-muted-foreground">These are checked against the evidence found for each company and shown on its card. They never hide a company by themselves, and they don't change its score or "Ready".</p>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">How you like to reach out</h4>
        <div className="flex flex-wrap items-center gap-1.5">
          {OUTREACH_CHANNELS.map((c) => <Toggle key={c} on={draft.outreach.channels.includes(c)} onClick={() => set({ outreach: { ...draft.outreach, channels: flip<OutreachChannel>(draft.outreach.channels, c) } })} testId={`profile-channel-${c}`}>{OUTREACH_CHANNEL_LABEL[c]}</Toggle>)}
          <select value={draft.outreach.tone} onChange={(e) => set({ outreach: { ...draft.outreach, tone: e.target.value as OutreachTone } })} className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Tone" data-testid="profile-tone">
            {OUTREACH_TONES.map((t) => <option key={t} value={t}>{OUTREACH_TONE_LABEL[t]}</option>)}
          </select>
        </div>
        <Textarea value={draft.outreach.note} onChange={(e) => set({ outreach: { ...draft.outreach, note: e.target.value } })} rows={2} maxLength={280} placeholder="A note for your messages to these clients, for example: mention our Shopify work (optional)" aria-label="Note for messages" data-testid="profile-note" />
        <p className="text-xs text-muted-foreground">The tone and the note shape the AI drafts written for leads found from this profile, and for campaigns built for it. Every draft is still checked by the same rules, and you read it before anything is sent. The channels are saved for later: a campaign sends by email only.</p>
      </section>

      <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex items-center gap-2 border-t bg-background px-6 py-3">
        <Button onClick={onSave} disabled={!canSave || saving} className="gradient-btn text-white" data-testid="profile-save">{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save profile</Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}

export function ClientProfiles({ disabled, onUse }: { disabled?: boolean; onUse: (p: ParsedIcp & { profileName: string }) => void }) {
  const { toast } = useToast();
  const q = useQuery<ProfilesResponse>({ queryKey: [CLIENT_PROFILES_URL], retry: false, staleTime: 30_000 });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [CLIENT_PROFILES_URL] });
  const oops = (title: string) => (e: unknown) => toast({ title, description: leadError(e), variant: "destructive" });

  const use = useMutation({
    mutationFn: ({ p, industry }: { p: AcquisitionProfile; industry?: string }) => leadCall<ParsedIcp>("POST", `${CLIENT_PROFILES_URL}/${p.id}/search`, { industry }).then((r) => ({ ...r, profileName: p.name })),
    onSuccess: (r) => { trackEvent("outbound_client_profile_used"); setPicking(null); onUse(r); },
    onError: oops("Couldn't start from that profile"),
  });
  const save = useMutation({
    mutationFn: (d: Draft) => { const { id, ...body } = d; return id ? leadCall("PATCH", `${CLIENT_PROFILES_URL}/${id}`, body) : leadCall("POST", CLIENT_PROFILES_URL, body); },
    onSuccess: (_r, d) => { trackEvent(d.id ? "client_profile_updated" : "client_profile_created", { kind: d.kind }); setDraft(null); void refresh(); toast({ title: "Profile saved" }); },
    onError: oops("Couldn't save the profile"),
  });
  const fromTemplate = useMutation({
    mutationFn: (kind: string) => leadCall<{ profile: AcquisitionProfile }>("POST", `${CLIENT_PROFILES_URL}/from-template`, { kind }),
    // Opens straight in the editor: a starting point is a suggestion to change, not a finished profile.
    onSuccess: (r) => { trackEvent("client_profile_created", { kind: r.profile.kind, from: "template" }); void refresh(); const { isDefault: _d, createdAt: _c, updatedAt: _u, ...d } = r.profile; setDraft(d); },
    onError: oops("Couldn't create the profile"),
  });
  const act = useMutation({
    mutationFn: ({ p, action }: { p: AcquisitionProfile; action: "duplicate" | "delete" | "default" }) =>
      action === "duplicate" ? leadCall("POST", `${CLIENT_PROFILES_URL}/${p.id}/duplicate`, {}) : action === "delete" ? leadCall("DELETE", `${CLIENT_PROFILES_URL}/${p.id}`) : leadCall("PATCH", `${CLIENT_PROFILES_URL}/${p.id}`, { isDefault: !p.isDefault }),
    onSuccess: () => void refresh(),
    onError: oops("That didn't work"),
  });

  // Not set up on this server (or not readable): Client Radar simply shows no profiles.
  if (!q.data) return null;
  const { profiles, templates, max } = q.data;
  const ordered = [...profiles].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const start = (p: AcquisitionProfile) => (p.industries.length > 1 ? setPicking(picking === p.id ? null : p.id) : use.mutate({ p }));
  const pickFor = profiles.find((p) => p.id === picking) ?? null;

  return (
    <div className="space-y-1.5" data-testid="client-profiles">
      <p className="text-xs font-medium text-muted-foreground">{profiles.length ? "Your client profiles — one click starts a search you can still edit:" : "Save who you look for as a client profile, and start searches from it in one click:"}</p>
      <div className="flex flex-wrap items-center gap-2">
        {ordered.map((p) => (
          <button key={p.id} type="button" onClick={() => start(p)} disabled={disabled || use.isPending} title={profileLine(p)} aria-expanded={p.industries.length > 1 ? picking === p.id : undefined} className={chipCls} data-testid="client-profile-chip">
            {p.isDefault && <Star className="-mt-0.5 mr-1 inline h-3 w-3 fill-current" aria-label="Default" />}{p.name}
          </button>
        ))}
        {!profiles.length && templates.map((t) => (
          <button key={t.kind} type="button" onClick={() => { setOpen(true); fromTemplate.mutate(t.kind); }} disabled={fromTemplate.isPending} title={t.note} className={chipCls} data-testid="client-profile-template">I'm a {t.label.toLowerCase()}</button>
        ))}
        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setDraft(null); setOpen(true); }} data-testid="client-profiles-manage"><Settings2 className="mr-1 h-3.5 w-3.5" />{profiles.length ? "Manage profiles" : "Create one"}</Button>
      </div>
      {pickFor && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs" data-testid="client-profile-pick-kind">
          <span className="text-muted-foreground">Which kind of company this time?</span>
          {pickFor.industries.map((k) => <button key={k} type="button" onClick={() => use.mutate({ p: pickFor, industry: k })} disabled={disabled || use.isPending} className="rounded-full border bg-background px-3 py-1 font-medium hover:bg-muted" data-testid="client-profile-kind">{k}</button>)}
          {use.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Working" />}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setDraft(null); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="client-profiles-dialog">
          <DialogHeader>
            <DialogTitle>{draft ? (draft.id ? "Edit profile" : "New client profile") : "Client profiles"}</DialogTitle>
            <DialogDescription>{draft ? "Who you want as clients, in your own words. Nothing is searched until you start a search." : "Save each kind of client you go after. Starting a search from a profile uses no AI and none of your allowance until you confirm it."}</DialogDescription>
          </DialogHeader>
          {draft ? <Editor draft={draft} onChange={setDraft} onSave={() => save.mutate(draft)} onCancel={() => setDraft(null)} saving={save.isPending} /> : (
            <div className="space-y-4">
              {profiles.length === 0 && <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No profiles yet. Pick a starting point below and change anything.</p>}
              {profiles.length > 0 && (
                <ul className="divide-y rounded-xl border" data-testid="client-profiles-list">
                  {ordered.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" data-testid="client-profile-row">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-semibold"><span className="truncate">{p.name}</span>
                          {p.isDefault && <span className="rounded-full bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:text-emerald-300">Default</span>}
                          {p.kind !== "custom" && <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">{PROFILE_KIND_LABEL[p.kind]}</span>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{profileLine(p)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => act.mutate({ p, action: "default" })} disabled={act.isPending} title={p.isDefault ? "Remove as default" : "Make default"} aria-label={p.isDefault ? `Remove ${p.name} as default` : `Make ${p.name} the default`} data-testid="client-profile-default"><Star className={cn("h-4 w-4", p.isDefault && "fill-current text-emerald-600")} /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { const { isDefault: _d, createdAt: _c, updatedAt: _u, ...d } = p; setDraft(d); }} title="Edit" aria-label={`Edit ${p.name}`} data-testid="client-profile-edit"><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => act.mutate({ p, action: "duplicate" })} disabled={act.isPending || profiles.length >= max} title="Copy" aria-label={`Copy ${p.name}`} data-testid="client-profile-duplicate"><Copy className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => { if (window.confirm(`Delete "${p.name}"? Searches you already ran from it stay.`)) act.mutate({ p, action: "delete" }); }} disabled={act.isPending} title="Delete" aria-label={`Delete ${p.name}`} data-testid="client-profile-delete"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {profiles.length < max ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Add a profile</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {templates.map((t) => (
                      <button key={t.kind} type="button" onClick={() => fromTemplate.mutate(t.kind)} disabled={fromTemplate.isPending} className="rounded-xl border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-50" data-testid={`client-profile-template-${t.kind}`}>
                        <span className="flex items-center gap-1.5 text-sm font-semibold"><UserRoundSearch className="h-4 w-4 text-emerald-600" aria-hidden />{t.label}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{t.note}</span>
                      </button>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setDraft({ ...BLANK })} data-testid="client-profile-blank"><Plus className="mr-1.5 h-3.5 w-3.5" />Start from blank</Button>
                </div>
              ) : <p className="text-xs text-muted-foreground">A workspace can keep {max} profiles. Delete one to add another.</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
