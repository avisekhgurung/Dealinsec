/**
 * The agreement's six numbered legal clauses — text ONLY, no rendering. This
 * is the single source both the freelancer's authenticated PDF
 * (client/src/pages/contract-pdf.tsx) and the client's public signed-copy
 * view (client/src/components/document/public-agreement-doc.tsx) build their
 * "Terms & Conditions" section from, so the document a client signs and the
 * document the freelancer keeps can never quietly drift apart — a change
 * here changes both at once.
 *
 * Bold spans use a tiny `**text**` convention (see renderClauseBody below)
 * instead of JSX, because this module has to stay plain data: it is read by
 * two different page components, and a return type of ReactNode would tie it
 * to one render tree.
 */
import { getAgreementCopy } from "./dealTypeTaxonomy";
import { countryName } from "./region";

/**
 * A country as English legal prose names it, for "the laws of …". Moved
 * here unchanged from contract-pdf.tsx — see the comment that used to sit
 * above it there for why this table exists and is pinned rather than reading
 * CLDR's display names directly.
 */
export const LEGAL_COUNTRY_NAMES: Readonly<Record<string, string>> = {
  AE: "the United Arab Emirates",
  AG: "Antigua and Barbuda",
  AX: "the Åland Islands",
  BA: "Bosnia and Herzegovina",
  BL: "Saint Barthélemy",
  BQ: "the Caribbean Netherlands",
  BS: "the Bahamas",
  CC: "the Cocos (Keeling) Islands",
  CD: "the Democratic Republic of the Congo",
  CF: "the Central African Republic",
  CG: "the Republic of the Congo",
  CI: "Côte d’Ivoire",
  CK: "the Cook Islands",
  CV: "Cabo Verde",
  CZ: "the Czech Republic",
  DO: "the Dominican Republic",
  FK: "the Falkland Islands",
  FM: "the Federated States of Micronesia",
  FO: "the Faroe Islands",
  GB: "England and Wales",
  GM: "the Gambia",
  HK: "Hong Kong",
  IM: "the Isle of Man",
  KM: "the Comoros",
  KN: "Saint Kitts and Nevis",
  KP: "North Korea",
  KR: "the Republic of Korea",
  KY: "the Cayman Islands",
  LC: "Saint Lucia",
  MF: "Saint Martin",
  MH: "the Marshall Islands",
  MK: "North Macedonia",
  MM: "Myanmar",
  MO: "Macao",
  MP: "the Northern Mariana Islands",
  MV: "the Maldives",
  NL: "the Netherlands",
  PH: "the Philippines",
  PM: "Saint Pierre and Miquelon",
  PN: "the Pitcairn Islands",
  PS: "the Palestinian Territories",
  SB: "Solomon Islands",
  SH: "Saint Helena",
  SJ: "Svalbard and Jan Mayen",
  ST: "São Tomé and Príncipe",
  SZ: "Eswatini",
  TC: "the Turks and Caicos Islands",
  TL: "Timor-Leste",
  TR: "Türkiye",
  TT: "Trinidad and Tobago",
  US: "the United States",
  VA: "Vatican City",
  VC: "Saint Vincent and the Grenadines",
  VG: "the British Virgin Islands",
  VI: "the United States Virgin Islands",
  WF: "Wallis and Futuna",
};

export const legalCountryName = (code: string): string => LEGAL_COUNTRY_NAMES[code] ?? countryName(code);

/**
 * The "not a certificate-based signature" fragment shared by every place
 * that says it — the public sign page's checkbox and confirmation line, the
 * agreement's own execution record, and the owner-facing signing-status
 * card. One source so a non-India signer is never asked to consent to text
 * naming an Indian identity scheme (Aadhaar) or an Indian statute (IT Act,
 * 2000) — that used to be hardcoded in three separate files and reached
 * every country unconditionally.
 */
export const notADscPhrase = (country: string): string =>
  country === "IN"
    ? "a Digital Signature Certificate or Aadhaar eSign"
    : "a certificate-based digital signature";

/**
 * The execution-record disclosure paragraph — what an "electronic
 * acceptance with an audit record" is and is not, plus (India only) the
 * stamp-duty disclaimer. Shared between the freelancer's own agreement PDF
 * (contract-pdf.tsx) and the client's public copy (public-agreement-doc.tsx)
 * so the two can't say different things to different readers of the same
 * signed document. Non-India gets no stamp-duty sentence: that is an Indian
 * instrument, not a universal one, and asserting it elsewhere was a bug.
 */
