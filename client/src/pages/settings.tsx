/**
 * Settings — Organization, Team Members, Invitations, Activity, Subscription.
 *
 * One page with a left tab rail (desktop) / top tab strip (mobile). What each
 * member can DO is role-gated with the shared permission map; the server is
 * the authority, this only hides what would 403 anyway.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { BottomNav } from "@/components/bottom-nav";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseApiError } from "@/lib/api-error";
import {
  memberCan, ROLE_META, INVITABLE_ROLES, PERMISSION_MATRIX,
  type OrgRole, type Permission,
} from "@shared/permissions";
import {
  ArrowLeft, Building2, Users, ScrollText, CreditCard, UserPlus, Crown,
  Mail, RotateCw, Trash2, Loader2, Sparkles, Rocket, Sun, Moon, Monitor, Download,
  SlidersHorizontal, Check, Shield, Pencil, Plus,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";
import { DateRangeFilter, ALL_TIME, inRange, type DateRange } from "@/components/date-range-filter";

/** Entity tints for the activity table — money events read green, documents
 *  blue/teal, people violet; everything else stays neutral. */
const ACTIVITY_TONE: Record<string, string> = {
  deal: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  quotation: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400",
  agreement: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  invoice: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  member: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400",
  organization: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  default: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};
const ACTION_TONE = (action: string) => {
  if (/paid|received|completed|signed/i.test(action)) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  if (/removed|deleted|revoked/i.test(action)) return "bg-rose-500/15 text-rose-700 dark:text-rose-400";
  if (/created|generated|invited/i.test(action)) return "bg-primary/10 text-primary";
  return "bg-muted text-muted-foreground";
};

type Tab = "organization" | "team" | "activity" | "subscription" | "preferences";

interface OrgSummary {
  id: string; name: string; slug: string | null; industry: string | null;
  seatLimit: number; seatsUsed: number; pendingInvites: number;
  ownerPlan: string; ownerPlanExpiresAt: string | null;
  ownerOnTrial?: boolean; ownerTrialEndsAt?: string | null;
  extraSeats: number; extraSeatsExpiresAt: string | null;
}
interface Member {
  id: string; firstName: string | null; lastName: string | null; email: string;
  avatar: string | null; orgRole: OrgRole | "CUSTOM"; memberStatus: string; joinedAt: string | null;
  customRoleId: string | null; customRoleName: string | null;
}
interface CustomRole {
  id: string; name: string; permissions: string[];
  usage: { members: number; invites: number };
}
interface Invite {
  id: number; email: string; orgRole: OrgRole; createdAt: string; expiresAt: string;
}
interface Activity {
  id: number; userName: string | null; action: string; entityType: string;
  detail: string | null; createdAt: string;
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("organization");
  // Theme is a per-device preference (localStorage), not an account setting.
  const [activityRange, setActivityRange] = useState<DateRange>(ALL_TIME);
  const [themePref, setThemePrefState] = useState<ThemePref>(() => getThemePref());
  const chooseTheme = (t: ThemePref) => {
    setThemePref(t);
    setThemePrefState(t);
  };

  const myRole = (user as any)?.orgRole as OrgRole | undefined;
  const me = { orgRole: myRole, customPermissions: (user as any)?.customPermissions as string[] | undefined };
  const isOwner = myRole === "OWNER";
  const canInvite = memberCan(me, "team.invite");
  const canManageTeam = memberCan(me, "team.manage");
  const canEditOrg = memberCan(me, "org.settings");
  const canBilling = memberCan(me, "billing.manage");
  const canActivity = memberCan(me, "activity.view");

  const { data: org, isLoading: orgLoading } = useQuery<OrgSummary>({ queryKey: ["/api/org"] });
  const { data: members = [] } = useQuery<Member[]>({ queryKey: ["/api/org/members"] });
  const { data: invites = [] } = useQuery<Invite[]>({
    queryKey: ["/api/org/invitations"],
    enabled: canInvite,
  });
  const [activityPage, setActivityPage] = useState(0);
  const ACTIVITY_PAGE_SIZE = 20;
  const { data: activity = [] } = useQuery<Activity[]>({
    queryKey: ["/api/org/activity"],
    enabled: canActivity && tab === "activity",
  });
  const { data: customRoles = [] } = useQuery<CustomRole[]>({
    queryKey: ["/api/org/roles"],
    enabled: canManageTeam,
  });

