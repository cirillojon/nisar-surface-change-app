import { QueryClient } from "@tanstack/react-query";

/**
 * The app's server-data cache (TanStack Query). The backend's catalog
 * (sites, stories, change types, gallery places) is fixed for a session, so
 * queries stay fresh and aren't refetched on focus. Failures are shown at
 * once with a "Try again" (no silent automatic retries), as before.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}
