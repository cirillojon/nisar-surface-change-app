/* Assistant state shared by the top bar, the drawer and "Ask AI" buttons.
 * The conversation lives here (not in the drawer) so it survives the
 * drawer closing and route changes. */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { API_BASE } from "../../services/api.js";
import { getWorkspaceContext } from "../workspaceContext.js";

const AssistantContext = createContext(null);

let nextId = 1;

/** Parse an SSE byte stream into {event, data} objects. */
async function* sseEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (data) {
        try {
          yield JSON.parse(data);
        } catch {
          // Ignore a malformed event rather than breaking the stream.
        }
      }
    }
  }
}

export function AssistantProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const abortRef = useRef(null);
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;

  const send = useCallback(async (text) => {
    const content = text.trim();
    if (!content || busy) return;
    const user = { id: nextId++, role: "user", content };
    const reply = { id: nextId++, role: "assistant", content: "", tools: [], actions: [], pending: true };
    const history = [...messages, user];
    setMessages([...history, reply]);
    setBusy(true);
    setDraft("");

    const update = (fn) => setMessages((all) => all.map((m) => (m.id === reply.id ? fn(m) : m)));
    const loc = locationRef.current;
    const context = {
      page: { path: loc.pathname, title: document.title },
      workspace: loc.pathname.startsWith("/workspace") ? getWorkspaceContext() : null,
    };
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await fetch(`${API_BASE}/api/assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content })),
          context,
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        let message = `The assistant is unavailable (HTTP ${resp.status}).`;
        try {
          message = (await resp.json()).error || message;
        } catch {
          // Keep the generic message.
        }
        update((m) => ({ ...m, pending: false, error: message }));
        return;
      }
      for await (const event of sseEvents(resp)) {
        if (event.type === "text") update((m) => ({ ...m, content: m.content + event.text }));
        else if (event.type === "tool" && event.phase === "start") {
          update((m) => ({ ...m, tools: [...m.tools, { id: event.id, name: event.name, input: event.input, done: false }] }));
        } else if (event.type === "tool" && event.phase === "end") {
          update((m) => ({
            ...m,
            tools: m.tools.map((t) => (t.id === event.id ? { ...t, done: true, ok: event.ok, summary: event.summary } : t)),
          }));
        } else if (event.type === "action") update((m) => ({ ...m, actions: [...m.actions, event] }));
        else if (event.type === "error") update((m) => ({ ...m, error: event.message }));
      }
      update((m) => ({ ...m, pending: false, content: m.content.trim() }));
    } catch (err) {
      if (err?.name === "AbortError") update((m) => ({ ...m, pending: false, stopped: true }));
      else update((m) => ({ ...m, pending: false, error: "Couldn't reach the assistant. Is the backend running?" }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [busy, messages]);

  const value = useMemo(() => ({
    open,
    messages,
    busy,
    draft,
    setDraft,
    toggle: () => setOpen((o) => !o),
    close: () => setOpen(false),
    send,
    stop: () => abortRef.current?.abort(),
    reset: () => {
      abortRef.current?.abort();
      setMessages([]);
    },
    ask: (prompt) => {
      setOpen(true);
      if (prompt) send(prompt);
    },
  }), [open, messages, busy, draft, send]);

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook lives with its provider
export function useAssistant() {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used inside <AssistantProvider>");
  return ctx;
}
