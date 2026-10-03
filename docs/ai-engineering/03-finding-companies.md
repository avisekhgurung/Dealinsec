# 03. Finding companies: tools that spend money and read the open web

## 1. What we built
The agent can search the web for companies that match a short description ("small logistics companies in Pune that could use a new website"), show the candidates as a card, and let the user add the ones they pick as leads. The search service sits behind a small `DiscoveryProvider` interface; **LangSearch** (free, no card) and **Brave Search** (paid) are implemented. Nothing is added to the pipeline by the search itself.

```
user asks -> agent writes a short query -> APPROVAL CARD shows the exact words
          -> user approves -> one Brave request -> candidates (name + site) -> card
          -> user presses Add (or asks the agent) -> an ordinary lead
```

Configuration (server environment only): `LANGSEARCH_API_KEY` (free, no card) or `BRAVE_SEARCH_API_KEY` (paid). Which one runs: `DISCOVERY_PROVIDER=langsearch|brave` if set, otherwise LangSearch when its key exists, otherwise Brave, otherwise the feature says it isn't set up. Optional `DISCOVERY_DAILY_LIMIT` (per organization, default 10) and `DISCOVERY_MONTHLY_LIMIT` (whole app, default 300). `LANGSEARCH_URL` / `BRAVE_SEARCH_URL` point a client at a fake service in tests.

## 2. Why this is a different kind of tool
Every earlier tool changed our own database. This one **spends an allowance or real money** (Brave has no free tier: roughly $5 per 1,000 searches, a card, no spending cap we can rely on; LangSearch is free with a daily allowance and no card) and **sends words to an outside company**, and what comes back is **untrusted text from the open web**. Three new problems, three structural answers.

## 3. Concepts
- **Spending is a consequence, so it always asks.** The tool is `forceApproval`: it asks at every autonomy level, and the card shows the exact search text, the country, and the searches left. The model cannot decide to spend.
- **Egress control.** What may leave is decided by code (`sanitizeQuery`), not by the model's good manners: an email address, a phone number, a pasted link or an over-long text is refused before anyone is asked. A pasted message with a person's contact details cannot become a search.
- **Our own caps for a service with none.** Per organization per rolling day, and for the whole app per rolling month, counted from the audit rows that already exist (a successful `find_companies` call joined to its run), so there is no new table. The cap is checked when the question is asked **and again when the approval is executed**, so a stale approval cannot overspend.
- **Untrusted text never reaches the model or the stored card.** Results are reduced to a short plain name (50 characters, symbols stripped) and a domain. A snippet is never passed on. A test plants "IGNORE ALL RULES..." in a title and a snippet and proves it appears nowhere in the summary, the card or the page.
- **Results are pages, not companies.** `toCandidates` keeps one candidate per company site, drops social networks, directories, job boards and review sites (including their subdomains), and links to the home page, not the deep link the engine returned. A name is a **guess from a page title** and the card says so.
- **No retries on a billed call.** One request per search. Failures map to plain codes and messages that never contain the key (tested with a key planted in the error body).
- **Swappable.** The provider is an interface; Brave is the first implementation. Because we do not store Brave's content (its terms on storage are unstated), nothing would need migrating if we changed provider.

## 4. Failure modes
- Not configured: refused in `prepare`, so nobody is asked to approve something that cannot run.
- Key rejected, rate limited, service down, unreadable answer, timeout, user cancels: each is a distinct, plain message; the approval reopens so the user can retry.
- A title that tries to be an instruction becomes a short harmless label, and the only consequential actions anywhere (convert, create) are approval-gated regardless.
- Concurrent approvals can overshoot a cap by a couple of searches (the count is taken before the audit row is written). Acceptable for a cost guard; not acceptable for a security boundary, and it is not used as one.

