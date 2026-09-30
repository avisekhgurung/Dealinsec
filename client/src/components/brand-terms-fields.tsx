import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BRAND_TERM_KEYS, BRAND_TERM_LIMITS, type BrandTermKey, type BrandTerms } from "@shared/audience";

/** The form's working copy: every field is a string, blank when not entered. */
export type BrandTermsDraft = Record<BrandTermKey, string>;

export const emptyBrandTermsDraft = (from?: BrandTerms | null): BrandTermsDraft =>
  Object.fromEntries(BRAND_TERM_KEYS.map((k) => [k, from?.[k] ?? ""])) as BrandTermsDraft;

const FIELDS: {
  key: BrandTermKey;
  label: string;
  placeholder: string;
  multiline: boolean;
}[] = [
  { key: "campaign", label: "Campaign", placeholder: "e.g. Autumn skincare launch", multiline: false },
  {
    key: "usageRights",
    label: "Usage rights",
    placeholder: "e.g. Organic posts on the brand's own channels only",
    multiline: true,
  },
  { key: "usageDuration", label: "Usage duration", placeholder: "e.g. 3 months from first posting", multiline: false },
  {
    key: "exclusivity",
    label: "Exclusivity",
    placeholder: "e.g. No other skincare brands for 30 days, or “none”",
    multiline: true,
  },
  {
    key: "approval",
    label: "Approval process",
    placeholder: "e.g. The brand approves each video once and replies within 2 working days",
    multiline: true,
  },
];

/**
 * Campaign, usage rights, usage duration, exclusivity and approval for a brand
 * collaboration. Collapsed until wanted (open by default when a value is
 * already there), and every field is optional: whatever the brand did not ask
 * for stays blank, is shown as "Not specified", and is what Protection Check
 * asks about.
 */
export function BrandTermsFields({
  value,
  onChange,
}: {
  value: BrandTermsDraft;
  onChange: (next: BrandTermsDraft) => void;
}) {
  const [open, setOpen] = useState(() => BRAND_TERM_KEYS.some((k) => value[k]));
  return (
    <section className="glass-card rounded-xl p-5 space-y-4" data-testid="section-brand-terms">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Usage, exclusivity &amp; approval
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Optional. Add only what the brand asked for. Anything left blank shows as “Not specified” and is checked by
            Protection Check.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 text-xs"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          data-testid="button-toggle-brand-terms"
        >
          {open ? "Hide" : "Add usage and exclusivity terms"}
        </Button>
      </div>

      {open && (
        <div className="space-y-4">
          {FIELDS.map(({ key, label, placeholder, multiline }) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`brand-term-${key}`}>{label}</Label>
              {multiline ? (
                <Textarea
                  id={`brand-term-${key}`}
                  rows={2}
                  maxLength={BRAND_TERM_LIMITS[key]}
                  placeholder={placeholder}
                  value={value[key]}
                  onChange={(e) => onChange({ ...value, [key]: e.target.value })}
                  data-testid={`input-brand-term-${key}`}
                />
              ) : (
                <Input
                  id={`brand-term-${key}`}
                  maxLength={BRAND_TERM_LIMITS[key]}
                  placeholder={placeholder}
                  className="h-11"
                  value={value[key]}
                  onChange={(e) => onChange({ ...value, [key]: e.target.value })}
                  data-testid={`input-brand-term-${key}`}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
