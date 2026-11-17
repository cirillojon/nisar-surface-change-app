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

const CELLS = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const IS_LIST = /^\s*([-*]|\d+\.)\s+/;
const IS_TABLE_ROW = /^\s*\|.*\|\s*$/;
const IS_HEADING = /^#{1,4}\s/;
const STARTS_BLOCK = /^(```|#{1,4}\s|\s*([-*]|\d+\.)\s+|\s*\|)/;

/** Lines from `i` while `test` holds. */
function takeWhile(lines, i, test) {
  const taken = [];
  while (i + taken.length < lines.length && test(lines[i + taken.length])) taken.push(lines[i + taken.length]);
  return taken;
}

/* Each reader takes the block starting at line `i`: [block, lines used], or null if it isn't one. */
function readCode(lines, i) {
  if (!lines[i].startsWith("```")) return null;
  const body = takeWhile(lines, i + 1, (l) => !l.startsWith("```"));
  return [{ type: "code", lang: lines[i].slice(3).trim() || "text", code: body.join("\n") }, body.length + 2];
}

function readHeading(lines, i) {
  if (!IS_HEADING.test(lines[i])) return null;
  const hashes = lines[i].match(/^#+/)?.[0].length ?? 1;
  return [{ type: "heading", level: Math.min(hashes + 2, 6), text: lines[i].replace(/^#+\s/, "") }, 1];
}

function readTable(lines, i) {
  if (!IS_TABLE_ROW.test(lines[i]) || !/^\s*\|?\s*:?-+/.test(lines[i + 1] ?? "")) return null;
  const rows = takeWhile(lines, i, (l) => IS_TABLE_ROW.test(l));
  const [head = [], , ...body] = rows.map(CELLS);
  return [{ type: "table", head, body }, rows.length];
}

function readList(lines, i) {
  if (!IS_LIST.test(lines[i])) return null;
  const items = takeWhile(lines, i, (l) => IS_LIST.test(l));
  return [{ type: "list", ordered: /^\s*\d+\./.test(lines[i]), items: items.map((l) => l.replace(IS_LIST, "")) }, items.length];
}

function readParagraph(lines, i) {
  const para = takeWhile(lines, i, (l) => l.trim() && !STARTS_BLOCK.test(l));
  // A line that starts like a block but isn't one is a paragraph of its own.
  const taken = para.length ? para : [lines[i]];
  return [{ type: "paragraph", lines: taken }, taken.length];
}

const READERS = [readCode, readHeading, readTable, readList];

/**
 * The text as blocks (code, heading, table, list, paragraph). Each block
 * and row gets an id as it is read, so React keys stay tied to the parsed
 * text rather than to positions in arrays.
 */
function parseBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) {
      i += 1;
      continue;
    }
    const [block, used] = READERS.map((read) => read(lines, i)).find(Boolean) ?? readParagraph(lines, i);
    blocks.push({ ...block, id: `b${i}` });
    i += used;
  }
  return blocks;
}

const withIds = (items, prefix) => items.map((value, n) => ({ value, id: `${prefix}-${n}` }));

function Table({ block }) {
  const head = withIds(block.head, `${block.id}h`);
  const body = withIds(block.body, `${block.id}r`).map((row) => ({ ...row, cells: withIds(row.value, row.id) }));
  return (
    <div className="pf-table-wrap">
      <table>
        <thead><tr>{head.map((c) => <th key={c.id}>{inline(c.value, c.id)}</th>)}</tr></thead>
        <tbody>
          {body.map((row) => (
            <tr key={row.id}>{row.cells.map((c) => <td key={c.id}>{inline(c.value, c.id)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function List({ block }) {
  const Tag = block.ordered ? "ol" : "ul";
  return <Tag>{withIds(block.items, block.id).map((it) => <li key={it.id}>{inline(it.value, it.id)}</li>)}</Tag>;
}

function Paragraph({ block }) {
  return (
    <p>
      {withIds(block.lines, block.id).map((l, j) => (
        <Fragment key={l.id}>{j > 0 && <br />}{inline(l.value, l.id)}</Fragment>
      ))}
    </p>
  );
}

function Block({ block }) {
  switch (block.type) {
    case "code":
      return <CodeBlock code={block.code} language={block.lang} dark />;
    case "heading": {
      const Tag = `h${block.level}`;
      return <Tag>{inline(block.text, block.id)}</Tag>;
    }
    case "table":
      return <Table block={block} />;
    case "list":
      return <List block={block} />;
    default:
      return <Paragraph block={block} />;
  }
}

export default function Markdown({ text }) {
  return <div className="pf-md">{parseBlocks(text).map((block) => <Block key={block.id} block={block} />)}</div>;
}
