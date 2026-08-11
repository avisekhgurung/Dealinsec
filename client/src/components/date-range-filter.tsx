/**
 * DateRangeFilter — professional date filtering for the registers.
 *
 * Presets (incl. "This financial year" — Apr 1, the one Indian businesses
 * actually think in) + a custom range via the calendar. Emits {from, to}
 * (null = open-ended); pages filter rows with the exported inRange().
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarDays, ChevronDown, X } from "lucide-react";

export interface DateRange {
  from: Date | null;
  to: Date | null;
  label: string;
}

export const ALL_TIME: DateRange = { from: null, to: null, label: "All time" };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

function presets(): DateRange[] {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
  const fyStart = now.getMonth() >= 3
    ? new Date(now.getFullYear(), 3, 1)
    : new Date(now.getFullYear() - 1, 3, 1);
  const daysAgo = (n: number) => startOfDay(new Date(now.getTime() - n * 86_400_000));
  return [
    ALL_TIME,
    { from: monthStart, to: null, label: "This month" },
    { from: lastMonthStart, to: lastMonthEnd, label: "Last month" },
    { from: daysAgo(30), to: null, label: "Last 30 days" },
    { from: daysAgo(90), to: null, label: "Last 90 days" },
    { from: fyStart, to: null, label: "This financial year" },
  ];
}

/** True when a row's date falls inside the range (open ends pass). */
export function inRange(dateLike: Date | string | null | undefined, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  if (!dateLike) return false;
  const t = new Date(dateLike).getTime();
  if (!Number.isFinite(t)) return false;
  if (range.from && t < range.from.getTime()) return false;
  if (range.to && t > range.to.getTime()) return false;
  return true;
}

const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function DateRangeFilter({
  value, onChange,
}: { value: DateRange; onChange: (r: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const active = !!(value.from || value.to);

  const pick = (r: DateRange) => {
    onChange(r);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-9 rounded-xl font-medium text-xs lg:text-sm ${active ? "border-primary/50 text-primary" : "text-muted-foreground"}`}
          data-testid="date-range-filter"
        >
          <CalendarDays className="w-3.5 h-3.5 mr-1.5" />
          {value.label}
          {active ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date filter"
              className="ml-1.5 -mr-1 p-0.5 rounded hover:bg-primary/10"
              onClick={(e) => {
                e.stopPropagation();
                onChange(ALL_TIME);
              }}
            >
              <X className="w-3 h-3" />
            </span>
          ) : (
            <ChevronDown className="w-3.5 h-3.5 ml-1.5 opacity-60" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="w-[calc(100vw-1.5rem)] max-w-[340px] sm:w-auto sm:max-w-none p-0"
        data-testid="date-range-popover"
      >
        <div className="flex flex-col sm:flex-row">
          <div className="grid grid-cols-2 gap-1 p-2 border-b sm:border-b-0 sm:border-r border-border/60 sm:flex sm:flex-col sm:gap-0.5 sm:min-w-[150px]">
            {presets().map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => pick(p)}
                className={`text-left text-xs sm:text-sm px-2.5 py-2 sm:py-1.5 rounded-md transition-colors ${
                  value.label === p.label
                    ? "bg-primary/10 text-primary font-semibold"
                    : "hover:bg-muted/70"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="p-2 overflow-x-auto">
            <Calendar
              mode="range"
              numberOfMonths={1}
              selected={{ from: customFrom, to: customTo }}
              onSelect={(r: any) => {
                setCustomFrom(r?.from);
                setCustomTo(r?.to);
                if (r?.from && r?.to) {
                  pick({
                    from: startOfDay(r.from),
                    to: endOfDay(r.to),
                    label: `${fmt(r.from)} – ${fmt(r.to)}`,
                  });
                }
              }}
            />
            <p className="text-[11px] text-muted-foreground text-center pb-1">
              Pick a start and end date for a custom range
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
