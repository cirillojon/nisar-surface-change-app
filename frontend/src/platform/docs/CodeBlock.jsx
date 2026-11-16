import { useState } from "react";

/** A code block with a language label and a copy button. */
export default function CodeBlock({ code, language, dark = false, maxHeight, title }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (permissions, insecure origin).
    }
  };
  return (
    <div className={`pf-code${dark ? " pf-code-dark" : ""}`}>
      <div className="pf-code-bar">
        <span className="pf-code-lang">{title ?? language ?? "text"}</span>
        <button type="button" className="pf-copy" onClick={copy} aria-label="Copy code">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {/* Focusable so keyboard users can scroll long code. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <pre style={maxHeight ? { maxHeight } : undefined} tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
