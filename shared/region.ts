/**
 * Country → currency, locale and time zone: the data behind the signup country
 * picker and the Settings control that edits it later.
 *
 * Pure data and pure functions. Nothing here reads `navigator` or the clock, so
 * the server can validate a submitted country or time zone against exactly the
 * lists the picker offered, and the browser-reading glue stays in the client.
 *
 * India is a row in every table below, never a branch.
 * `regionForCountry("IN", { timeZone: "Asia/Kolkata" })` returns
 * DEFAULT_LOCALE_SETTINGS field for field, and that equality is what keeps an
 * Indian signup identical to every account that predates this file.
 */
import {
  CURRENCIES,
  DEFAULT_LOCALE_SETTINGS,
  getCurrency,
  type CurrencyCode,
  type LocaleSettings,
} from "./schema";

/**
 * Every inhabited ISO-3166-1 alpha-2 country with its IANA zones, space
 * separated, the likeliest one first.
 *
 * Generated from tzdata 2026c `zone.tab` rather than written by hand: a
 * hand-kept table drifts the first time a zone is renamed. zone.tab's own order
 * puts a remote island first for a few countries (Lord Howe for Australia,
 * Kaliningrad for Russia), so AU, BR, CA, FM, RU, UA and UZ were reordered to
 * lead with the zone most of their people live in. That first zone is only a
 * fallback, used when the browser's own zone lies outside the country picked.
 *
 * Uninhabited territories (AQ BV GS HM IO TF UM) are left out on purpose:
 * nobody invoices from them, and seven dead rows in the picker are noise.
 */
