/**
 * Per-user daily AI message quota, shared by the Copilot and the Agent so a
 * user can't double their allowance by switching surface.
 *
 * In memory: it resets on every deploy. That is acceptable for a spend ceiling
 * (it is not a security control).
 */
export const DAILY_PER_USER = 60;
const usage = new Map<string, { day: string; n: number }>();

export const takeQuota = (userId: string): boolean => {
  const day = new Date().toISOString().slice(0, 10);
  const u = usage.get(userId);
  if (!u || u.day !== day) {
    if (usage.size > 5000) usage.clear();
    usage.set(userId, { day, n: 1 });
    return true;
  }
  if (u.n >= DAILY_PER_USER) return false;
  u.n++;
  return true;
};
