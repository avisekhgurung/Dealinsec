/**
 * The icon that stands for "an amount of money" beside a figure or button.
 *
 * Every screen showed IndianRupee before the app knew about other currencies,
 * and Indian accounts must keep seeing exactly that. Anywhere else a rupee
 * glyph beside a pound amount is wrong, so every other currency gets the
 * neutral banknote. One rule, shared, so a screen cannot pick one and its
 * neighbour the other (the dashboard's pipeline tile follows the same rule).
 */
import { Banknote, IndianRupee, type LucideIcon } from "lucide-react";

export function moneyIcon(currency: string | null | undefined): LucideIcon {
  return currency === "INR" ? IndianRupee : Banknote;
}
