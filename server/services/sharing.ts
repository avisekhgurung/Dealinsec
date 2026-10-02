/**
 * Creating the two public links — the quotation link (/d/:token) and the
 * agreement signing link (/s/:token).
 *
 * Moved out of the REST handlers unchanged so the routes and the agent's tools
 * run the SAME code: same permission, same organization check, same frozen
 * redacted snapshot, same token. The handlers now only translate the result to
 * HTTP. Nothing is emailed: creating a link makes it available, the user
 * decides who receives it.
 */
import crypto from "crypto";
import { memberCan } from "@shared/permissions";
import { hasProAccess, type User } from "@shared/schema";
import { buildQuoteShareSnapshot } from "@shared/quoteShare";
import { buildAgreementShareSnapshot } from "@shared/contractSign";
import { storage } from "../storage";
import { getBillingUser } from "../entitlements";
import { documentLocaleFor } from "../routes";

type Fail = { ok: false; status: number; error: string };

const inOrg = (r: { organizationId?: string | null; userId?: string | null } | null | undefined, user: { id: string; organizationId?: string | null }) =>
  !!r && (r.organizationId ? r.organizationId === user.organizationId : r.userId === user.id);

/** A capability URL's token: 192 bits, base64url. */
const newToken = () => crypto.randomBytes(24).toString("base64url");

const issuerNameOf = (u: User) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "";

export async function createQuoteShareLink(
  user: User,
  dealId: number,
): Promise<{ ok: true; token: string; url: string; sharedAt: Date | null } | Fail> {
  if (!memberCan(user, "quotations.create")) return { ok: false, status: 403, error: "Your role doesn't allow sharing quotations." };
  const deal = await storage.getDeal(dealId);
  if (!deal || !inOrg(deal, user)) return { ok: false, status: 404, error: "Deal not found" };
  const quote = await storage.getQuoteByDealId(deal.id);
  if (!quote) return { ok: false, status: 400, error: "Generate the quotation before sharing it." };

  const settings = await documentLocaleFor(user);
  const snapshot = buildQuoteShareSnapshot({ issuerName: issuerNameOf(user), deal, quoteId: quote.id, version: quote.version, settings });

  const token = newToken();
  const updated = await storage.updateQuote(quote.id, {
    shareToken: token,
    shareSnapshot: snapshot as any,
    sharedAt: new Date(),
    shareRevokedAt: null,
    acceptedAt: null, // a re-share (edited deal) starts the acceptance signal over
  });
  if (!updated) return { ok: false, status: 500, error: "Couldn't create the share link." };
  return { ok: true, token, url: `/d/${token}`, sharedAt: updated.sharedAt ?? null };
}

export async function createAgreementSignLink(
  user: User,
  contractId: number,
): Promise<{ ok: true; url: string; sharedAt: Date | null } | Fail> {
  if (!memberCan(user, "agreements.create")) return { ok: false, status: 403, error: "Your role doesn't allow sending this for signature." };
  const contract = await storage.getContract(contractId);
  if (!contract || !inOrg(contract, user)) return { ok: false, status: 404, error: "Agreement not found" };
  if (contract.signedByBrand) return { ok: false, status: 409, error: "This agreement is already signed." };

  const billing = await getBillingUser(user);
  if (!hasProAccess(billing)) return { ok: false, status: 403, error: "Agreements are a Pro feature." };

  const deal = await storage.getDeal(contract.dealId);
  const settings = await documentLocaleFor(user, contract);
  const snapshot = buildAgreementShareSnapshot({
    issuerName: issuerNameOf(user),
    contract,
    dealType: deal?.dealType,
    exclusive: contract.exclusive,
    deliverables: deal?.deliverables,
    dealStandardTermIds: (deal?.standardTermIds as string[] | null) ?? [],
    dealCustomTerms: deal?.customTerms ?? null,
    dealBrandTerms: deal?.brandTerms,
    settings,
  });

  const token = newToken();
  const updated = await storage.updateContract(contract.id, {
    clientShareToken: token,
    clientSignShareSnapshot: snapshot as any,
    clientSharedAt: new Date(),
    clientShareRevokedAt: null,
  });
  if (!updated) return { ok: false, status: 500, error: "Couldn't create the signing link." };
  return { ok: true, url: `/s/${token}`, sharedAt: updated.clientSharedAt ?? null };
}
