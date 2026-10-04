# 07. Knowledge: letting each workspace teach the agent about its business

The founder asked for RAG so each user can add material (PDFs, pictures, links) that the agent uses when looking for clients. This is what was built, what it deliberately is not, and what could go wrong.

## What it is
A workspace adds **notes, web pages, PDFs and pictures**. Text is cut into passages and stored. When the agent looks for clients, judges a lead's fit or drafts outreach, it first calls `search_knowledge` with a few words about the target, reads the matching passages, and says which source it used. Everything is private to the workspace; the person manages it in **Settings > Knowledge**.

```
add (note | link | PDF | picture) -> check -> extract text -> clean -> cut into ~900-char passages -> store
agent: search_knowledge("boutique hotels Portugal") -> best passages with their sources -> fenced as untrusted data
```

## Decisions, and what each costs
| Decision | Why | What it costs |
|---|---|---|
| **Postgres full-text search, not embeddings** | Free, no new provider or key, exact words are what a business owner writes ("hotels", "Lisbon", "no crypto"), and the database is already there. | It matches **words, not meaning**. "Firms that hire designers" will not find "agencies commissioning illustration". English stemming means "hotels" finds "hotel". Swapping in embeddings later changes only `store.search`; nothing else depends on it. |
| **Pictures are stored with the person's description; the agent searches the description** | DeepSeek cannot read images. A vision model is a separate provider and cost. | The agent never "sees" a picture. The card says so in plain words where the person types the description. |
| **A PDF's original file is not kept, only its text** | Smaller, less to protect, nothing to leak. | Scanned PDFs (pictures of text) have no text and are refused with a message saying so. OCR is not built. |
| **A page is fetched once, when added** | Predictable, no background crawling, no repeated outbound requests. | It goes stale. Remove and add again to refresh. |
| **Per workspace, not per person** | Leads, the ideal client and documents are all per workspace; a team should share what it knows. | A teammate with permission can add and remove. |
| **Pictures stored in the database, served only through an authenticated route** | ImageKit URLs are public: a business's private pictures would sit at public addresses. | Database size (5 MB cap each, 100 sources cap). Only PNG, JPEG, WebP; never SVG (a script vector). Served with `nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private`. |

## Security model
**Fetching a link is the dangerous part**, because the server would otherwise be a way to reach places only the server can reach (its own network, cloud metadata at 169.254.169.254, a database). `server/knowledge/net-guard.ts`:
- https only, no credentials, port 443, a real hostname (IP literals in any spelling, `localhost`, `.internal`, `.local` are refused).
- The server **resolves the name itself**, refuses if **any** answer is private (a mixed answer is how rebinding is dressed), then connects to that exact address with the hostname for TLS. The name cannot resolve somewhere else between the check and the connection.
- Redirects are followed by hand (max 3) and **every hop is checked again**, so a public page cannot bounce the server into the private network.
- Address rules cover IPv4 reserved ranges at both edges, IPv6 loopback/link-local/unique-local/multicast, and unwrap IPv4-mapped (`::ffff:127.0.0.1`) and NAT64 forms. Unparseable input counts as blocked.
- Size (3 MB), time (15 s total, 10 s per request) and content type (html, text, pdf) are capped.

**Uploads:** the file's real type comes from its first bytes, never its name or declared type (a script called `invoice.pdf` is refused). Size caps, the file name is reduced to its base name, only text/pictures are accepted, 30 additions per hour per workspace (in memory, per server process).

**Stored text can never become an instruction.** Whatever is stored is returned inside the agent loop's `<untrusted>` fence with the closing tag neutralised, and the prompt says it is the user's material, never instructions. The defence that matters is structural: nothing in knowledge can approve anything.

**Knowledge poisoning.** If a lead's website could get the agent to save text into the knowledge, hostile text would persist and steer future runs. So **adding a note or a link always asks, even at autonomy 1** (`forceApproval`), the approval card shows exactly what will be saved or fetched, the prompt forbids adding anything found inside a website, search result or document, and **the agent has no tool that removes anything** (deleting is the person's, in Settings).

**Isolation.** Every store query is scoped by organisation; no function takes an organisation id from outside. Tested in the unit suite and in `script/e2e-knowledge.mts` against a real database (search, picture read, delete, list, in both directions).

