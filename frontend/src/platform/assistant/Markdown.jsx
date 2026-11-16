/* A small, safe Markdown renderer for assistant replies. It builds React
 * elements (never innerHTML), covering what the model writes: paragraphs,
 * headings, lists, fenced code, tables, bold/italic, inline code and links. */
import { Fragment } from "react";
import { Link } from "react-router-dom";

import CodeBlock from "../docs/CodeBlock.jsx";

const INLINE_SOURCE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/.source;

function inline(text, keyBase = "i") {
  const out = [];
  let last = 0;
  let match;
  let n = 0;
  // A fresh regex per call: inline() recurses, and a shared /g regex's
  // lastIndex would be reset by the inner call (an infinite loop).
  const pattern = new RegExp(INLINE_SOURCE, "g");
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyBase}-${n++}`;
    if (token.startsWith("`")) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) out.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>);
    else if (token.startsWith("*")) out.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>);
    else {
      const [, label, href] = token.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
      if (href.startsWith("/") && !href.startsWith("/api/")) out.push(<Link key={key} to={href}>{label}</Link>);
      else if (/^https?:\/\//.test(href) || href.startsWith("/api/")) {
        out.push(<a key={key} href={href} target="_blank" rel="noreferrer">{label}</a>);
      } else out.push(label);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function table(lines, key) {
  const rows = lines.map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  const [head, , ...body] = rows;
  return (
    <div className="pf-table-wrap" key={key}>
      <table>
        <thead><tr>{head.map((c, i) => <th key={i}>{inline(c, `${key}h${i}`)}</th>)}</tr></thead>
        <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, i) => <td key={i}>{inline(c, `${key}${ri}-${i}`)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function Markdown({ text }) {
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i += 1;
      blocks.push(<CodeBlock key={k++} code={body.join("\n")} language={lang || "text"} dark />);
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      const level = Math.min(line.match(/^#+/)[0].length + 2, 6);
      const Tag = `h${level}`;
      blocks.push(<Tag key={k++}>{inline(line.replace(/^#+\s/, ""), `h${k}`)}</Tag>);
      i += 1;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-+/.test(lines[i + 1] ?? "")) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      blocks.push(table(rows, `t${k++}`));
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={k++}>{items.map((it, j) => <li key={j}>{inline(it, `l${k}-${j}`)}</li>)}</List>);
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*]|\d+\.)\s+|\s*\|)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    if (!para.length) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={k++}>
        {para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `p${k}-${j}`)}</Fragment>)}
      </p>,
    );
  }
  return <div className="pf-md">{blocks}</div>;
}