const ZONES_BY_COUNTRY: Record<string, string> = {
  AD: "Europe/Andorra", AE: "Asia/Dubai", AF: "Asia/Kabul", AG: "America/Antigua", AI: "America/Anguilla",
  AL: "Europe/Tirane", AM: "Asia/Yerevan", AO: "Africa/Luanda",
  AR: "America/Argentina/Buenos_Aires America/Argentina/Cordoba America/Argentina/Salta America/Argentina/Jujuy America/Argentina/Tucuman America/Argentina/Catamarca America/Argentina/La_Rioja America/Argentina/San_Juan America/Argentina/Mendoza America/Argentina/San_Luis America/Argentina/Rio_Gallegos America/Argentina/Ushuaia",
  AS: "Pacific/Pago_Pago", AT: "Europe/Vienna",
  AU: "Australia/Sydney Australia/Lord_Howe Antarctica/Macquarie Australia/Hobart Australia/Melbourne Australia/Broken_Hill Australia/Brisbane Australia/Lindeman Australia/Adelaide Australia/Darwin Australia/Perth Australia/Eucla",
  AW: "America/Aruba", AX: "Europe/Mariehamn", AZ: "Asia/Baku", BA: "Europe/Sarajevo", BB: "America/Barbados",
  BD: "Asia/Dhaka", BE: "Europe/Brussels", BF: "Africa/Ouagadougou", BG: "Europe/Sofia", BH: "Asia/Bahrain",
  BI: "Africa/Bujumbura", BJ: "Africa/Porto-Novo", BL: "America/St_Barthelemy", BM: "Atlantic/Bermuda",
  BN: "Asia/Brunei", BO: "America/La_Paz", BQ: "America/Kralendijk",
  BR: "America/Sao_Paulo America/Noronha America/Belem America/Fortaleza America/Recife America/Araguaina America/Maceio America/Bahia America/Campo_Grande America/Cuiaba America/Santarem America/Porto_Velho America/Boa_Vista America/Manaus America/Eirunepe America/Rio_Branco",
  BS: "America/Nassau", BT: "Asia/Thimphu", BW: "Africa/Gaborone", BY: "Europe/Minsk", BZ: "America/Belize",
  CA: "America/Toronto America/St_Johns America/Halifax America/Glace_Bay America/Moncton America/Goose_Bay America/Blanc-Sablon America/Iqaluit America/Atikokan America/Winnipeg America/Resolute America/Rankin_Inlet America/Regina America/Swift_Current America/Edmonton America/Cambridge_Bay America/Inuvik America/Vancouver America/Creston America/Dawson_Creek America/Fort_Nelson America/Whitehorse America/Dawson",
  CC: "Indian/Cocos", CD: "Africa/Kinshasa Africa/Lubumbashi", CF: "Africa/Bangui", CG: "Africa/Brazzaville",
  CH: "Europe/Zurich", CI: "Africa/Abidjan", CK: "Pacific/Rarotonga",
  CL: "America/Santiago America/Coyhaique America/Punta_Arenas Pacific/Easter",
  CM: "Africa/Douala", CN: "Asia/Shanghai Asia/Urumqi", CO: "America/Bogota", CR: "America/Costa_Rica",
  CU: "America/Havana", CV: "Atlantic/Cape_Verde", CW: "America/Curacao", CX: "Indian/Christmas",
  CY: "Asia/Nicosia Asia/Famagusta", CZ: "Europe/Prague", DE: "Europe/Berlin Europe/Busingen",
  DJ: "Africa/Djibouti", DK: "Europe/Copenhagen", DM: "America/Dominica", DO: "America/Santo_Domingo",
  DZ: "Africa/Algiers", EC: "America/Guayaquil Pacific/Galapagos", EE: "Europe/Tallinn", EG: "Africa/Cairo",
  EH: "Africa/El_Aaiun", ER: "Africa/Asmara",
  ES: "Europe/Madrid Africa/Ceuta Atlantic/Canary",
  ET: "Africa/Addis_Ababa", FI: "Europe/Helsinki", FJ: "Pacific/Fiji", FK: "Atlantic/Stanley",
  FM: "Pacific/Pohnpei Pacific/Chuuk Pacific/Kosrae",
  FO: "Atlantic/Faroe", FR: "Europe/Paris", GA: "Africa/Libreville", GB: "Europe/London",
  GD: "America/Grenada", GE: "Asia/Tbilisi", GF: "America/Cayenne", GG: "Europe/Guernsey", GH: "Africa/Accra",
  GI: "Europe/Gibraltar",
  GL: "America/Nuuk America/Danmarkshavn America/Scoresbysund America/Thule",
  GM: "Africa/Banjul", GN: "Africa/Conakry", GP: "America/Guadeloupe", GQ: "Africa/Malabo",
  GR: "Europe/Athens", GT: "America/Guatemala", GU: "Pacific/Guam", GW: "Africa/Bissau", GY: "America/Guyana",
  HK: "Asia/Hong_Kong", HN: "America/Tegucigalpa", HR: "Europe/Zagreb", HT: "America/Port-au-Prince",
  HU: "Europe/Budapest",
  ID: "Asia/Jakarta Asia/Pontianak Asia/Makassar Asia/Jayapura",
  IE: "Europe/Dublin", IL: "Asia/Jerusalem", IM: "Europe/Isle_of_Man", IN: "Asia/Kolkata", IQ: "Asia/Baghdad",
  IR: "Asia/Tehran", IS: "Atlantic/Reykjavik", IT: "Europe/Rome", JE: "Europe/Jersey", JM: "America/Jamaica",
  JO: "Asia/Amman", JP: "Asia/Tokyo", KE: "Africa/Nairobi", KG: "Asia/Bishkek", KH: "Asia/Phnom_Penh",
  KI: "Pacific/Tarawa Pacific/Kanton Pacific/Kiritimati",
  KM: "Indian/Comoro", KN: "America/St_Kitts", KP: "Asia/Pyongyang", KR: "Asia/Seoul", KW: "Asia/Kuwait",
  KY: "America/Cayman",
  KZ: "Asia/Almaty Asia/Qyzylorda Asia/Qostanay Asia/Aqtobe Asia/Aqtau Asia/Atyrau Asia/Oral",
  LA: "Asia/Vientiane", LB: "Asia/Beirut", LC: "America/St_Lucia", LI: "Europe/Vaduz", LK: "Asia/Colombo",
  LR: "Africa/Monrovia", LS: "Africa/Maseru", LT: "Europe/Vilnius", LU: "Europe/Luxembourg",
  LV: "Europe/Riga", LY: "Africa/Tripoli", MA: "Africa/Casablanca", MC: "Europe/Monaco",
  MD: "Europe/Chisinau", ME: "Europe/Podgorica", MF: "America/Marigot", MG: "Indian/Antananarivo",
  MH: "Pacific/Majuro Pacific/Kwajalein", MK: "Europe/Skopje", ML: "Africa/Bamako", MM: "Asia/Yangon",
  MN: "Asia/Ulaanbaatar Asia/Hovd", MO: "Asia/Macau", MP: "Pacific/Saipan", MQ: "America/Martinique",
  MR: "Africa/Nouakchott", MS: "America/Montserrat", MT: "Europe/Malta", MU: "Indian/Mauritius",
  MV: "Indian/Maldives", MW: "Africa/Blantyre",
  MX: "America/Mexico_City America/Cancun America/Merida America/Monterrey America/Matamoros America/Chihuahua America/Ciudad_Juarez America/Ojinaga America/Mazatlan America/Bahia_Banderas America/Hermosillo America/Tijuana",
  MY: "Asia/Kuala_Lumpur Asia/Kuching", MZ: "Africa/Maputo", NA: "Africa/Windhoek", NC: "Pacific/Noumea",
  NE: "Africa/Niamey", NF: "Pacific/Norfolk", NG: "Africa/Lagos", NI: "America/Managua",
  NL: "Europe/Amsterdam", NO: "Europe/Oslo", NP: "Asia/Kathmandu", NR: "Pacific/Nauru", NU: "Pacific/Niue",
  NZ: "Pacific/Auckland Pacific/Chatham", OM: "Asia/Muscat", PA: "America/Panama", PE: "America/Lima",
  PF: "Pacific/Tahiti Pacific/Marquesas Pacific/Gambier",
  PG: "Pacific/Port_Moresby Pacific/Bougainville", PH: "Asia/Manila", PK: "Asia/Karachi", PL: "Europe/Warsaw",
  PM: "America/Miquelon", PN: "Pacific/Pitcairn", PR: "America/Puerto_Rico", PS: "Asia/Gaza Asia/Hebron",
  PT: "Europe/Lisbon Atlantic/Madeira Atlantic/Azores",
  PW: "Pacific/Palau", PY: "America/Asuncion", QA: "Asia/Qatar", RE: "Indian/Reunion", RO: "Europe/Bucharest",
  RS: "Europe/Belgrade",
  RU: "Europe/Moscow Europe/Kaliningrad Europe/Kirov Europe/Volgograd Europe/Astrakhan Europe/Saratov Europe/Ulyanovsk Europe/Samara Asia/Yekaterinburg Asia/Omsk Asia/Novosibirsk Asia/Barnaul Asia/Tomsk Asia/Novokuznetsk Asia/Krasnoyarsk Asia/Irkutsk Asia/Chita Asia/Yakutsk Asia/Khandyga Asia/Vladivostok Asia/Ust-Nera Asia/Magadan Asia/Sakhalin Asia/Srednekolymsk Asia/Kamchatka Asia/Anadyr",
  RW: "Africa/Kigali", SA: "Asia/Riyadh", SB: "Pacific/Guadalcanal", SC: "Indian/Mahe", SD: "Africa/Khartoum",
  SE: "Europe/Stockholm", SG: "Asia/Singapore", SH: "Atlantic/St_Helena", SI: "Europe/Ljubljana",
  SJ: "Arctic/Longyearbyen", SK: "Europe/Bratislava", SL: "Africa/Freetown", SM: "Europe/San_Marino",
  SN: "Africa/Dakar", SO: "Africa/Mogadishu", SR: "America/Paramaribo", SS: "Africa/Juba",
  ST: "Africa/Sao_Tome", SV: "America/El_Salvador", SX: "America/Lower_Princes", SY: "Asia/Damascus",
  SZ: "Africa/Mbabane", TC: "America/Grand_Turk", TD: "Africa/Ndjamena", TG: "Africa/Lome",
  TH: "Asia/Bangkok", TJ: "Asia/Dushanbe", TK: "Pacific/Fakaofo", TL: "Asia/Dili", TM: "Asia/Ashgabat",
  TN: "Africa/Tunis", TO: "Pacific/Tongatapu", TR: "Europe/Istanbul", TT: "America/Port_of_Spain",
  TV: "Pacific/Funafuti", TW: "Asia/Taipei", TZ: "Africa/Dar_es_Salaam", UA: "Europe/Kyiv Europe/Simferopol",
  UG: "Africa/Kampala",
  US: "America/New_York America/Detroit America/Kentucky/Louisville America/Kentucky/Monticello America/Indiana/Indianapolis America/Indiana/Vincennes America/Indiana/Winamac America/Indiana/Marengo America/Indiana/Petersburg America/Indiana/Vevay America/Chicago America/Indiana/Tell_City America/Indiana/Knox America/Menominee America/North_Dakota/Center America/North_Dakota/New_Salem America/North_Dakota/Beulah America/Denver America/Boise America/Phoenix America/Los_Angeles America/Anchorage America/Juneau America/Sitka America/Metlakatla America/Yakutat America/Nome America/Adak Pacific/Honolulu",
  UY: "America/Montevideo", UZ: "Asia/Tashkent Asia/Samarkand", VA: "Europe/Vatican",
  VC: "America/St_Vincent", VE: "America/Caracas", VG: "America/Tortola", VI: "America/St_Thomas",
  VN: "Asia/Ho_Chi_Minh", VU: "Pacific/Efate", WF: "Pacific/Wallis", WS: "Pacific/Apia", YE: "Asia/Aden",
  YT: "Indian/Mayotte", ZA: "Africa/Johannesburg", ZM: "Africa/Lusaka", ZW: "Africa/Harare",
};