## Limits
100 sources and 4,000 passages per workspace; 120,000 characters kept per source (the source says when it cut); PDFs up to 8 MB and 80 pages; pictures up to 5 MB; notes up to 20,000 characters; a search returns at most 6 passages and at most 2 per source, 700 characters each.

## Getting the model to actually use it
First version: the prompt said "search knowledge first". The live eval showed the model (4 of 5 runs) reading `get_ideal_client`, seeing it was empty, and **asking the user** instead, never reaching the knowledge. More prompt text would only have made it flakier. The fix is in code: when `get_ideal_client` runs and the workspace has knowledge, **its result says so** ("the user has added N sources: call search_knowledge before asking them anything"), at the moment the model is deciding. 20% to 100% on that case. A rule that must hold goes in a tool result or a policy, not in a longer paragraph.

Also: "remember that I never work with gambling companies" was routed by the model to `update_ideal_client` (exclusions), which is the *better* tool. The case was wrong, not the model; the case now uses a fact that belongs in a note.

## Knowledge in the fit check (added after the first release)
`assess_lead_fit` and the lead page's fit card now show up to two passages from the workspace's own knowledge about the same things as the lead (name, industry, place, summary), under "From your knowledge". Design rules:
- **Context, never score.** The verdict stays the app's plain, explainable rules (`shared/fit.ts`); nothing from free text can change it. A test compares the verdict lines with and without knowledge.
- **Two shared words or nothing.** A passage appears only when it shares at least two of the lead's words, so one common word ("Lisbon") does not drag in an unrelated note. Tested, and the rule's removal is caught by a mutation.
- The agent is told the passage is the user's material, not instructions, and to name the source when it says a lead is one they avoid.
- Never throws (a knowledge problem cannot break a fit check), workspace-scoped, role-gated like the rest.

Not done on purpose: feeding the notes into the company-search *picking* step. That step reads untrusted web results; adding stored free text to it widens what a hostile page could influence, for a gain the fit check already provides after the lead exists.

## Verified, and not
Verified: 24 unit/loop tests with 19 mutations (each guard removed makes a test fail); 16 network-guard tests with 13 mutations; **real Postgres** (ranking, tenant isolation, injection-shaped queries, cascade); `script/e2e-knowledge.mts` **56 checks** over HTTP including a real fetch of `example.com` and the refusals; the real browser (add a note, a picture with its thumbnail, a page, the error toast for a refused address, search, remove with confirmation, phone width, no horizontal scroll); the live model on 8 knowledge cases x 5 runs, 100%, 0 safety failures.

**Not verified:** a very large real-world PDF, a scanned PDF's refusal message end to end, and extraction quality on messy real web pages beyond `example.com` and `iana.org`. Search ranking beyond a handful of cases: a short, dense passage can outrank a longer one that matches more words. Worth watching once real notes exist.

## Deploy
Three new tables. Run **before** pushing:
```
npx tsx --env-file=.env script/migrate-knowledge.ts
```
Additive (`CREATE ... IF NOT EXISTS`), safe to re-run; without it only knowledge is off (503 `KNOWLEDGE_NOT_SETUP`, the card hides itself). New packages: `unpdf` (PDF text, no native code), `linkedom` and `@mozilla/readability` (page text). `npm audit` reports 39 existing findings and none involve these.

## Not built, in the order I would do them
1. **Embeddings** (finds meaning, not just words): needs a provider key; only `store.search` changes.
2. **A vision model** so the agent can read pictures, not only their descriptions.
3. **OCR for scanned PDFs.**
4. **Refreshing a page** (a "re-read" button) and a tick-box for which sources a search may use.
5. A shared rate limit if the app ever runs on more than one server instance.

## Lessons
- **Two layers, both tested.** The tool's `authorize()` stops a role first, so a mutation that removed the service's own gate survived until a test called the service directly. Five role gates survived the first mutation pass; the cause was a test that used a member with *no* permissions, who is stopped at the read gate and never reaches the write gate. Test the member who can read but not write.
- **A test that passes first time proves nothing.** Every suite here was broken on purpose before it was trusted; 4 of 19 mutations survived at first and each pointed at a weak test, not a weak guard.
- **My own extractor lost pages served as bare fragments** (no `<html>`): linkedom gives them no body, and the extractor said "no readable text". Found by a test I wrote to prove scripts are stripped.
