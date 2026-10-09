/**
 * The agent's tool registry. Imports the database-backed tools, so tests of the
 * loop use fake tools and never import this file.
 *
 * Nothing here contains business logic. A read tool wraps an existing read; a
 * mutation tool wraps an existing build/execute pair or shared service that
 * mirrors a REST route, so the agent does a thing exactly the way the app does:
 * same permission, same validation, same side effects.
 *
 * Every tool declares its risk class and its authorization. The loop's policy
 * decides run-versus-approve from those — the model decides nothing about that.
 *
 *   READ_ONLY              reads (including search_knowledge, get_lead_score, get_outreach_draft, parse_icp, get_discovery_run, get_prospect_intelligence), analysis, drafts of text (nothing written, nothing sent)
 *   SAFE_MUTATION          create_deal, update_deal, add_protection_term, create_quotation, revise_quotation,
 *                          and the lead pipeline: create_lead(s), update_lead, move_lead, add_lead_note,
 *                          create_ticket, complete_ticket, add_lead_claim, archive_lead,
 *                          update_invoice_details, update_workspace_profile, update_my_details,
 *                          add_knowledge_note, add_knowledge_url (both always ask: forceApproval),
 *                          research_lead (always asks), draft_outreach, mark_outreach_sent,
 *                          discover_prospects, research_prospect, find_decision_maker (all always ask),
 *                          get_outreach_angle, add_prospect_to_leads
 *   CONSEQUENTIAL_MUTATION share_quotation, create_agreement, create_signing_link,
 *                          create_invoice, mark_paid, mark_unpaid, convert_lead_to_deal, revise_agreement,
 *                          complete_deal, approve_outreach (shows the exact text; nothing is ever sent by the agent)
 *
 * Deliberately NOT here, and not to be added without the founder: deleting
 * anything, editing a signed document, billing and plan, team invitations and
 * roles, API keys, bank details, signature and seal, email and password,
 * region and currency, and the agent's own autonomy setting. The agent is a
 * superuser within the signed-in person's own role and workspace; these stay
 * with the person because a mistake (or a lead's text trying to steer the
 * agent) there cannot be undone.
 */
import type { AgentTool } from "../types";
import { validateRegistry } from "../registry";
import { DEAL_TOOLS } from "./deals";
import { DISCOVERY_TOOLS } from "./discovery";
import { DOCUMENT_STYLE_TOOLS } from "./document-style";
import { DOCUMENT_TOOLS } from "./documents";
import { IDEAL_CLIENT_TOOLS } from "./ideal-client";
import { KNOWLEDGE_TOOLS } from "./knowledge";
import { LEAD_TOOLS } from "./leads";
import { PAYMENT_TOOLS } from "./payments";
import { REVISE_TOOLS } from "./revise";
import { READ_TOOLS } from "./reads";
import { OUTBOUND_TOOLS } from "./outbound";
import { SALES_TOOLS } from "./sales";
import { WORKSPACE_TOOLS } from "./workspace";

export const AGENT_TOOLS: readonly AgentTool<any>[] = validateRegistry([...READ_TOOLS, ...DEAL_TOOLS, ...DOCUMENT_TOOLS, ...PAYMENT_TOOLS, ...LEAD_TOOLS, ...IDEAL_CLIENT_TOOLS, ...DISCOVERY_TOOLS, ...REVISE_TOOLS, ...DOCUMENT_STYLE_TOOLS, ...WORKSPACE_TOOLS, ...KNOWLEDGE_TOOLS, ...SALES_TOOLS, ...OUTBOUND_TOOLS]);
