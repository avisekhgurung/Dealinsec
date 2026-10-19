/**
 * Settings' tabs, kept pure so the rules are tested: which tabs a member sees, which one a URL opens, how the URL
 * records the open tab, and where the arrow keys go. The page (client/src/pages/settings.tsx) only applies them.
 *
 * Deep links: /settings?tab=<key> opens that tab (a few friendly aliases too, e.g. ?tab=billing). The return from
 * Google's Gmail consent (/settings?gmail=<outcome>, see server/mail/routes.ts) always opens Integrations, because
 * that is where the Gmail card lives and it reads the outcome from the URL itself. A tab the member may not see, or
 * an unknown key, falls back to Business details.
 */

export const SETTINGS_TABS = ["organization", "team", "integrations", "subscription", "preferences", "activity"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTab = "organization";

export const SETTINGS_TAB_META: Record<SettingsTab, { label: string; description: string }> = {
  organization: { label: "Business details", description: "Your business name, work type, country and how your documents look." },
  team: { label: "Team", description: "Who works in this workspace and what each person can do." },
  integrations: { label: "Integrations", description: "DealInSec only connects what you approve, and you can disconnect any time." },
  subscription: { label: "Plan & billing", description: "Your plan and, for teams, your seats." },
  preferences: { label: "Preferences", description: "How DealInSec looks and behaves on this device, and your data." },
  activity: { label: "Activity log", description: "A record of what was done in this workspace, and by whom." },
};

/** Other words people (and older links) use for a tab. Keys are lower-case. */
const ALIASES: Record<string, SettingsTab> = {
  business: "organization",
  profile: "organization",
  org: "organization",
  members: "team",
  integration: "integrations",
  connections: "integrations",
  gmail: "integrations",
  billing: "subscription",
  plan: "subscription",
  seats: "subscription",
  appearance: "preferences",
  theme: "preferences",
  log: "activity",
};

const isTab = (v: string): v is SettingsTab => (SETTINGS_TABS as readonly string[]).includes(v);

/** The tabs this member sees, in display order. The activity log needs the activity.view permission. */
export function visibleSettingsTabs(p: { canViewActivity: boolean }): SettingsTab[] {
  return SETTINGS_TABS.filter((t) => t !== "activity" || p.canViewActivity);
}

/** A ?tab value (or alias) as a tab key, or null when it names none. */
export function normalizeSettingsTab(raw: string | null | undefined): SettingsTab | null {
  if (!raw || typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (!v || v.length > 40) return null;
  if (isTab(v)) return v;
  return Object.prototype.hasOwnProperty.call(ALIASES, v) ? ALIASES[v] : null;
}

/**
 * The tab a URL's query string asks for, before permissions are known: the Gmail return wins (its card must be on
 * screen to show the outcome), then ?tab. Null when the URL asks for nothing in particular.
 */
export function requestedSettingsTab(search: string): SettingsTab | null {
  const params = new URLSearchParams(search);
  if ((params.get("gmail") ?? "").trim()) return "integrations";
  return normalizeSettingsTab(params.get("tab"));
}

/** The tab to show: the requested one when this member can see it, otherwise Business details. */
export function pickSettingsTab(requested: SettingsTab | null, visible: readonly SettingsTab[]): SettingsTab {
  return requested && visible.includes(requested) ? requested : DEFAULT_SETTINGS_TAB;
}

/** Both steps at once: the tab a URL opens for a member who sees `visible`. */
export function resolveSettingsTab(search: string, visible: readonly SettingsTab[]): SettingsTab {
  return pickSettingsTab(requestedSettingsTab(search), visible);
}

/**
 * The query string that records `tab`, keeping every other parameter (including a ?gmail outcome the Gmail card has
 * not read yet). Business details is the default, so it leaves ?tab out. Returns "" or a string starting with "?".
 */
export function settingsTabSearch(search: string, tab: SettingsTab): string {
  const params = new URLSearchParams(search);
  if (tab === DEFAULT_SETTINGS_TAB) params.delete("tab");
  else params.set("tab", tab);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/** Where a key press moves focus in a list of `count` tabs (both arrow axes work: the list is a column on desktop and a row on phones). Null: not a navigation key. */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown": case "ArrowRight": return (current + 1) % count;
    case "ArrowUp": case "ArrowLeft": return (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}
