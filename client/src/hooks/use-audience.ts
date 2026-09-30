import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { audienceLabels, normalizeAudience, type Audience, type AudienceLabels } from "@shared/audience";

export interface AudienceState extends AudienceLabels {
  /** The account's work type. Client work until the org says otherwise. */
  audience: Audience;
  isBrand: boolean;
  /** False until the org has loaded; the wording defaults to client work
   *  meanwhile, which is what every existing account reads. */
  ready: boolean;
}

/**
 * The account's work type and the wording that goes with it.
 *
 * Read from `/api/org`, which is already in the query cache on most screens,
 * so this is a read rather than a request (same approach as `useMoney`). Only
 * asked for when the account has an organisation. On a deal-scoped screen use
 * `dealAudienceLabels(deal.dealType)` instead: a deal's own type decides its
 * wording, the account default decides everything else.
 */
export function useAudience(): AudienceState {
  const { user } = useAuth();
  const hasOrg = Boolean((user as { organizationId?: string | null } | undefined)?.organizationId);
  const { data: org } = useQuery<{ audience?: string | null }>({
    queryKey: ["/api/org"],
    enabled: hasOrg,
    staleTime: 5 * 60 * 1000,
  });
  const audience = normalizeAudience(org?.audience);
  return {
    ...audienceLabels(audience),
    audience,
    isBrand: audience === "brand_collaboration",
    ready: !hasOrg || org != null,
  };
}
