import { Briefcase, Check, Clapperboard } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Audience } from "@shared/audience";

const OPTIONS: { value: Audience; title: string; description: string; Icon: typeof Briefcase }[] = [
  {
    value: "client_work",
    title: "I work with clients",
    description: "Freelancers, consultants and service professionals.",
    Icon: Briefcase,
  },
  {
    value: "brand_collaboration",
    title: "I work with brands",
    description: "Creators, UGC creators and influencers.",
    Icon: Clapperboard,
  },
];

/**
 * The work-type choice: two cards, one selected. Used by onboarding (nothing
 * selected until the person chooses) and by Settings (always has a value).
 * It only changes wording and what the new-deal picker offers first; nothing
 * that already exists is affected, which is what the Settings copy says.
 */
export function AudiencePicker({
  value,
  onChange,
  disabled,
  idPrefix = "audience",
  layout = "stack",
}: {
  value: Audience | null;
  onChange: (next: Audience) => void;
  disabled?: boolean;
  idPrefix?: string;
  /** "stack" for narrow cards (onboarding); "row" puts them side by side from
   *  the sm breakpoint (Settings). */
  layout?: "stack" | "row";
}) {
  return (
    <div
      role="radiogroup"
      aria-label="What kind of work do you do?"
      className={cn("grid gap-3", layout === "row" && "sm:grid-cols-2")}
    >
      {OPTIONS.map(({ value: v, title, description, Icon }) => {
        const selected = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(v)}
            data-testid={`${idPrefix}-${v}`}
            className={cn(
              "relative flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected
                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                : "border-border bg-background hover:border-emerald-300",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                selected
                  ? "bg-emerald-600 text-white"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-tight">{title}</span>
              <span className="mt-1 block text-xs leading-snug text-muted-foreground">{description}</span>
            </span>
            {selected && <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

/** The optional "what best describes you?" answers. Stored as the workspace's
 *  free-text `industry`, which Settings already shows as "What you do". */
export const DESCRIBES_YOU = [
  "Freelancer",
  "Developer",
  "Designer",
  "Consultant",
  "Creator",
  "UGC creator",
  "Influencer",
  "Other",
] as const;
