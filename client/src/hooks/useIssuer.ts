import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

/**
 * The organisation's document issuer — the owner's billing identity.
 *
 * Invoices and agreements must always show the same supplier name, PAN, GSTIN,
 * bank account and signature no matter which teammate opens them. Reading those
 * off the logged-in `user` made the document change per viewer (and leaked an
 * employee's PAN and bank details onto the org's invoices).
 *
 * Falls back to the current user so solo accounts and any load failure still
 * render a complete document.
 */
export interface Issuer {
  name: string;
  email: string;
  phone: string;
  panNumber: string;
  gstNumber: string;
  billingAddress: string;
  digitalSignature: string;
  companySeal: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  /** When these details were frozen onto the document, or null when they are
   *  the live profile. A screen can say "details as issued on …" from this. */
  issuedAt: string | null;
}

/**
 * The issuer as it stood when a document was issued, written onto the row by
 * the server (buildIssuerSnapshot in server/routes.ts — keep the two in step
 * until both move to shared/schema.ts beside the column).
 *
 * Issued documents are never rewritten, so this reader must accept every shape
 * ever stored, including ones newer than this build: an old tab reading a v2
 * row should still print the frozen values it can find, not today's profile.
 */
export interface IssuerSnapshot {
  v: number;
  capturedAt: string;
  country: string;
  name: string;
  email: string;
  phone: string;
  billingAddress: string;
  /** Labels are the ones that applied on the day. Matched by `field`, never by
   *  label text, so a relabelled country cannot orphan an old document. */
  taxIds: { field: string; label: string; number: string }[];
  bank: {
    accountHolderName: string;
    accountNumber: string;
    bankName: string;
    routingLabel: string;
    routingCode: string;
  };
  digitalSignature: string;
  companySeal: string;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The snapshot on an issued row, or null when the row predates snapshotting.
 *  The value is jsonb from the database, so nothing about its shape is taken
 *  on trust. */
function readSnapshot(issued: object | null | undefined): IssuerSnapshot | null {
  const raw = (issued as { issuerSnapshot?: unknown } | null | undefined)?.issuerSnapshot;
  if (!raw || typeof raw !== "object" || typeof (raw as { v?: unknown }).v !== "number") return null;
  return raw as IssuerSnapshot;
}

function fromSnapshot(s: IssuerSnapshot): Issuer {
  const taxIds = Array.isArray(s.taxIds) ? s.taxIds : [];
  const taxId = (field: string) => text(taxIds.find((t) => t?.field === field)?.number);
  const bank = s.bank && typeof s.bank === "object" ? s.bank : ({} as Partial<IssuerSnapshot["bank"]>);
  // Deliberately NO per-field fallback to the live profile. A GSTIN that was
  // blank on the day the invoice went out must stay blank — filling it from
  // today's profile is precisely the bug the snapshot exists to fix.
  return {
    name: text(s.name),
    email: text(s.email),
    phone: text(s.phone),
    panNumber: taxId("panNumber"),
    gstNumber: taxId("gstNumber"),
    billingAddress: text(s.billingAddress),
    digitalSignature: text(s.digitalSignature),
    companySeal: text(s.companySeal),
    accountHolderName: text(bank.accountHolderName),
    accountNumber: text(bank.accountNumber),
    ifscCode: text(bank.routingCode),
    bankName: text(bank.bankName),
    issuedAt: text(s.capturedAt) || null,
  };
}

/**
 * Pass the issued document — the brand invoice or contract row — when
 * rendering one. It then prints from the issuer frozen onto that row at issue
 * time, so a 2025 invoice keeps its 2025 GSTIN and bank account however the
 * profile changes afterwards.
 *
 * Call it with no argument (composing a new invoice, previewing a quotation)
 * for the live profile. A row without a snapshot — everything issued before
 * snapshotting existed — also gets the live profile, which is exactly what it
 * rendered before, so no existing document changes.
 */
export function useIssuer(issued?: object | null): Issuer {
  const { user } = useAuth();
  const snapshot = readSnapshot(issued);
  const { data } = useQuery<Issuer>({
    queryKey: ["/api/org/issuer"],
    // A snapshotted document never needs the live profile; hooks still run in
    // the same order either way.
    enabled: Boolean(user) && !snapshot,
    staleTime: 5 * 60 * 1000,
  });

  if (snapshot) return fromSnapshot(snapshot);

  const fallbackName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "";

  return {
    name: data?.name || fallbackName,
    email: data?.email || user?.email || "",
    phone: data?.phone || user?.phone || "",
    panNumber: data?.panNumber || user?.panNumber || "",
    gstNumber: data?.gstNumber || (user as any)?.gstNumber || "",
    billingAddress: data?.billingAddress || user?.billingAddress || "",
    digitalSignature: data?.digitalSignature || user?.digitalSignature || "",
    companySeal: data?.companySeal || (user as any)?.companySeal || "",
    accountHolderName: data?.accountHolderName || (user as any)?.accountHolderName || "",
    accountNumber: data?.accountNumber || (user as any)?.accountNumber || "",
    ifscCode: data?.ifscCode || (user as any)?.ifscCode || "",
    bankName: data?.bankName || (user as any)?.bankName || "",
    issuedAt: null,
  };
}
