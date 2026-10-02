/**
 * What happens after an agreement is created — shared by POST /api/contracts
 * and the agent/Copilot create_agreement executor, so an agreement made from
 * chat is announced exactly like one made from the form.
 */
import type { Contract, LocaleSettings, User } from "@shared/schema";
import { contractSignedEmail, sendEmail } from "../emails";

/** Contract-signed email to the person who created it — best-effort. */
export function notifyAgreementCreated(user: User, contract: Contract, settings: LocaleSettings): void {
  if (!user?.email) return;
  const { subject, html } = contractSignedEmail({
    firstName: user.firstName || undefined,
    brandName: contract.brandName,
    contractValueMinor: contract.contractValueMinor,
    contractId: contract.id,
    locale: settings,
  });
  void sendEmail({ to: user.email, subject, html });
}
