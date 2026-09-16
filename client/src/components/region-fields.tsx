/**
 * Country and currency, plus the time zone where there is room for it: the
 * one control behind both the signup step and Settings, so the two can never
 * disagree about what picking a country implies.
 *
 * The locale is never asked for. It follows the country (see localeForCountry
 * in shared/region.ts), because nobody signing up to send an invoice should
 * meet the words "BCP-47". The preview line underneath shows its effect.
 */
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { currencyProseName } from "@/hooks/use-locale";
import {
  CURRENCIES, currencyOptions, getCurrency, toMinor,
  type CurrencyCode, type LocaleSettings,
} from "@shared/schema";
import {
  COUNTRY_CODES, allTimeZones, countryName, currencyForCountry, guessCountry,
  normalizeTimeZone, regionForCountry, timeZoneLabel, zonesForCountry,
} from "@shared/region";

/** The zone this browser is in, IANA spelling, or null when it names nowhere. */
function browserTimeZone(): string | null {
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

/**
 * The region to pre-fill at signup, from what the browser already knows.
 *
 * Only ever a starting point: it is shown, editable, and nothing is stored
 * until the person submits. An Indian browser lands on exactly the India
 * defaults, so the common case needs no click at all.
 */
export function browserRegion(): LocaleSettings {
  const timeZone = browserTimeZone();
  let languages: readonly string[] = [];
  try {
    languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  } catch {
    // No navigator (a prerender): the time zone alone still decides.
  }
  return regionForCountry(guessCountry({ timeZone, languages }), { timeZone });
}

interface RegionFieldsProps {
  value: LocaleSettings;
  onChange: (next: LocaleSettings) => void;
  disabled?: boolean;
  /** Settings shows it; signup derives it silently to stay a single calm step. */
  showTimeZone?: boolean;
  /** Keeps ids and test ids unique when the control appears twice on a page. */
  idPrefix: string;
}

export function RegionFields({ value, onChange, disabled, showTimeZone, idPrefix }: RegionFieldsProps) {
  const [countryOpen, setCountryOpen] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);

  // The currency follows the country until the person picks one themselves.
  // A stored currency that differs from its country's default was exactly such
  // a pick, so it counts as pinned from the start: a freelancer in Germany who
  // bills in USD and corrects "Austria" to "Germany" keeps USD.
  const [currencyPinned, setCurrencyPinned] = useState<boolean | null>(null);
  const home = currencyForCountry(value.country);
  const pinned = currencyPinned ?? value.currency !== home.currency;

  const countries = useMemo(
    () => COUNTRY_CODES
      .map((code) => ({ code, name: countryName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name, "en")),
    [],
  );

  const chooseCountry = (code: string) => {
    setCountryOpen(false);
    if (code === value.country) return;
    onChange(regionForCountry(code, {
      currency: pinned ? value.currency : null,
      // Keep a zone the person already chose if it still fits the new country;
      // otherwise the zone they are actually in, if that fits.
      timeZone: zonesForCountry(code).includes(value.timezone) ? value.timezone : browserTimeZone(),
    }));
  };

  const chooseCurrency = (code: string) => {
    setCurrencyPinned(code !== home.currency);
    onChange({ ...value, currency: code as CurrencyCode });
  };

  const chooseZone = (zone: string) => {
    setZoneOpen(false);
    onChange({ ...value, timezone: zone });
  };

  // A sample large enough to show the grouping ("₹1,25,000" against
  // "$125,000") is what makes the choice feel real before anything is saved.
  const preview = useMemo(() => ({
    money: formatMoney(toMinor(125000, value.currency), value.currency, value.locale),
    date: formatDate(new Date(), value.locale, { timezone: value.timezone }),
  }), [value.currency, value.locale, value.timezone]);

  const currency = getCurrency(value.currency);

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 min-[360px]:grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-country`}>Country</Label>
          <Popover open={countryOpen} onOpenChange={setCountryOpen}>
            <PopoverTrigger asChild>
              <Button
                id={`${idPrefix}-country`}
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={countryOpen}
                disabled={disabled}
                className="w-full justify-between px-3 font-normal"
                data-testid={`${idPrefix}-country`}
              >
                <span className="truncate">{countryName(value.country)}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[16rem] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search countries…" />
                <CommandList>
                  <CommandEmpty>No country by that name.</CommandEmpty>
                  <CommandGroup>
                    {countries.map(({ code, name }) => (
                      <CommandItem
                        key={code}
                        value={code}
                        keywords={[name]}
                        onSelect={() => chooseCountry(code)}
                        data-testid={`${idPrefix}-country-${code}`}
                      >
                        <Check className={cn("h-4 w-4", value.country === code ? "opacity-100" : "opacity-0")} />
                        <span className="truncate">{name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-currency`}>Currency</Label>
          <Select value={value.currency} onValueChange={chooseCurrency} disabled={disabled}>
            <SelectTrigger id={`${idPrefix}-currency`} data-testid={`${idPrefix}-currency`}>
              <SelectValue>
                {currency.symbol === currency.code ? currency.code : `${currency.symbol} ${currency.code}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {currencyOptions.map((code) => (
                <SelectItem key={code} value={code}>
                  <span className="inline-block w-9 text-muted-foreground">{CURRENCIES[code].symbol}</span>
                  {code} · {CURRENCIES[code].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {showTimeZone && (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-timezone`}>Time zone</Label>
          <Popover open={zoneOpen} onOpenChange={setZoneOpen}>
            <PopoverTrigger asChild>
              <Button
                id={`${idPrefix}-timezone`}
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={zoneOpen}
                disabled={disabled}
                className="w-full justify-between px-3 font-normal"
                data-testid={`${idPrefix}-timezone`}
              >
                <span className="truncate">{timeZoneLabel(value.timezone)}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-0" align="start">
              {/* Its own component so the ~400 offset lookups run only while
                  the list is open, not on every render of the form. */}
              <TimeZoneList country={value.country} selected={value.timezone} onSelect={chooseZone} idPrefix={idPrefix} />
            </PopoverContent>
          </Popover>
        </div>
      )}

      {!home.local && !pinned && !disabled && (
        <p className="text-xs text-muted-foreground" data-testid={`${idPrefix}-currency-hint`}>
          Your local currency isn't supported yet, so amounts are in{" "}
          {currencyProseName(value.currency, value.locale)}. Pick whichever currency you invoice in.
        </p>
      )}

      <p className="text-xs text-muted-foreground" data-testid={`${idPrefix}-preview`}>
        Amounts will read <span className="font-medium text-foreground tabular-nums">{preview.money}</span>
        {" "}· dates <span className="font-medium text-foreground">{preview.date}</span>
      </p>
    </div>
  );
}

