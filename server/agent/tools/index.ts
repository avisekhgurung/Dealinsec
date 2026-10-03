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
 *   READ_ONLY              reads, analysis, drafts of text (nothing written, nothing sent)
 *   SAFE_MUTATION          create_deal, update_deal, add_protection_term, create_quotation,
 *                          and the lead pipeline: create_lead(s), update_lead, move_lead, add_lead_note,
 *                          create_ticket, complete_ticket, add_lead_claim, archive_lead
 *   CONSEQUENTIAL_MUTATION share_quotation, create_agreement, create_signing_link,
 *                          create_invoice, mark_paid, mark_unpaid, convert_lead_to_deal
 *
 * Deliberately NOT here: deleting anything, editing an agreement or a signed
 * document, revoking links, billing, team and settings.
 */
import type { AgentTool } from "../types";
import { validateRegistry } from "../registry";
import { DEAL_TOOLS } from "./deals";
import { DISCOVERY_TOOLS } from "./discovery";
import { DOCUMENT_TOOLS } from "./documents";
import { IDEAL_CLIENT_TOOLS } from "./ideal-client";
import { LEAD_TOOLS } from "./leads";
import { PAYMENT_TOOLS } from "./payments";
import { READ_TOOLS } from "./reads";

export const AGENT_TOOLS: readonly AgentTool<any>[] = validateRegistry([...READ_TOOLS, ...DEAL_TOOLS, ...DOCUMENT_TOOLS, ...PAYMENT_TOOLS, ...LEAD_TOOLS, ...IDEAL_CLIENT_TOOLS, ...DISCOVERY_TOOLS]);
