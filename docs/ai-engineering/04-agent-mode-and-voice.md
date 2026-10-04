# 04. Two faces, one product: agent mode and voice

## What we built
The product has two ways of living in it, chosen per device and switchable in one tap:
- **Agent mode:** a full-screen chat. A personal welcome ("Good evening, Una"), lead-first suggestions (find companies, what to do today), a microphone, and read-aloud. No navigation bars. It is where leads are found, worked and closed.
- **App mode:** the dashboard and its pages, as before.

`/` lands on the chat in agent mode and on the dashboard in app mode. A card in the chat that links to a page (a lead, a deal) opens the normal page with a **Back to chat** pill, so nothing is a dead end. Switches: a top-bar button (desktop), an "Agent mode" button on the dashboard's AI card (phones too), "Back to chat", and "Dashboard" in the chat header. The choice is stored in `localStorage` and follows across tabs.

## Design decisions
- **A mode is a lens, not a permission.** It decides where `/` lands and which bars are drawn. Every route and every agent tool works identically in both, so there is no second code path to keep safe.
- **Existing users are not moved.** The default is app mode; agent mode is chosen. (Flipping the default for new accounts is a one-line change in `use-ui-mode.ts`.)
- **Voice uses the browser's own speech services.** No server, no new account, no cost. Dictation fills the message box and **the person reads it and presses send**; nothing is sent by voice. Read-aloud is off by default and remembered.
- **Approvals are never given by voice.** The approval card is the safety control; a spoken "yes" is exactly the kind of thing a misheard sentence or a TV in the room can produce. Voice reaches the conversation, not the decision.
- **Say what the browser does.** Some browsers (Chrome) send dictation audio to their own speech service; the mic button's tooltip says so, and a blocked microphone gets a plain message.
- **What is read aloud is cleaned** (`shared/voice.ts`, tested): markdown marks, bullets, links and code are removed, and it stops at a length a person will listen to.

## A lesson from the test run
A test written earlier failed only between 18:30 and midnight UTC. The product was right (it uses the **organization's** calendar day, which is already tomorrow in India); the test built "today" in UTC. Anything that builds dates for a test must use the same timezone as the code under test, and a green run at a single time of day proves less than it seems. The test helper and the evaluation seeder now use the organization's day.

## Not built yet (deliberately)
Hands-free wake words, continuous conversation, spoken approvals, a server-side speech provider, and a per-user (rather than per-device) mode setting.

## Update (4 Oct 2026): one agent, one button, no header menu
The floating "Ask DealInSec" Copilot drawer is gone. It was already the agent in a small window (same backend and history; all 11 of its tools are wrapped by the agent), so keeping two doors to one thing only split attention.
- **A floating "Agent mode" button** on every app page replaces it. It carries where you were: from a deal, agreement or invoice page the agent starts knowing which one ("run the Protection Check on this deal" works), and offers questions for that page (`shared/page-context.ts`, tested).
- **The Daily Briefing** (money to chase, ready to invoice, what needs you; computed server-side, never invented) is now the agent page's opening view, above the existing call and paste actions. The dashboard's "Daily Briefing" chip opens it.
- **The header menu stays** (Dashboard, Agent, Leads, Deals, Quotations, Agreements, Invoices). What goes from the header is the separate "Agent mode" button, because the floating one is now the way in. (I first misread this as "remove the menu" and shipped that; it was corrected the same day.)
- **The phone's bottom bar** now says **Dashboard** (with a dashboard icon) instead of "Home", for the analytics page. All six labels fit at 375 px; at 320 px "Dashboard" and "Agreements" are truncated.
- Not changed: the public landing page's own "Ask DealInSec" widget for logged-out visitors.
- Cost of the change: the drawer let you ask a quick question without leaving the page; now it is a full switch to the agent. If that is missed, a lightweight slide-over on the same agent is the way back.

