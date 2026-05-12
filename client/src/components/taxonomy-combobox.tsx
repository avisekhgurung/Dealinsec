import { useState, useMemo, useEffect } from "react";
import { Check, ChevronDown, Search, ArrowLeft, SquarePen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { OTHER_OPTION } from "@shared/dealTypeTaxonomy";

export interface TaxonomyComboboxProps {
  /** Grouped options, e.g. [{ group: "Wedding", options: ["Wedding photography", ...] }] */
  groups: { group: string; options: string[] }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** ARIA / test id */
  testId?: string;
}

/**
 * Professional searchable combobox for taxonomy fields.
 * Designed for fintech-grade polish: refined hierarchy, generous spacing,
 * subtle hover states, and a persistent "Other (specify)" escape hatch.
 */
export function TaxonomyCombobox({
  groups,
  value,
  onChange,
  placeholder = "Select...",
  testId,
}: TaxonomyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const allOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) for (const o of g.options) set.add(o);
    return set;
  }, [groups]);

  const isFreeForm = groups.length === 1 && groups[0].options.length === 0;
  const isCustomValue = value !== "" && !allOptions.has(value) && value !== OTHER_OPTION;
  const [customMode, setCustomMode] = useState<boolean>(isFreeForm || isCustomValue);

  useEffect(() => {
    setCustomMode(isFreeForm || isCustomValue);
  }, [isFreeForm, isCustomValue]);

  // Filter groups by query
  const filteredGroups = useMemo(() => {
    if (!query.trim()) return groups;
    const q = query.toLowerCase();
    return groups
      .map((g) => ({
        group: g.group,
        options: g.options.filter(
          (o) => o.toLowerCase().includes(q) || g.group.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.options.length > 0);
  }, [groups, query]);

  // Reset query when opening
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // ── Free-text mode ──────────────────────────────────────────────────
  if (customMode) {
    return (
      <div className="flex items-stretch gap-1.5">
        <div className="relative flex-1">
          <SquarePen className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={value === OTHER_OPTION ? "" : value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={isFreeForm ? "Type your category" : "Type a custom value"}
            className="h-11 pl-9 bg-background border-input/80 focus-visible:border-primary/60 focus-visible:ring-primary/15 transition-colors"
            data-testid={testId}
          />
        </div>
        {!isFreeForm && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 px-3 border-input/80 text-muted-foreground hover:text-foreground hover:bg-muted/60"
            onClick={() => {
              onChange("");
              setCustomMode(false);
            }}
            title="Back to list"
            aria-label="Back to list"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            <span className="text-xs font-medium">List</span>
          </Button>
        )}
      </div>
    );
  }

  // ── Dropdown mode ───────────────────────────────────────────────────
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between h-11 font-normal text-sm bg-background hover:bg-background border-input/80 hover:border-primary/40 transition-colors data-[state=open]:border-primary/60 data-[state=open]:ring-2 data-[state=open]:ring-primary/15 px-3",
          )}
          data-testid={testId}
        >
          <span className={cn("truncate", !value ? "text-muted-foreground/70" : "text-foreground font-medium")}>
            {value || placeholder}
          </span>
          <ChevronDown className={cn("w-4 h-4 ml-2 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 overflow-hidden rounded-xl border-input/60 shadow-2xl shadow-black/[0.07] dark:shadow-black/30"
        align="start"
        sideOffset={6}
      >
        {/* Search bar */}
        <div className="relative border-b border-input/40 bg-muted/30">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search categories..."
            className="w-full h-11 pl-10 pr-3 bg-transparent text-sm placeholder:text-muted-foreground/70 outline-none"
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Options list */}
        <div className="max-h-[280px] overflow-y-auto py-1 bg-background">
          {filteredGroups.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium text-foreground/80 mb-1">No matches</p>
              <p className="text-xs text-muted-foreground">
                Use <span className="font-semibold text-foreground/80">Other (specify)</span> below to add your own.
              </p>
            </div>
          ) : (
            filteredGroups.map((g, gIdx) => (
              <div key={g.group} className={cn(gIdx > 0 && "mt-1")}>
                {/* Group header */}
                <div className="px-3 pt-2.5 pb-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
                    {g.group}
                  </div>
                </div>
                {/* Group options */}
                <div>
                  {g.options.map((option) => {
                    const isSelected = value === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          onChange(option);
                          setOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
                          "hover:bg-primary/[0.06] focus:bg-primary/[0.08] focus:outline-none",
                          isSelected && "bg-primary/[0.08] text-primary font-semibold",
                          !isSelected && "text-foreground",
                        )}
                      >
                        <Check
                          className={cn(
                            "w-3.5 h-3.5 shrink-0",
                            isSelected ? "text-primary opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="flex-1 truncate">{option}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Persistent "Other (specify)" footer */}
        <div className="border-t border-input/40 bg-muted/20">
          <button
            type="button"
            onClick={() => {
              setCustomMode(true);
              onChange("");
              setOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-3 text-sm hover:bg-primary/[0.06] focus:bg-primary/[0.08] focus:outline-none transition-colors group"
          >
            <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 group-hover:bg-primary/15 transition-colors">
              <SquarePen className="w-3 h-3 text-primary" />
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-semibold text-foreground">Other (specify)</div>
              <div className="text-[11px] text-muted-foreground">Add your own — free text</div>
            </div>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
