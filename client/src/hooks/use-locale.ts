/**
 * The React binding for the app's one formatter (shared/money.ts).
 *
 * Two questions live here, and they are NOT interchangeable:
 *
 *  • `useLocale()` — the signed-in person's own country/locale/timezone. Use it
 *    for things that are about *them*: their plan renewal date, the timestamps
 *    in their own activity feed.
 *
 *  • `useMoney()` — the formatters bound to the ORGANISATION's settings. Use it
 *    for every stored amount. A deal's value is denominated in the currency the
 *    org agreed and stored it in; formatting it with the viewer's currency would
 *    relabel ₹65,000 as €65,000 for a member working abroad. The currency
 *    belongs to the money, never to whoever happens to be looking at it — the
 *    same rule the documents follow.
 *
 * This file holds no money-formatting logic of its own on purpose. It resolves which
 * locale applies and hands that to `makeFormatters`; the moment it starts
 * rounding or concatenating a glyph, it has become the eleventh copy.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  documentLocaleSettings,
  makeFormatters,
  moneyInputValue,
  type Formatters,
} from "@/lib/format";
import {
  fromMinor,
  getCurrency,
  getLocaleSettings,
  toMinor,
  type LocaleFields,
  type LocaleSettings,
} from "@shared/schema";

/** Moved to shared/money.ts, where it is a fixed table rather than Intl — see
 *  the comment there. Re-exported so existing imports keep working. */
export { currencyProseName } from "@/lib/format";

/** The signed-in person's own settings. */
export function useLocale(): LocaleSettings {
  const { user } = useAuth();
  const l = user as LocaleFields | undefined;
  return useMemo(
    () => getLocaleSettings(l),
    [l?.country, l?.currency, l?.locale, l?.timezone],
  );
}

/**
 * Thrown by `useMoney().minor()` when the currency a write would be stored in
 * is not known yet. A caller that gates its submit on `ready` never sees it;
 * it exists so a caller that forgot to cannot save in the wrong currency.
 */
export class MoneyCurrencyPendingError extends Error {
  constructor() {
    super("Your organisation's currency is still loading, so nothing was saved. Please try again in a moment.");
    this.name = "MoneyCurrencyPendingError";
  }
}

export interface MoneyFormat extends Formatters {
  /** The resolved BCP-47 tag, for the handful of screens that still need their
   *  own `toLocaleDateString` options (a chart axis, a "5 Sep" list row). */
  locale: string;
  /**
   * True once the currency amounts are STORED in is known for certain: the
   * organisation's row has loaded (or the account has no organisation, in
   * which case the server uses the person's own row and so do we).
   *
   * Every money WRITE must wait for this — disable the submit button, and do
   * not seed an editable amount field from `input()`/`major()` until it is
   * true. Display may render before it; a write may not.
   */
  ready: boolean;
  /**
   * True when the organisation's row could not be loaded, so `ready` will not
   * turn true on its own (queries here do not retry). A screen gated on
   * `ready` shows a retry instead of waiting forever — and still does not fall
   * back to the member's own settings, which is the wrong-currency write or
   * wrong-country document that gate exists to prevent.
   */
  failed: boolean;
  /** Asks for the organisation's row again, after `failed`. */
  retry: () => void;
  /** Minor units → major, for SEEDING an editable field (only once `ready`).
   *  Never for arithmetic. */
  major: (minor: number | null | undefined) => number;
  /** Minor units → the plain string an `<input>` holds ("65000", "1250.50").
   *  Seed from it only once `ready`. */
  input: (minor: number | null | undefined) => string;
  /** Major units a human typed → minor, for sending. Call exactly once.
   *  THROWS MoneyCurrencyPendingError until `ready` — see there. */
  minor: (major: number) => number;
  /** Keystrokes → what a free-text amount field may hold: digits, and one
   *  decimal point with no more places than the currency has (none for JPY).
   *  A second "." would make the value NaN, which `minor()` refuses to send;
   *  a third decimal place would be silently rounded away. Both are stopped at
   *  the keyboard instead. */
  cleanInput: (raw: string) => string;
  /** `step` for a `type="number"` amount field: one minor unit ("0.01", or "1"
   *  for JPY). The browser then refuses a third decimal place — 65000.005 —
   *  instead of `minor()` silently rounding it to a figure nobody typed. Every
   *  stored amount is a whole number of minor units, so a seeded value always
   *  satisfies it. */
  inputStep: string;
}

/**
 * The formatters bound to the currency stored amounts are denominated in.
 *
 * `/api/org` is already in the query cache on most screens, so this is a read
 * rather than a request. It is only asked for when the account HAS an
 * organisation: the public pages never fire a 401, and a solo account never
 * fires the 403 `withOrg` answers it with.
 */
export function useMoney(): MoneyFormat {
  const { user } = useAuth();
  const member = user as (LocaleFields & { organizationId?: string | null }) | undefined;
  const hasOrg = Boolean(member?.organizationId);
  const { data: org, isError: orgError, refetch: refetchOrg } = useQuery<LocaleFields>({
    queryKey: ["/api/org"],
    enabled: hasOrg,
    staleTime: 5 * 60 * 1000,
    // Document pages and money writes wait on this. The app-wide default is
    // retry:false, which let one transient failure replace an already-issued
    // agreement or invoice with an error screen.
    retry: 2,
  });

  // DISPLAY may fall back to the member's own settings while the org loads —
  // a figure shown for a moment in the member's glyph is recoverable.
  const settings = documentLocaleSettings(org, member);
  const { currency, locale, country, timezone } = settings;

  // WRITES may not. Converting a typed amount with the member's exponent and
  // then storing it as the org's currency is a wrong figure in the database.
  // This mirrors the server exactly (documentLocaleFor in server/routes.ts):
  // an account with an organisation is denominated in the org's currency, a
  // solo account in its own. Until that answer is loaded, there is no currency
  // to write in — so `ready` is false and `minor()` refuses, rather than
  // falling back field-by-field the way display does. Once `org` has loaded,
  // `settings.currency` IS the org's (the column is NOT NULL), so the write
  // path and the display path agree from then on.
  const ready = Boolean(member) && (!hasOrg || org != null);
  const failed = !ready && hasOrg && orgError;

  // Memoised on the primitives, not on the objects: these formatters are handed
  // to `useMemo`d column definitions, and a fresh identity every render would
  // rebuild every table on every keystroke.
  return useMemo(() => {
    const f = makeFormatters(settings);
    return {
      ...f,
      locale,
      ready,
      failed,
      retry: () => { void refetchOrg(); },
      major: (minor) => fromMinor(minor ?? 0, currency),
      input: (minor) => moneyInputValue(minor ?? 0, currency),
      minor: (major) => {
        if (!ready) throw new MoneyCurrencyPendingError();
        return toMinor(major, currency);
      },
      cleanInput: (raw) => {
        const { exponent } = getCurrency(currency);
        const [whole, ...fraction] = raw.replace(/[^\d.]/g, "").split(".");
        return exponent === 0 || fraction.length === 0
          ? whole
          : `${whole}.${fraction.join("").slice(0, exponent)}`;
      },
      inputStep: (() => {
        const { exponent } = getCurrency(currency);
        return exponent === 0 ? "1" : `0.${"0".repeat(exponent - 1)}1`;
      })(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, currency, locale, timezone, ready, failed]);
}
