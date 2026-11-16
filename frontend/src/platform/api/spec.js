/* The OpenAPI spec (app/openapi.json, also served at /api/openapi.json) and
 * helpers that turn an operation into code samples and requests. */
import spec from "@repo/app/openapi.json";
import { API_BASE } from "../../services/api.js";
import { isAiApiPath } from "../features.js";

export { spec };

const METHODS = ["get", "post", "put", "patch", "delete"];

function resolveRef(obj) {
  if (!obj || !obj.$ref) return obj;
  const path = obj.$ref.replace(/^#\//, "").split("/");
  return path.reduce((node, key) => node?.[key], spec);
}

/** Every operation as { id, method, path, op, parameters, body }. */
export function operations() {
  const out = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    if (isAiApiPath(path)) continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const parameters = (op.parameters ?? []).map(resolveRef);
      const bodyContent = op.requestBody?.content?.["application/json"];
      out.push({
        id: op.operationId,
        method: method.toUpperCase(),
        path,
        op,
        parameters,
        body: bodyContent ? { schema: resolveRef(bodyContent.schema), example: bodyContent.example } : null,
      });
    }
  }
  return out;
}

export function operationById(id) {
  return operations().find((o) => o.id === id) ?? null;
}

/** Expand a schema one level for display: [{ name, type, description }]. */
export function schemaFields(schema, depth = 0) {
  const s = resolveRef(schema);
  if (!s) return [];
  if (s.allOf) return s.allOf.flatMap((part) => schemaFields(part, depth));
  if (s.type === "array" && s.items) {
    return schemaFields(s.items, depth);
  }
  const props = s.properties ?? {};
  return Object.entries(props).map(([name, raw]) => {
    const p = resolveRef(raw);
    let type = Array.isArray(p.type) ? p.type.join(" | ") : p.type ?? (raw.$ref ? raw.$ref.split("/").pop() : "object");
    if (p.type === "array") {
      const item = resolveRef(p.items);
      type = `array of ${item?.type ?? (p.items?.$ref ? p.items.$ref.split("/").pop() : "values")}`;
    }
    return {
      name,
      type,
      description: p.description ?? "",
      enum: p.enum,
      children: depth < 1 && (p.properties || p.allOf || (p.type === "array" && resolveRef(p.items)?.properties))
        ? schemaFields(p, depth + 1)
        : null,
    };
  });
}

export function exampleFor(param) {
  return param.example ?? param.schema?.example ?? param.schema?.default ?? "";
}

/** Build the request path + query from parameter values. */
export function buildUrl(operation, values) {
  let path = operation.path;
  const query = new URLSearchParams();
  for (const p of operation.parameters) {
    const v = values[p.name];
    if (v === undefined || v === null || v === "") continue;
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(v));
    else if (p.in === "query") query.set(p.name, v);
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

export function absoluteUrl(path) {
  const base = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${path}`;
}

export function codeSamples(operation, values, bodyText) {
  const url = absoluteUrl(buildUrl(operation, values));
  const hasBody = operation.method !== "GET" && bodyText != null && bodyText.trim() !== "";
  let pyBody = "";
  let jsBody = "";
  if (hasBody) {
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = null;
    }
    const compact = parsed ? JSON.stringify(parsed) : bodyText;
    pyBody = parsed ? JSON.stringify(parsed, null, 4).replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None") : compact;
    jsBody = compact;
  }
  const curl = hasBody
    ? `curl -X ${operation.method} "${url}" \\\n  -H "Content-Type: application/json" \\\n  -d '${jsBody.replace(/'/g, "'\\''")}'`
    : `curl "${url}"`;
  const python = hasBody
    ? `import requests\n\nresp = requests.${operation.method.toLowerCase()}(\n    "${url}",\n    json=${pyBody.replace(/\n/g, "\n    ")},\n    timeout=60,\n)\nresp.raise_for_status()\nprint(resp.json())`
    : `import requests\n\nresp = requests.get("${url}", timeout=60)\nresp.raise_for_status()\nprint(resp.json())`;
  const javascript = hasBody
    ? `const resp = await fetch("${url}", {\n  method: "${operation.method}",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify(${jsBody}),\n});\nconst data = await resp.json();\nconsole.log(data);`
    : `const resp = await fetch("${url}");\nconst data = await resp.json();\nconsole.log(data);`;
  return [
    { id: "curl", label: "cURL", code: curl },
    { id: "python", label: "Python", code: python },
    { id: "javascript", label: "JavaScript", code: javascript },
  ];
}
