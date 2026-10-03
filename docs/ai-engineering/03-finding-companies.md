# 03. Finding companies: tools that spend money and read the open web

## 1. What we built
The agent can search the web for companies that match a short description ("small logistics companies in Pune that could use a new website"), show the candidates as a card, and let the user add the ones they pick as leads. The search service is **Brave Search API** behind a small `DiscoveryProvider` interface. Nothing is added to the pipeline by the search itself.

```
user asks -> agent writes a short query -> APPROVAL CARD shows the exact words
          -> user approves -> one Brave request -> candidates (name + site) -> card
          -> user presses Add (or asks the agent) -> an ordinary lead
```

Configuration: `BRAVE_SEARCH_API_KEY` (server only; without it the feature is simply "not set up"), optional `DISCOVERY_DAILY_LIMIT` (per organization, default 10) and `DISCOVERY_MONTHLY_LIMIT` (whole app, default 300). `BRAVE_SEARCH_URL` points the client at a fake service in tests.

## 2. Why this is a different kind of tool
Every earlier tool changed our own database. This one **spends real money** (Brave has no free tier; roughly $5 per 1,000 searches, card required, no spending cap we can rely on) and **sends words to an outside company**, and what comes back is **untrusted text from the open web**. Three new problems, three structural answers.

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
