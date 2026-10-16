/**
 * Settings' section switcher: a sticky column on desktop, a scrolling strip on phones. The open section is marked by
 * weight, colour, aria-selected and an indicator that slides to it (framer layoutId, unique per instance). Arrow keys
 * move between sections (either axis), Home/End jump; one tab stop for the whole list. The rules live in
 * shared/settings-tabs.ts.
 */
import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { tSpring, useCalmMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { nextTabIndex, type SettingsTab } from "@shared/settings-tabs";

export interface SettingsTabItem { key: SettingsTab; label: string; icon: LucideIcon }

export const settingsTabId = (idBase: string, key: SettingsTab) => `${idBase}-tab-${key}`;
export const settingsPanelId = (idBase: string) => `${idBase}-panel`;

export function SettingsTabsNav({ idBase, tabs, value, onChange }: { idBase: string; tabs: readonly SettingsTabItem[]; value: SettingsTab; onChange: (t: SettingsTab) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const calm = useCalmMotion();
  const current = Math.max(0, tabs.findIndex((t) => t.key === value));

  // Phones: keep the open section visible in the strip. Horizontal only, so it never scrolls the page itself.
  useEffect(() => {
    const box = listRef.current, el = refs.current[current];
    if (!box || !el || box.scrollWidth <= box.clientWidth) return;
    const left = Math.max(0, el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2);
    if (typeof box.scrollTo === "function") box.scrollTo({ left, behavior: calm ? "auto" : "smooth" });
    else box.scrollLeft = left;
  }, [current, calm]);

  const move = (key: string) => {
    const n = nextTabIndex(current, key, tabs.length);
    if (n === null) return false;
    onChange(tabs[n].key);
    refs.current[n]?.focus();
    return true;
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Settings sections"
      className="scrollbar-hide relative -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
    >
      {tabs.map((t, i) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={settingsTabId(idBase, t.key)}
            aria-selected={active}
            aria-controls={settingsPanelId(idBase)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => { if (move(e.key)) e.preventDefault(); }}
            data-testid={`settings-tab-${t.key}`}
            className={cn(
              "relative z-0 flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3.5 py-2.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50",
              active ? "text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {active && (
              <motion.span layoutId={`settings-tab-indicator-${idBase}`} transition={tSpring} aria-hidden="true" className="absolute inset-0 -z-10 rounded-lg bg-primary/[0.08] ring-1 ring-primary/15">
                {/* Desktop: a bar on the left edge. Phones: an underline. */}
                <span className="absolute inset-y-2 left-0 hidden w-0.5 rounded-full bg-primary lg:block" />
                <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary lg:hidden" />
              </motion.span>
            )}
            <t.icon className="h-4 w-4 shrink-0" aria-hidden />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
