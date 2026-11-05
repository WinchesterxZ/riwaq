import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/** Invalidate every org-scoped query after switching org/company. */
export function invalidateScoped(): Promise<void> {
  return queryClient.invalidateQueries();
}
