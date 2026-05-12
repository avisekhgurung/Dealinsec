import { useState, useMemo, useEffect } from "react";
import { Check, ChevronsUpDown, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
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
 * Searchable combobox for taxonomy fields with grouped options and a
 * persistent "Other (specify)" escape hatch. When the user picks
 * "Other (specify)" — or types a value not present in the list — they
 * get a free-text input to enter their own value.
 */
export function TaxonomyCombobox({
  groups,
  value,
  onChange,
  placeholder = "Select...",
  testId,
}: TaxonomyComboboxProps) {
  const [open, setOpen] = useState(false);

  // Flat list of every predefined option (for membership check)
  const allOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) for (const o of g.options) set.add(o);
    return set;
  }, [groups]);

  const isFreeForm = groups.length === 1 && groups[0].options.length === 0;
  const isCustomValue = value !== "" && !allOptions.has(value) && value !== OTHER_OPTION;

  // Free-text input shown when:
  //  - taxonomy itself is free-form (Custom dealType), OR
  //  - user has selected "Other (specify)" / typed a custom value
  const [customMode, setCustomMode] = useState<boolean>(isFreeForm || isCustomValue);

  // Sync customMode when external value changes (e.g. dealType switch resets value)
  useEffect(() => {
    setCustomMode(isFreeForm || isCustomValue);
  }, [isFreeForm, isCustomValue]);

  if (customMode) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={value === OTHER_OPTION ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isFreeForm ? "Type your category" : "Specify your own"}
          className="h-11"
          data-testid={testId}
        />
        {!isFreeForm && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 px-2"
            onClick={() => {
              onChange("");
              setCustomMode(false);
            }}
            title="Back to list"
          >
            <ChevronsUpDown className="w-4 h-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-11 font-normal"
          data-testid={testId}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="w-4 h-4 ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." className="h-10" />
          <CommandList className="max-h-72">
            <CommandEmpty>
              <div className="text-sm text-muted-foreground px-4 py-3">
                No matches. Use <span className="font-medium">Other (specify)</span> below to add your own.
              </div>
            </CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.group} heading={g.group}>
                {g.options.map((option) => (
                  <CommandItem
                    key={option}
                    value={`${g.group} ${option}`}
                    onSelect={() => {
                      onChange(option);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "w-4 h-4 mr-2",
                        value === option ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value={OTHER_OPTION}
                onSelect={() => {
                  setCustomMode(true);
                  onChange("");
                  setOpen(false);
                }}
              >
                <Pencil className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="font-medium">{OTHER_OPTION}</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
