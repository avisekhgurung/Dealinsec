import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // The server refused a money write because the org's currency is not the
    // one this tab converted the amount in (CURRENCY_CHANGED in
    // server/routes.ts). Refresh the org row HERE, once, for every caller:
    // useMoney() then re-renders the form in the real currency, so the user's
    // retry converts correctly even on a screen whose error handler only
    // shows a toast.
    if (res.status === 409 && text.includes('"CURRENCY_CHANGED"')) {
      void queryClient.invalidateQueries({ queryKey: ["/api/org"] });
    }
    throw new Error(`${res.status}: ${text}`);
  }
}

/**
 * Sent on every request this build makes. It tells the server this tab reads
 * money as `*Minor` fields, so it needs none of the rupee-era compatibility
 * fields the server adds for a tab still running the bundle from before the
 * minor-units deploy (see legacyMoneyReadCompat in server/routes.ts). Without
 * it, such a tab rendered every total and line rate as ₹0 until refreshed.
 */
const CLIENT_HEADERS: Record<string, string> = { "X-DealInSec-Money": "minor" };

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { ...CLIENT_HEADERS, "Content-Type": "application/json" } : CLIENT_HEADERS,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: CLIENT_HEADERS,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      // 60 seconds before data is considered stale — balances freshness vs extra requests
      staleTime: 60 * 1000,
      // Keep unused data in cache for 5 minutes
      gcTime: 5 * 60 * 1000,
      // Refetch when user returns to the tab so they always see current deal/contract state
      refetchOnWindowFocus: true,
      refetchInterval: false,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
