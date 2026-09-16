/**
 * The client's import path for the money/date formatter.
 *
 * The IMPLEMENTATION is in shared/money.ts on purpose — server/emails.ts and
 * the Copilot's tool replies format the same amounts for the same person, and a
 * second copy here is how ₹65,000 in the app becomes ₹65000.00 in the email.
 * Do not add one. Add to shared/money.ts and it is re-exported below.
 *
 * `client/src/lib/format.ts` is the same re-export under its older name — one
 * implementation, two import paths, and neither path may grow code of its own.
 */
export * from "@shared/money";