export function executionRecordDisclosure(country: string): string {
  const isIndia = country === "IN";
  const notCert = isIndia
    ? "it is not a Digital Signature Certificate issued under the Information Technology Act, 2000, and no certifying-authority verification is claimed"
    : "it is not a certificate-based digital signature, and no certifying-authority verification is claimed";
  const stampDuty = isIndia
    ? " Stamp duty and registration, where applicable, are the responsibility of the parties — DealInSec does not pay, issue or verify them."
    : "";
  return `This is an electronic acceptance with an audit record — ${notCert}. Parties may additionally execute a physically signed counterpart.${stampDuty}`;
}

export interface AgreementClause {
  n: number;
  title: string;
  /** May contain **bold** spans — see renderClauseBody. */
  body: string;
}

export interface AgreementClauseInputs {
  dealType?: string | null;
  /** ISO-3166 alpha-2. */
  country: string;
  exclusive: boolean;
  dealTitle: string;
  /** Already formatted in the document's own currency, e.g. "$5,000". */
  amountLabel: string;
  /** "five thousand US Dollars" — currencyProseName + formatAmount, already
   *  computed by the caller (those live in client/src/lib/format.ts, a
   *  client-only module this shared file deliberately doesn't depend on). */
  amountWordsLabel: string;
  startDateLabel: string;
  endDateLabel: string;
  hasOwnPaymentTerms: boolean;
}

export function buildAgreementClauses(args: AgreementClauseInputs): AgreementClause[] {
  const copy = getAgreementCopy(args.dealType);
  const isIndia = args.country === "IN";
  const country = legalCountryName(args.country);

  return [
    {
      n: 1,
      title: "Scope of Work",
      body: `The ${copy.providerNoun} agrees to provide ${copy.serviceDescription} for the ${copy.clientNoun} as described in the Deliverables section above, in connection with the engagement titled "${args.dealTitle}". ${copy.complianceNote}`,
    },
    {
      n: 2,
      title: "Deliverables & Timeline",
      body: `All deliverables shall be submitted for ${copy.clientNoun} approval at least 48 hours before the scheduled delivery or publication date. The ${copy.clientNoun} shall provide approval or revision requests within 24 hours of receipt. The ${copy.providerNoun} shall incorporate up to two (2) rounds of revisions at no additional charge. This Agreement is effective from **${args.startDateLabel}** through **${args.endDateLabel}**.`,
    },
    {
      n: 3,
      title: `Compensation (${args.amountLabel})`,
      body: `In consideration for the services rendered, the ${copy.clientNoun} shall pay the ${copy.providerNoun} a total fee of **${args.amountLabel}** (${args.amountWordsLabel} only). ${
        args.hasOwnPaymentTerms
          ? "Payment shall follow the schedule agreed between the parties as set out in the Deal-Specific Terms (Section 7) of this Agreement."
          : "Payment shall be structured as: 50% advance upon execution and 50% within 30 days of final deliverable approval."
      } Late payments attract interest at 1.5% per month.`,
    },
    {
      n: 4,
      title: copy.rightsHeading,
      body: copy.rightsText,
    },
    {
      n: 5,
      title: "Exclusivity Terms",
      body: args.exclusive ? copy.exclusiveText : copy.nonExclusiveText,
    },
    isIndia
      ? {
          n: 6,
          title: "Governing Law (Indian Contract Act 1872)",
          body: "This Agreement shall be governed by and construed in accordance with the laws of India, including the Indian Contract Act, 1872. Any disputes shall first be attempted to be resolved through good-faith negotiation for 30 days, failing which disputes shall be submitted to binding arbitration under the Arbitration and Conciliation Act, 1996. The courts of India shall have exclusive jurisdiction for any legal proceedings.",
        }
      : {
          n: 6,
          title: "Governing Law",
          // Deliberately names no statute and no arbitration scheme: we have
          // not verified which apply in each country, and a wrong citation
          // in a contract is worse than none.
          body: `This Agreement shall be governed by and construed in accordance with the laws of ${country}. Any disputes shall first be attempted to be resolved through good-faith negotiation for 30 days, failing which the courts of ${country} shall have exclusive jurisdiction for any legal proceedings.`,
        },
  ];
}