  // ── Custom-role editor (owner only) ──
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleName, setRoleName] = useState("");
  const [rolePerms, setRolePerms] = useState<string[]>([]);
  const openRoleEditor = (role?: CustomRole) => {
    setEditingRoleId(role?.id ?? null);
    setRoleName(role?.name ?? "");
    setRolePerms(role?.permissions ?? []);
    setRoleDialogOpen(true);
  };
  const togglePerm = (perm: Permission) =>
    setRolePerms((prev) => (prev.includes(perm) ? prev.filter((x) => x !== perm) : [...prev, perm]));
  const saveRole = useMutation({
    mutationFn: async () =>
      (await apiRequest(
        editingRoleId ? "PATCH" : "POST",
        editingRoleId ? `/api/org/roles/${editingRoleId}` : "/api/org/roles",
        { name: roleName.trim(), permissions: rolePerms },
      )).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/members"] });
      setRoleDialogOpen(false);
      toast({ title: editingRoleId ? "Role updated" : "Role created" });
    },
    onError: (err) => toast({ title: "Could not save role", description: parseApiError(err).error || "Please try again.", variant: "destructive" }),
  });
  const deleteRole = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/org/roles/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/roles"] });
      toast({ title: "Role deleted" });
    },
    onError: (err) => toast({ title: "Could not delete role", description: parseApiError(err).error, variant: "destructive" }),
  });

  // ── Org profile edit ──
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgIndustry, setOrgIndustry] = useState<string | null>(null);
  const saveOrg = useMutation({
    mutationFn: async () =>
      (await apiRequest("PATCH", "/api/org", {
        name: orgName ?? org?.name,
        industry: orgIndustry ?? org?.industry ?? "",
      })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org"] });
      toast({ title: "Organization updated" });
    },
    onError: () => toast({ title: "Could not update organization", variant: "destructive" }),
  });

  // ── Invite flow ──
  const [inviteOpen, setInviteOpen] = useState(false);
  const [seatDialogOpen, setSeatDialogOpen] = useState(false);
  const [seatMessage, setSeatMessage] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("");
  const sendInvite = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/org/invitations", {
        email: inviteEmail.trim(),
        ...(inviteRole.startsWith("custom:")
          ? { customRoleId: inviteRole.slice(7) }
          : { orgRole: inviteRole }),
      })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/invitations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org"] });
      setInviteOpen(false);
      setInviteEmail("");
      toast({ title: "Invitation sent", description: `${inviteEmail.trim()} will get an email with a join link.` });
    },
    onError: (err) => {
      const parsed = parseApiError(err);
      const raw = err instanceof Error ? err.message : "";
      if (raw.includes("SEAT_LIMIT")) {
        setInviteOpen(false);
        setSeatMessage(parsed.error || "Your plan's team limit is reached.");
        setSeatDialogOpen(true);
        return;
      }
      toast({ title: "Could not send invitation", description: parsed.error || "Please try again.", variant: "destructive" });
    },
  });

  const resendInvite = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/org/invitations/${id}/resend`)).json(),
    onSuccess: () => toast({ title: "Invitation re-sent" }),
    onError: () => toast({ title: "Could not resend", variant: "destructive" }),
  });
  const revokeInvite = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/org/invitations/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/invitations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org"] });
      toast({ title: "Invitation revoked" });
    },
  });

  // ── Member management ──
  const changeRole = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) =>
      (await apiRequest("PATCH", `/api/org/members/${id}`,
        value.startsWith("custom:") ? { customRoleId: value.slice(7) } : { orgRole: value },
      )).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/members"] });
      toast({ title: "Role updated" });
    },
    onError: (err) => toast({ title: "Could not change role", description: parseApiError(err).error, variant: "destructive" }),
  });
  const removeMember = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/org/members/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org"] });
      toast({ title: "Member removed" });
    },
    onError: (err) => toast({ title: "Could not remove member", description: parseApiError(err).error, variant: "destructive" }),
  });

  const TABS: { key: Tab; label: string; icon: typeof Building2; show: boolean }[] = [
    { key: "organization", label: "Organization", icon: Building2, show: true },
    { key: "team", label: "Team Members", icon: Users, show: true },
    { key: "activity", label: "Activity Logs", icon: ScrollText, show: canActivity },
    { key: "subscription", label: "Subscription", icon: CreditCard, show: true },
    { key: "preferences", label: "Preferences", icon: SlidersHorizontal, show: true },
  ];

  const seatsFree = org ? Math.max(0, org.seatLimit - org.seatsUsed - org.pendingInvites) : 0;


  /** Erasure. The server anonymises the row rather than dropping it, because
   *  deals and invoices reference it and financial records have a retention
   *  period — see anonymizeUser in storage.ts. */
  const deleteAccount = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/account", { confirm: "DELETE" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Account deleted", description: "Your personal data has been erased." });
      window.location.href = "/";
    },
    onError: (err) => {
      toast({
        title: "Could not delete your account",
        description: parseApiError(err).error || "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 px-4 py-3 flex items-center gap-3 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-5">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon" data-testid="button-back"><ArrowLeft className="h-5 w-5" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl lg:text-2xl font-semibold leading-tight">Settings</h1>
          {org && <p className="text-xs text-muted-foreground">{org.name}</p>}
        </div>
        {org && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-sm font-bold text-primary">
            <Users className="w-3.5 h-3.5" />
            {org.seatsUsed} / {org.seatLimit}
          </div>
        )}
      </header>

      <main className="p-4 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-6">
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Tab rail */}
          <nav className="flex lg:flex-col gap-1.5 lg:w-56 overflow-x-auto pb-1 lg:pb-0">
            {TABS.filter((t) => t.show).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                data-testid={`settings-tab-${t.key}`}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                  tab === t.key
                    ? "bg-primary/[0.08] text-primary"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </nav>

          {/* Panel */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* ── Organization ── */}
            {tab === "organization" && (
              <Card className="glass-card">
                <CardContent className="p-5 lg:p-6 space-y-5">
                  <div>
                    <h2 className="font-bold text-lg">Organization profile</h2>
                    <p className="text-sm text-muted-foreground">The name your team and clients see.</p>
                  </div>
                  {orgLoading ? (
                    <Skeleton className="h-24 w-full rounded-xl" />
                  ) : (
                    <div className="space-y-4 max-w-md">
                      <div className="space-y-1.5">
                        <Label htmlFor="org-name">Organization name</Label>
                        <Input
                          id="org-name"
                          value={orgName ?? org?.name ?? ""}
                          onChange={(e) => setOrgName(e.target.value)}
                          disabled={!canEditOrg}
                          data-testid="input-org-name"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="org-industry">Industry</Label>
                        <Input
                          id="org-industry"
                          placeholder="e.g. Interior Design, Real Estate, Agency"
                          value={orgIndustry ?? org?.industry ?? ""}
                          onChange={(e) => setOrgIndustry(e.target.value)}
                          disabled={!canEditOrg}
                        />
                      </div>
                      {canEditOrg && (
                        <Button
                          onClick={() => saveOrg.mutate()}
                          disabled={saveOrg.isPending}
                          className="gradient-btn text-white"
                          data-testid="button-save-org"
                        >
                          {saveOrg.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                          Save changes
                        </Button>
                      )}
                      {!canEditOrg && (
                        <p className="text-xs text-muted-foreground">Only the Owner or an Admin can edit the organization.</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Team ── */}
            {tab === "team" && (
              <>
                <Card className="glass-card">
                  <CardContent className="p-5 lg:p-6">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <h2 className="font-bold text-lg">Team members</h2>
                        <p className="text-sm text-muted-foreground">
                          {org ? `${org.seatsUsed} of ${org.seatLimit} seats used${org.pendingInvites ? ` · ${org.pendingInvites} pending` : ""}` : ""}
                        </p>
                      </div>
                      {canInvite && (
                        <Button
                          className="gradient-btn text-white flex-shrink-0"
                          onClick={() => (seatsFree > 0 ? setInviteOpen(true) : (setSeatMessage(`Your current plan allows ${org?.seatLimit ?? 1} team member${(org?.seatLimit ?? 1) === 1 ? "" : "s"}. Upgrade your plan or purchase additional seats.`), setSeatDialogOpen(true)))}
                          data-testid="button-invite-member"
                        >
                          <UserPlus className="w-4 h-4 mr-2" />
                          Invite Member
                        </Button>
                      )}
                    </div>

                    <div className="divide-y divide-border/60">
                      {members.map((m) => (
                        <div key={m.id} className="py-3 flex items-center gap-3" data-testid={`member-${m.email}`}>
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary/70 text-white text-sm font-bold flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {m.avatar
                              ? <img src={m.avatar} alt="" className="w-full h-full object-cover" />
                              : ((m.firstName?.[0] ?? "") + (m.lastName?.[0] ?? "") || m.email[0].toUpperCase())}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold truncate">
                                {[m.firstName, m.lastName].filter(Boolean).join(" ") || m.email}
                              </p>
                              {m.orgRole === "OWNER" && <Crown className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                              {m.id === (user as any)?.id && <Badge variant="secondary" className="text-[10px] px-1.5">You</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{m.email} · joined {fmtDate(m.joinedAt)}</p>
                          </div>
                          {canManageTeam && m.orgRole !== "OWNER" && m.id !== (user as any)?.id ? (
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <Select
                                value={m.customRoleId ? `custom:${m.customRoleId}` : m.orgRole}
                                onValueChange={(v) => changeRole.mutate({ id: m.id, value: v })}
                              >
                                <SelectTrigger className="h-8 w-[130px] text-xs" data-testid={`role-select-${m.email}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {customRoles.map((r) => (
                                    <SelectItem key={r.id} value={`custom:${r.id}`} className="text-xs">
                                      {r.name}
                                    </SelectItem>
                                  ))}
                                  {/* Legacy literal role (pre-editable-roles member): shown so the
                                      select reads correctly until the owner reassigns them.
                                      (This block only renders for non-OWNER rows.) */}
                                  {!m.customRoleId && (
                                    <SelectItem value={m.orgRole} className="text-xs">
                                      {ROLE_META[m.orgRole as OrgRole]?.label ?? m.orgRole} (legacy)
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-rose-500"
                                onClick={async () => {
                                  if (await confirm({ title: `Remove ${m.email}?`, description: "They lose access immediately. Their records stay with the organization.", destructive: true, confirmText: "Remove" })) {
                                    removeMember.mutate(m.id);
                                  }
                                }}
                                data-testid={`remove-${m.email}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <Badge variant="outline" className="flex-shrink-0 text-xs">
                              {m.customRoleName ?? ROLE_META[m.orgRole as OrgRole]?.label ?? m.orgRole}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {canInvite && invites.length > 0 && (
                  <Card className="glass-card">
                    <CardContent className="p-5 lg:p-6">
                      <h3 className="font-bold mb-3">Pending invitations</h3>
                      <div className="divide-y divide-border/60">
                        {invites.map((inv) => (
                          <div key={inv.id} className="py-3 flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                              <Mail className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate">{inv.email}</p>
                              <p className="text-xs text-muted-foreground">
                                {ROLE_META[inv.orgRole]?.label
                                  ?? customRoles.find((r) => r.id === (inv as any).customRoleId)?.name
                                  ?? "Custom role"} · invited {fmtDate(inv.createdAt)} · expires {fmtDate(inv.expiresAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Resend"
                                onClick={() => resendInvite.mutate(inv.id)} data-testid={`resend-${inv.email}`}>
                                <RotateCw className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-rose-500" title="Revoke"
                                onClick={() => revokeInvite.mutate(inv.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* ── Roles & permissions matrix ── */}
                {canManageTeam && (
                  <Card className="glass-card">
                    <CardContent className="p-5 lg:p-6">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div>
                          <h3 className="font-bold">Roles &amp; permissions</h3>
                          <p className="text-sm text-muted-foreground">
                            Every role is yours to shape — edit the defaults, delete them, or
                            create your own with the exact permission mix.
                          </p>
                        </div>
                        {isOwner && (
                          <Button
                            variant="outline"
                            className="flex-shrink-0 font-semibold border-primary/40 text-primary"
                            onClick={() => openRoleEditor()}
                            data-testid="button-create-role"
                          >
                            <Plus className="w-4 h-4 mr-1.5" />
                            Create Role
                          </Button>
                        )}
                      </div>

                      <div className="mt-4 grid sm:grid-cols-2 gap-2.5">
                        {customRoles.map((r) => (
                          <div key={r.id} className="rounded-xl border border-primary/30 bg-primary/[0.03] p-3" data-testid={`custom-role-${r.name}`}>
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold flex items-center gap-1.5 min-w-0">
                                <Shield className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                                <span className="truncate">{r.name}</span>
                              </p>
                              {isOwner && (
                                <span className="flex items-center gap-0.5 flex-shrink-0">
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit role"
                                    onClick={() => openRoleEditor(r)} data-testid={`edit-role-${r.name}`}>
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-rose-500" title="Delete role"
                                    onClick={async () => {
                                      if (await confirm({ title: `Delete role "${r.name}"?`, description: "Members must be reassigned before a role can be deleted.", destructive: true, confirmText: "Delete" })) {
                                        deleteRole.mutate(r.id);
                                      }
                                    }}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {r.permissions.length} permission{r.permissions.length !== 1 ? "s" : ""}
                              {" · "}{r.usage.members} member{r.usage.members !== 1 ? "s" : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {/* ── Activity ── */}
            {tab === "activity" && (
              <Card className="glass-card">
                <CardContent className="p-5 lg:p-6">
                  <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                    <div>
                      <h2 className="font-bold text-lg">Activity</h2>
                      <p className="text-sm text-muted-foreground">Everything your team did, newest first.</p>
                    </div>
                    <DateRangeFilter value={activityRange} onChange={setActivityRange} />
                  </div>
                  {(() => {
                    const rows = activity.filter((a) => inRange(a.createdAt, activityRange));
                    const pageCount = Math.max(1, Math.ceil(rows.length / ACTIVITY_PAGE_SIZE));
                    const page = Math.min(activityPage, pageCount - 1);
                    const pageRows = rows.slice(page * ACTIVITY_PAGE_SIZE, (page + 1) * ACTIVITY_PAGE_SIZE);
                    if (!rows.length) {
                      return (
                        <div className="py-10 text-center">
                          <ScrollText className="w-7 h-7 mx-auto text-muted-foreground/40 mb-2" />
                          <p className="text-sm font-semibold">
                            {activity.length ? "Nothing in this date range" : "No activity yet"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {activity.length ? "Try a wider range." : "It starts recording from today."}
                          </p>
                        </div>
                      );
                    }
                    return (
                      <div className="rounded-xl border border-border/60 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-muted/40 text-left">
                                {["Sr.", "Who", "Action", "Record", "Detail", "When"].map((h) => (
                                  <th key={h} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                              {pageRows.map((a, idx) => {
                                const tone = ACTIVITY_TONE[a.entityType] ?? ACTIVITY_TONE.default;
                                return (
                                  <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                                    <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums w-[44px]">
                                      {page * ACTIVITY_PAGE_SIZE + idx + 1}
                                    </td>
                                    <td className="px-3 py-2.5 whitespace-nowrap">
                                      <span className="inline-flex items-center gap-2">
                                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                                          {(a.userName ?? "?").slice(0, 1).toUpperCase()}
                                        </span>
                                        <span className="font-medium truncate max-w-[140px]">{a.userName || "Someone"}</span>
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5 whitespace-nowrap">
                                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ACTION_TONE(a.action)}`}>
                                        {a.action}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5 whitespace-nowrap">
                                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${tone}`}>
                                        {a.entityType}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-muted-foreground max-w-[280px] truncate">{a.detail || "—"}</td>
                                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap text-xs">
                                      {new Date(a.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {pageCount > 1 && (
                          <div className="flex items-center justify-between px-3 py-2 border-t border-border/60 bg-muted/20 text-xs">
                            <span className="text-muted-foreground tabular-nums">
                              Showing {page * ACTIVITY_PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * ACTIVITY_PAGE_SIZE)} of {rows.length}
                            </span>
                            <span className="flex items-center gap-1">
                              <Button variant="outline" size="sm" className="h-7 px-2"
                                onClick={() => setActivityPage(Math.max(0, page - 1))} disabled={page === 0}
                                data-testid="activity-prev">Prev</Button>
                              <span className="px-2 text-muted-foreground tabular-nums">{page + 1} / {pageCount}</span>
                              <Button variant="outline" size="sm" className="h-7 px-2"
                                onClick={() => setActivityPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}
                                data-testid="activity-next">Next</Button>
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* ── Preferences (per-device) ── */}
            {tab === "preferences" && (
              <Card className="glass-card">
                <CardContent className="p-5 lg:p-6 space-y-5">
                  <div>
                    <h2 className="font-bold text-lg">Appearance</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      How DealInSec looks on this device.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 max-w-md" role="radiogroup" aria-label="Theme">
                    {([
                      { key: "light" as ThemePref, label: "Light", desc: "Bright & clean", Icon: Sun },
                      { key: "dark" as ThemePref, label: "Dark", desc: "Easy on the eyes", Icon: Moon },
                      { key: "system" as ThemePref, label: "System", desc: "Match your OS", Icon: Monitor },
                    ]).map(({ key, label, desc, Icon }) => {
                      const active = themePref === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => chooseTheme(key)}
                          data-testid={`theme-${key}`}
                          className={`relative rounded-xl border-2 p-3.5 text-left transition-all ${
                            active
                              ? "border-primary bg-primary/[0.06] shadow-sm"
                              : "border-border hover:border-primary/40 hover:bg-muted/40"
                          }`}
                        >
                          {active && (
                            <span className="absolute top-2 right-2 flex items-center justify-center w-4.5 h-4.5 w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground">
                              <Check className="w-3 h-3" strokeWidth={3} />
                            </span>
                          )}
                          <Icon className={`w-5 h-5 mb-2 ${active ? "text-primary" : "text-muted-foreground"}`} />
                          <p className="text-sm font-semibold">{label}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Saved on this device only — teammates and your other devices keep their own choice.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* ── Subscription ── */}
            {tab === "subscription" && org && (
              <Card className="glass-card">
                <CardContent className="p-5 lg:p-6 space-y-4">
                  <h2 className="font-bold text-lg">Subscription & seats</h2>
                  <div className="grid grid-cols-2 gap-3 max-w-md">
                    <div className="rounded-xl border border-border/60 p-3.5">
                      <p className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">Plan</p>
                      <p className="text-xl font-bold mt-0.5 flex items-center gap-1.5">
                        {org.ownerPlan === "pro"
                          ? <><Crown className="w-4 h-4 text-amber-500" /> Pro</>
                          : org.ownerOnTrial
                            ? <><Sparkles className="w-4 h-4 text-emerald-500" /> Pro trial</>
                            : "Free"}
                      </p>
                      {org.ownerPlan === "pro" && org.ownerPlanExpiresAt ? (
                        <p className="text-[11px] text-muted-foreground">until {fmtDate(org.ownerPlanExpiresAt)}</p>
                      ) : org.ownerOnTrial && org.ownerTrialEndsAt ? (
                        <p className="text-[11px] text-muted-foreground">until {fmtDate(org.ownerTrialEndsAt)}</p>
                      ) : null}
                    </div>
                    <div className="rounded-xl border border-border/60 p-3.5">
                      <p className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">Seats</p>
                      <p className="text-xl font-bold mt-0.5">{org.seatsUsed} / {org.seatLimit}</p>
                      {org.extraSeats > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          incl. {org.extraSeats} extra · until {fmtDate(org.extraSeatsExpiresAt)}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Free plan includes 1 user. Pro — and your free trial — includes 5 team members.
                    Need more? Extra seats are ₹199/seat per month.
                  </p>
                  {canBilling ? (
                    <div className="flex flex-wrap gap-2">
                      <Link href="/pricing">
                        <Button className="gradient-btn text-white" data-testid="button-manage-plan">
                          <Sparkles className="w-4 h-4 mr-2" /> Manage plan
                        </Button>
                      </Link>
                      <Link href="/pricing#seats">
                        <Button variant="outline" data-testid="button-buy-seats">
                          <Rocket className="w-4 h-4 mr-2" /> Buy extra seats
                        </Button>
                      </Link>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Only the Owner can manage billing and seats.</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Your data (DPDP Act rights) ──────────────────────────────
                The privacy policy promises access and erasure. These are the
                controls that make those promises real rather than an email
                address the user has to trust. */}
            <Card className="glass-card border-0">
              <CardContent className="p-5 sm:p-6 space-y-4">
                <div>
                  <h2 className="font-semibold">Your data</h2>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md">
                    Your rights under the Digital Personal Data Protection Act, 2023.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between rounded-xl border border-border p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Download my data</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Your profile plus every deal, quotation, agreement and invoice your role can see, as JSON.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="shrink-0"
                    data-testid="button-export-data"
                    onClick={() => { window.location.href = "/api/account/export"; }}
                  >
                    <Download className="w-4 h-4 mr-2" /> Download
                  </Button>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-destructive">Delete my account</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Erases your personal details and signs you out for good. Financial records are kept for
                      the statutory period, with your identity removed from them.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                    disabled={deleteAccount.isPending}
                    data-testid="button-delete-account"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Delete your account?",
                        description:
                          "This cannot be undone. Your name, email, PAN, GSTIN, bank details and signature are erased, and you are signed out immediately. Download your data first if you want a copy.",
                        confirmText: "Delete my account",
                        cancelText: "Keep my account",
                        destructive: true,
                      });
                      if (ok) deleteAccount.mutate();
                    }}
                  >
                    {deleteAccount.isPending
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting…</>
                      : <><Trash2 className="w-4 h-4 mr-2" /> Delete</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* ── Invite dialog ── */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm" data-testid="invite-dialog">
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>They'll get an email with a link to join {org?.name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                data-testid="input-invite-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as OrgRole)}>
                <SelectTrigger data-testid="select-invite-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* Roles come from the org's own list only — Admin/Sales/
                      Accounts are seeded rows there, so listing the legacy
                      constants as well showed every role twice. */}
                  {customRoles.map((r) => (
                    <SelectItem key={r.id} value={`custom:${r.id}`}>
                      <span className="font-semibold">{r.name}</span>
                      <span className="text-muted-foreground text-xs"> — {r.permissions.length} permission{r.permissions.length !== 1 ? "s" : ""}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full gradient-btn text-white"
              disabled={sendInvite.isPending || !inviteEmail.trim() || !inviteRole}
              onClick={() => sendInvite.mutate()}
              data-testid="button-send-invite"
            >
              {sendInvite.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Send Invitation
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Custom role editor: the permission matrix ── */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="role-dialog">
          <DialogHeader>
            <DialogTitle>{editingRoleId ? "Edit role" : "Create a custom role"}</DialogTitle>
            <DialogDescription>
              Pick exactly what members with this role can do. Changes apply to every
              member on the role immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Role name</Label>
              <Input
                id="role-name"
                placeholder="e.g. Site Engineer, Junior Sales, Auditor"
                value={roleName}
                maxLength={40}
                onChange={(e) => setRoleName(e.target.value)}
                data-testid="input-role-name"
              />
            </div>

            <div className="rounded-xl border border-border/60 overflow-hidden">
              <div className="px-3.5 py-2.5 bg-muted/50 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Permissions</span>
                <span className="text-xs text-muted-foreground tabular-nums">{rolePerms.length} selected</span>
              </div>
              <div className="divide-y divide-border/50">
                {PERMISSION_MATRIX.map((group) => (
                  <div key={group.module} className="px-3.5 py-2.5 flex items-start gap-3">
                    <span className="w-24 lg:w-28 flex-shrink-0 text-sm font-semibold pt-0.5">{group.module}</span>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 flex-1">
                      {group.items.map(({ perm, label }) => (
                        <label key={perm} className="flex items-center gap-1.5 text-sm cursor-pointer select-none" data-testid={`perm-${perm}`}>
                          <Checkbox
                            checked={rolePerms.includes(perm)}
                            onCheckedChange={() => togglePerm(perm)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="px-3.5 py-2.5 text-[11px] text-muted-foreground bg-muted/30 border-t border-border/50">
                Every active member can <b>view</b> the organization's records. Billing and
                org deletion always stay with the owner.
              </p>
            </div>

            <Button
              className="w-full gradient-btn text-white"
              disabled={saveRole.isPending || roleName.trim().length < 2}
              onClick={() => saveRole.mutate()}
              data-testid="button-save-role"
            >
              {saveRole.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingRoleId ? "Save changes" : "Create role"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Seat limit dialog ── */}
      <Dialog open={seatDialogOpen} onOpenChange={setSeatDialogOpen}>
        <DialogContent className="max-w-sm" data-testid="seat-limit-dialog">
          <DialogHeader>
            <DialogTitle>Team limit reached</DialogTitle>
            <DialogDescription>{seatMessage}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {canBilling ? (
              <>
                <Link href="/pricing">
                  <Button className="w-full gradient-btn text-white">Upgrade Plan</Button>
                </Link>
                <Link href="/pricing#seats">
                  <Button variant="outline" className="w-full">Buy Additional Seats — ₹199/seat</Button>
                </Link>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Ask your organization Owner to upgrade the plan or buy seats.</p>
            )}
            <Button variant="ghost" className="w-full" onClick={() => setSeatDialogOpen(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
}