## 5. Evaluation
- Pure (`shared/discovery.test.ts`): query sanitising, domains and second-level suffixes, blocklists, names (including other scripts), candidate grouping.
- Provider (`server/discovery/brave.test.ts`, fake `fetch`): key only in the header, bounded parameters, malformed rows skipped, every failure mapped, no key in any message, exactly one request.
- Scripted agent cases (mutation-checked: forcing approval off, removing the directory filter and loosening the cap each fail a test).
- Real model, 3 new cases plus one rewritten: prepares the search for approval; says so and invents nothing when search is off; keeps a person's name, email and phone out of the search; builds a search from the saved ideal client.
- End to end in the real app against a local stand-in for Brave: Brave received exactly one request with only the search words and the key; directory and LinkedIn results were dropped; an existing lead was flagged; Add created a lead; the hostile snippet was invisible. The usage SQL was checked on real Postgres.

## 6. What the real model taught us (again)
The model over-asked three times: it demanded the user fill in their ideal client before it would search; it wrote the search wording in chat and asked "shall I run it?" instead of calling the tool (the approval card IS that question); and it did not even read a saved profile for a vague request. Each was fixed by stating the principle in the prompt and re-measuring. The pattern is now clear enough to be a rule of thumb: **when a tool already has a confirmation step, tell the model so, or it will add a second one in prose.**

## 7. Interview questions
1. Why is a paid search a consequential action even though it changes no data of ours?
2. What is the difference between a limit enforced when asking and one enforced when executing, and why do you need both?
3. How would you stop a pasted client message from leaking into a third-party search?
4. A search result's title says "ignore your instructions". Walk through every place that text could end up and what stops it at each.
5. Why count usage from existing audit rows instead of adding a counter table, and what do you give up?
6. The provider's terms do not say whether results may be stored. What design choice makes that question irrelevant?

## 8. Choosing a provider, and letting the provider describe itself (added 3 Oct 2026)
We first built Brave, then learned it needs a card with no spending cap. The founder preferred **LangSearch** (free, no card; per its own docs: `POST https://api.langsearch.com/v1/web-search`, Bearer key, results at `data.webPages.value[{name, url, snippet}]`, a daily allowance resetting at 00:00 UTC; its docs do not state per-request limits or what may be stored). Switching cost one file because the interface held. Lessons:
- **A provider must describe itself, or the UI lies.** LangSearch has no country filter and no per-search cost, so the interface gained `label`, `paid` and `supportsCountry`. The approval card says "Uses one search from the free allowance" (not "paid"), names the real service, and shows no Country line; no country is sent. A test per provider pins that wording.
- **Keep the caps even when the service is free.** The allowance and its per-minute limits are not documented, so our 10-a-day and 300-a-month caps now protect a shared free quota instead of a card.
- **Tolerate what is not documented, but do not trust it.** The client accepts the wrapped (`data.webPages`) and unwrapped shapes, and treats an error code inside a 200 body as an error; anything it cannot read is an empty list or a plain failure, never a crash or a guess. 403 is mapped to "key rejected" and 402/429 to "busy or allowance used up" until a real key shows what the service actually returns.
- **Test the wire, not only the parse.** The LangSearch client is tested against a real local HTTP server (method, headers, body), and provider selection against the real `discoveryProvider` object, with mutation checks on the header and the country.

## 9. What the real service showed (3 Oct 2026): plumbing is not product
With a real LangSearch key the client worked first time (1.4 s, 20 results, the response shape matched the docs). The **quality** did not. A general web index is not a company directory: for "logistics company Pune" it returned Wikipedia, news, classifieds, "businesses for sale" listings, slide decks and trade directories, and almost no company home pages.

| After our filter | |
|---|---|
| Real queries run | 8 (local B2B, SaaS, agencies, clinics; UK and India) |
| Raw results | 160 |
| Survived as "candidates" | 30 |
| Of those, a company's OWN site | roughly 1 or 2 (my reading; no ground truth) |