function TimeZoneList({ country, selected, onSelect, idPrefix }: {
  country: string;
  selected: string;
  onSelect: (zone: string) => void;
  idPrefix: string;
}) {
  const groups = useMemo(() => {
    const local = zonesForCountry(country);
    // A stored zone outside our list ("UTC" written by hand) still has to be
    // visible as the current value, or the picker would misreport it.
    if (!local.includes(selected) && !allTimeZones().includes(selected)) local.unshift(selected);
    const now = new Date();
    const item = (zone: string) => ({ zone, label: timeZoneLabel(zone, now) });
    return {
      local: local.map(item),
      other: allTimeZones().filter((z) => !local.includes(z)).sort().map(item),
    };
  }, [country, selected]);

  const renderItem = ({ zone, label }: { zone: string; label: string }) => (
    <CommandItem
      key={zone}
      value={zone}
      keywords={[label]}
      onSelect={() => onSelect(zone)}
      data-testid={`${idPrefix}-timezone-${zone}`}
    >
      <Check className={cn("h-4 w-4", selected === zone ? "opacity-100" : "opacity-0")} />
      <span className="truncate">{label}</span>
    </CommandItem>
  );

  return (
    <Command>
      <CommandInput placeholder="Search time zones…" />
      <CommandList>
        <CommandEmpty>No time zone by that name.</CommandEmpty>
        <CommandGroup heading={countryName(country)}>{groups.local.map(renderItem)}</CommandGroup>
        <CommandGroup heading="Everywhere else">{groups.other.map(renderItem)}</CommandGroup>
      </CommandList>
    </Command>
  );
}
