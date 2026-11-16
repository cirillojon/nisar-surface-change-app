// Testing Library with the app's query cache: every render (and renderHook)
// gets a fresh QueryClient, so no test sees another's server answers.
import { QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, renderHook as rtlRenderHook } from "@testing-library/react";

import { createQueryClient } from "../services/queryClient.js";

export * from "@testing-library/react";

/** A fresh client per test; no garbage-collection timers, since nothing outlives the test. */
export function testQueryClient() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, gcTime: Infinity } });
  return client;
}

function withQueryClient(options = {}) {
  const client = testQueryClient();
  const Inner = options.wrapper;
  const wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{Inner ? <Inner>{children}</Inner> : children}</QueryClientProvider>
  );
  return { ...options, wrapper };
}

export const render = (ui, options) => rtlRender(ui, withQueryClient(options));
export const renderHook = (hook, options) => rtlRenderHook(hook, withQueryClient(options));