/**
 * ICU's canonical name → the IANA name, for zones IANA has renamed since.
 *
 * Chromium reports the ICU id, so an Indian on some Chrome builds resolves to
 * "Asia/Calcutta" while Firefox says "Asia/Kolkata". Stored values are always
 * the IANA spelling: "Asia/Kolkata" is what every pre-expansion row backfilled
 * to, and an Indian signing up from an older Chrome must write that same
 * string. Derived by resolving every zone.tab name through Node 22's full ICU
 * and keeping the ones that came back different.
 */
const ICU_TO_IANA_ZONE: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/**
 * The countries whose own currency we support, by currency — ISO 4217's
 * country table, filtered to CURRENCIES.
 *
 * A country absent here still gets a currency (see currencyForCountry); it is
 * just not presented as local. Partial on purpose: a currency added to
 * CURRENCIES without a row here is still pickable by hand, it simply is not
 * anyone's default yet.
 */
const COUNTRIES_BY_CURRENCY: Partial<Record<CurrencyCode, string>> = {
  INR: "IN BT",
  USD: "US AS BQ EC FM GU MH MP PA PR PW SV TC TL VG VI",
  GBP: "GB GG IM JE",
  // Bulgaria replaced the lev with the euro on 1 January 2026.
  EUR: "AD AT AX BE BG BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM VA YT",
  AUD: "AU CC CX KI NF NR TV",
  CAD: "CA",
  NZD: "CK NU NZ PN TK",
  SGD: "SG",
  AED: "AE",
  CHF: "CH LI",
  ZAR: "LS NA ZA",
  JPY: "JP",
  PKR: "PK",
  BDT: "BD",
  NPR: "NP",
  LKR: "LK",
  PHP: "PH",
  IDR: "ID",
  VND: "VN",
  THB: "TH",
  MYR: "MY",
  HKD: "HK",
  CNY: "CN",
  KRW: "KR",
  TWD: "TW",
  SAR: "SA",
  QAR: "QA",
  KWD: "KW",
  BHD: "BH",
  OMR: "OM",
  ILS: "IL",
  TRY: "TR",
  EGP: "EG",
  NGN: "NG",
  KES: "KE",
  GHS: "GH",
  MAD: "MA",
  BRL: "BR",
  MXN: "MX",
  COP: "CO",
  CLP: "CL",
  ARS: "AR",
  PEN: "PE",
  PLN: "PL",
  SEK: "SE",
  NOK: "NO SJ",
  DKK: "DK FO GL",
  CZK: "CZ",
  HUF: "HU",
  RON: "RO",
};

