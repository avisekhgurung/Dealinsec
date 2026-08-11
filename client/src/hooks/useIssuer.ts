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
}

export function useIssuer(): Issuer {
  const { user } = useAuth();
  const { data } = useQuery<Issuer>({
    queryKey: ["/api/org/issuer"],
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });

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
  };
}