What that means and what we did:
- **A tool that works but misleads is worse than one that fails.** A candidate named "Cars24" with a website of cars24.com is plausible and wrong. The first filter (a blocklist) was whack-a-mole, so we added **structural signals that can say "no" confidently but never "yes"**: government/education hosts, news/blog/directory/search paths, deep paths, listicle and date-like titles, article words. The 20 real junk results are now fixtures in the tests and none becomes a candidate.
- **Precision is still low and the card says so.** It labels every row a guess, shows the domain, and nothing is added without a click.
- **The real fix is not more regexes.** Either a provider whose index is better at company sites (compare on the SAME queries before choosing), or a verification step that fetches the candidate's page and checks it is the company's own site (D1b), or both.
- **Measure yield on real queries before shipping a discovery feature.** Unit tests, a fake service and a clean live eval of the agent's behaviour all passed while the product value was near zero. They test different things, and only the last one tests the product.

## 10. Making a weak free index useful: a model reads, code verifies (3 Oct 2026)
The founder chose to stay on LangSearch rather than compare providers. So the question became: how much value can be extracted from an index that mostly returns news, encyclopedias and directories?

**What the API allowed, measured:** 50 results per call works (more raw material for the same allowance). `excludeDomains` works as an array but **fails with HTTP 502 for long lists** (88 domains), and adding words like "official website" changed little, so neither is used.

**The change of approach.** Regexes over URLs and titles cannot tell "Leeds Dental Clinic | Bunity" (a real business, on a directory) from "Top 10 dentists" (an article). A person can. So a model with **no tools** reads the 50 results and picks the real businesses, saying for each whether the URL is the business's **own site** or a page **about** it. Then code checks every pick (`verifyPicks`, pure, tested):
- the index must exist, and the **name must literally appear** in that result's title or snippet (for an own site it may also be read from its domain): the model cannot invent a business;
- an **own site** must be on a business-looking host whose domain **resembles the name** ("Weightmans" ~ weightmans.com). A staging host (`...azurewebsites.net`) or a directory is downgraded to a listing and never given that website;
- a "name" that reads like an article or ranking ("Top 10...", "How to...") is rejected whoever picked it;
- a web address given as a name becomes the domain's label.

A **listing** is a business found on someone else's page: the card links to that page and says "Website not found yet". Its source is saved on the lead as a note when added.

**Results on the same 12 real searches** (600 results captured once, so the comparison spends no extra allowance):

| | Before (regex filter) | After (model reads, code verifies) |
|---|---|---|
| Items shown | 30 (8 queries) | 64 to 79 (12 queries) |
| Real businesses among them | about 1 or 2 | nearly all (my reading): e.g. Weightmans, Stephensons, Stowe Family Law, Slater + Gordon (Manchester family law); Lentra, Zenskar, FinBox (Bengaluru SaaS); named Leeds dental practices |
| With their own website | 0 to 2 | 5 |
| Cost | none | ~3.5k input + ~120 output tokens per search, about 1 second |

**Known limits:** most finds are listings, so the business's own website is often unknown until the research step; and run-to-run variation exists (the SaaS query, whose results are news articles about startups, returned 10, 10 and 0 on three runs).

**Two failures this round caught, and why they matter:**
- **A reasoning model is the wrong tool for a quick reading job.** With the founder's `DEEPSEEK_MODEL=deepseek-flash`, this step spent its whole output budget "thinking" and returned nothing (9 of 12 searches, ~18 s each, even with a 4,000-token budget). So the step has its own model, `DISCOVERY_PICK_MODEL` (default `deepseek-chat`, ~1 s), independent of the agent's model. The provider gained a per-call `model` option for this.
- **No fallback to unreviewed results.** When the reader failed, the first version fell back to the regex filter and showed "Error Page" and "Premierleague" as businesses (seen in the real app). A wrong list is worse than an honest failure, so it now says it couldn't review the results and the approval reopens for a retry.