/**
 * Where a country's own currency is not supported yet, amounts default to US
 * dollars, the currency the large freelance marketplaces price work in. Always
 * shown to the person and always changeable, never applied silently.
 */
export const FALLBACK_CURRENCY: CurrencyCode = "USD";

/**
 * Countries CLDR has an English locale for ("en-IN", "en-GB", "en-DE").
 *
 * Every document and every screen is written in English, so the locale is an
 * English variant with the country's own conventions. "de-DE" would print
 * German month names in the middle of an English agreement. Kept as data
 * rather than tested at runtime because browsers ship trimmed ICU builds, and
 * the same German signup must store the same locale from a phone as from a
 * laptop. Generated by keeping each "en-XX" that Node 22's full ICU resolves to
 * itself instead of falling back to plain "en".
 */
const ENGLISH_LOCALE_COUNTRIES = new Set(
  ("AE AG AI AS AT AU BB BE BI BM BS BW BZ CA CC CH CK CM CX CY CZ DE DK DM EE ER ES FI FJ FK FM FR GB GD " +
    "GE GG GH GI GM GU GY HK HU ID IE IL IM IN IT JE JM JP KE KI KN KY LC LR LS LT LV MG MH MO MP MS MT MU " +
    "MV MW MY NA NF NG NL NO NR NU NZ PG PH PK PL PN PR PT PW RO RW SB SC SD SE SG SH SI SK SL SS SX SZ TC " +
    "TK TO TT TV TZ UA UG US VC VG VI VU WS ZA ZM ZW").split(" "),
);

