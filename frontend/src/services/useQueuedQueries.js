import { useQueries, useQueryClient } from "@tanstack/react-query";

const settled = (state) => state?.status === "success" || state?.status === "error";

/**
 * Run `queries` (TanStack query options, the most wanted first) at most
 * `limit` at a time: each render enables the first `limit` that haven't
 * answered yet, so as one answers the next starts, and a new order (the
 * viewer moved on) changes what comes next. Once any answer matches
 * `haltWhen(state)` (e.g. an error every other request would repeat), no
 * more are started. Answers are kept in the query cache, so a query that has
 * answered is never asked again. Returns useQueries' results, in order.
 */
export function useQueuedQueries(queries, limit, { haltWhen = null } = {}) {
  const client = useQueryClient();
  const halt = Boolean(haltWhen) && queries.some((q) => haltWhen(client.getQueryState(q.queryKey)));
  let waiting = 0;
  const queued = queries.map((query) => {
    if (settled(client.getQueryState(query.queryKey))) return query;
    waiting += 1;
    return { ...query, enabled: (query.enabled ?? true) && !halt && waiting <= limit };
  });
  return useQueries({ queries: queued });
}
