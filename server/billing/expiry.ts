/** Months after `from`, calendar-safe (Jan 31 + 1 month = Feb 28/29, like people expect on a receipt). Pure. */
export function expiryFrom(from: Date, months: number | null): Date | null {
  if (months == null || !Number.isInteger(months) || months < 1) return null;
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