/** CLDR's "English (world)": day-first dates and no US-specific conventions,
 *  the least surprising English for a country CLDR has no variant for. */
const WORLD_ENGLISH_LOCALE = "en-001";

// ── Lookups ────────────────────────────────────────────────────────────

export const COUNTRY_CODES: readonly string[] = Object.keys(ZONES_BY_COUNTRY);

let zoneCountry: Map<string, string> | null = null;
function countryByZone(): Map<string, string> {
  if (!zoneCountry) {
    zoneCountry = new Map();
    for (const [cc, zones] of Object.entries(ZONES_BY_COUNTRY)) {
      for (const zone of zones.split(" ")) zoneCountry.set(zone, cc);
    }
  }
  return zoneCountry;
}

let currencyCountry: Map<string, CurrencyCode> | null = null;
function localCurrencyByCountry(): Map<string, CurrencyCode> {
  if (!currencyCountry) {
    currencyCountry = new Map();
    for (const [code, countries] of Object.entries(COUNTRIES_BY_CURRENCY)) {
      for (const cc of countries!.split(" ")) currencyCountry.set(cc, code as CurrencyCode);
    }
  }
  return currencyCountry;
}

export function isCountryCode(code?: string | null): boolean {
  return Boolean(code) && Object.prototype.hasOwnProperty.call(ZONES_BY_COUNTRY, code!.trim().toUpperCase());
}

/** Every zone in the picker's list, IANA spelling. */
export function allTimeZones(): string[] {
  return Array.from(countryByZone().keys());
}

export function zonesForCountry(country?: string | null): string[] {
  const cc = country?.trim().toUpperCase();
  return cc && isCountryCode(cc) ? ZONES_BY_COUNTRY[cc].split(" ") : [];
}

/**
 * Any spelling of a zone → its IANA name in our list, or null.
 *
 * Null covers "UTC", "Etc/GMT+5" and garbage alike. None of them says where a
 * person is, so none of them may pick a country.
 */
export function normalizeTimeZone(tz?: string | null): string | null {
  const raw = tz?.trim();
  if (!raw) return null;
  const direct = ICU_TO_IANA_ZONE[raw] ?? raw;
  if (countryByZone().has(direct)) return direct;
  // A link such as "Europe/Belfast" or "US/Eastern": let Intl resolve it to a
  // canonical id, then map any ICU-era spelling onto IANA's.
  try {
    const resolved = new Intl.DateTimeFormat("en", { timeZone: raw }).resolvedOptions().timeZone;
    const iana = ICU_TO_IANA_ZONE[resolved] ?? resolved;
    return countryByZone().has(iana) ? iana : null;
  } catch {
    return null;
  }
}

export function countryForTimeZone(tz?: string | null): string | null {
  const zone = normalizeTimeZone(tz);
  return zone ? countryByZone().get(zone) ?? null : null;
}

/** The country a BCP-47 tag names, if any: "en-GB" → "GB", "zh-Hant-TW" → "TW". */
function countryOfLanguageTag(tag: string): string | null {
  const match = /^[a-z]{2,3}(?:-[a-z]{4})?-([a-z]{2})(?:-|$)/i.exec(tag.trim());
  const cc = match?.[1].toUpperCase();
  return cc && isCountryCode(cc) ? cc : null;
}

