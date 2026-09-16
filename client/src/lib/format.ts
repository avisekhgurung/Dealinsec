/**
 * The client's import path for the app's one money and date formatter.
 *
 * THERE IS NO IMPLEMENTATION HERE, and there must never be one again. This
 * file used to be a full second copy of shared/money.ts, and within a single
 * change the two had already drifted: this copy's formatDate silently ignored
 * the `day` and `year` options the shared one honours. A formatter duplicated
 * is a formatter that disagrees with itself — the in-app figure and the email
 * receipt for it stop matching, and nobody notices until a client does.
 *
 * Add to shared/money.ts; it is re-exported from here and from
 * client/src/lib/money.ts automatically.
 *
 * Every money function takes MINOR units — paise, cents, yen:
 *   formatMoney(6500000, "INR", "en-IN") → "₹65,000"   (6,500,000 paise)
 *   formatMoney(125050, "USD", "en-US")  → "$1,250.50"
 *   formatMoney(1250, "JPY", "ja-JP")    → "￥1,250"    (exponent 0)
 * Passing a rupee figure where paise are expected prints an amount 100× too
 * small, which is exactly why the stored fields are named `…Minor`.
 */
export * from "@shared/money";
