/* Feature switches for the platform shell.
 *
 * Two independent switches:
 *
 * - MCP (on by default): the read-only tool registry at /api/tools and the
 *   MCP server that wraps it, plus their docs. No API key needed. Set
 *   VITE_ENABLE_MCP=false (frontend/.env) and ENABLE_MCP=0 (backend .env)
 *   to hide them.
 * - AI assistant (off by default): "Ask AI", which calls Claude and needs an
 *   Anthropic API key. Set VITE_ENABLE_AI=true and ENABLE_AI=1 to turn it on. */
export const AI_ENABLED = import.meta.env.VITE_ENABLE_AI === "true";
export const MCP_ENABLED = AI_ENABLED || import.meta.env.VITE_ENABLE_MCP !== "false";

const MCP_DOC_SLUGS = new Set(["mcp", "mcp-install", "mcp-tools", "mcp-examples"]);
const AI_DOC_SLUGS = new Set(["assistant"]);

/** Is `href` a docs page that belongs to a switched-off feature? */
export function isAiHref(href = "") {
  const m = /^\/docs\/developers\/([\w-]+)/.exec(href);
  if (!m) return false;
  if (MCP_DOC_SLUGS.has(m[1])) return !MCP_ENABLED;
  if (AI_DOC_SLUGS.has(m[1])) return !AI_ENABLED;
  return false;
}

/** Is an OpenAPI path part of a switched-off feature? */
export const isAiApiPath = (path) =>
  (path.startsWith("/api/tools") && !MCP_ENABLED) || (path.startsWith("/api/assistant") && !AI_ENABLED);