/**
 * Best guess at where someone works, from what their browser already knows.
 *
 * The time zone wins over the language. Plenty of Indian laptops say "en-US"
 * but no Indian clock says anything other than Asia/Kolkata, and someone living
 * abroad resets their clock long before their language. The language region
 * only speaks when the zone says nothing, as with privacy browsers pinned to
 * UTC. With neither, the platform default: the same values every account
 * created before this picker existed carries.
 *
 * "en-US" never speaks on its own. It is what those same privacy browsers
 * (Firefox resistFingerprinting, Tor, Brave) report alongside UTC, whatever
 * country the person is in, and it is the factory default on laptops sold in
 * India — so an Indian signing up from one was pre-filled as United States /
 * USD, and the region locks at the first deal. It is not evidence of the US,
 * so it is skipped and the default stands. A US signup's clock names a US zone
 * and is recognised from that; the picker stays visible either way.
 */
const UNINFORMATIVE_LANGUAGE_COUNTRIES: ReadonlySet<string> = new Set(["US"]);

export function guessCountry(hints: {
  timeZone?: string | null;
  languages?: readonly string[] | null;
}): string {
  const fromZone = countryForTimeZone(hints.timeZone);
  if (fromZone) return fromZone;
  for (const tag of hints.languages ?? []) {
    const cc = countryOfLanguageTag(tag);
    if (cc && !UNINFORMATIVE_LANGUAGE_COUNTRIES.has(cc)) return cc;
  }
  return DEFAULT_LOCALE_SETTINGS.country;
}

/** The currency a country defaults to, and whether it is that country's own. */
export function currencyForCountry(country: string): { currency: CurrencyCode; local: boolean } {
  const own = localCurrencyByCountry().get(country.trim().toUpperCase());
  return own ? { currency: own, local: true } : { currency: FALLBACK_CURRENCY, local: false };
}

export function localeForCountry(country: string): string {
  const cc = country.trim().toUpperCase();
  return ENGLISH_LOCALE_COUNTRIES.has(cc) ? `en-${cc}` : WORLD_ENGLISH_LOCALE;
}

/** The person's own zone when it is inside the country; otherwise the
 *  country's likeliest one. "Country US, zone Europe/London" is never stored
 *  by default, though the Settings picker still lets someone choose it. */
export function timeZoneForCountry(country: string, preferred?: string | null): string {
  const zones = zonesForCountry(country);
  const zone = normalizeTimeZone(preferred);
  if (zone && zones.includes(zone)) return zone;
  return zones[0] ?? DEFAULT_LOCALE_SETTINGS.timezone;
}

/**
 * Everything a country implies, with the two things a person may override.
 *
 * `currency` is honoured when it is one we support: a freelancer in Germany
 * billing American clients invoices in USD, and that is a choice, not an error.
 * `timeZone` is honoured when it lies inside the country.
 */
export function regionForCountry(
  country: string,
  overrides: { currency?: string | null; timeZone?: string | null } = {},
): LocaleSettings {
  const cc = isCountryCode(country) ? country.trim().toUpperCase() : DEFAULT_LOCALE_SETTINGS.country;
  const chosen = overrides.currency?.trim().toUpperCase();
  return {
    country: cc,
    currency: chosen && chosen in CURRENCIES
      ? (getCurrency(chosen).code as CurrencyCode)
      : currencyForCountry(cc).currency,
    locale: localeForCountry(cc),
    timezone: timeZoneForCountry(cc, overrides.timeZone),
  };
}

export function sameRegion(a: LocaleSettings, b: LocaleSettings): boolean {
  return a.country === b.country && a.currency === b.currency && a.locale === b.locale && a.timezone === b.timezone;
}

// ── Display ────────────────────────────────────────────────────────────

let regionNames: Intl.DisplayNames | null | undefined;

/** "IN" → "India". English for the reason the locale is English; the code
 *  itself when the runtime has no DisplayNames, so nothing ever renders blank. */
export function countryName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Asia/Kolkata" → "Kolkata · GMT+5:30". The offset is read for today, so it
 *  follows daylight saving rather than a table that would go stale. */
export function timeZoneLabel(tz: string, at: Date = new Date()): string {
  const city = tz.split("/").pop()!.replace(/_/g, " ");
  try {
    const offset = new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    return offset ? `${city} · ${offset}` : city;
  } catch {
    return city;
  }
}
