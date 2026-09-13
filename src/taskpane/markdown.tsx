/**
 * A small markdown renderer for assistant replies.
 *
 * It returns React elements, never HTML strings, so model output can never
 * reach dangerouslySetInnerHTML — React escapes every text node. That rules out
 * the injection risk outright, which matters more here than feature coverage:
 * this pane renders text a remote model produced about someone's ledger.
 *
 * Supported: headings, bullet and numbered lists, fenced code, tables, and
 * inline code / bold / italic. Anything else renders as plain text.
 */

import type { JSX, ReactNode } from "react";

/** Split a line into inline spans. Order matters: code wins over emphasis. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // `code` | **bold** | *italic* | _italic_
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-i${i++}`;
    if (tok.startsWith("`")) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function Markdown({ text }: { text: string }): JSX.Element {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Fenced code.
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        body.push(lines[i] ?? "");
        i++;
      }
      i++; // closing fence
      blocks.push(
        <pre className="md-code" key={`b${key++}`}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Table: a header row followed by a divider.
    if (line.includes("|") && isTableDivider(lines[i + 1] ?? "")) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").includes("|")) {
        rows.push(splitRow(lines[i] ?? ""));
        i++;
      }
      blocks.push(
        <div className="md-table-wrap" key={`b${key++}`}>
          <table className="md-table">
            <thead>
              <tr>
                {head.map((h, hi) => (
                  <th key={hi}>{renderInline(h, `h${hi}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {head.map((_, ci) => (
                    <td key={ci}>{renderInline(r[ci] ?? "", `c${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Heading.
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const Tag = (["h3", "h4", "h5", "h6"] as const)[level - 1] ?? "h6";
      blocks.push(
        <Tag className="md-h" key={`b${key++}`}>
          {renderInline(heading[2] ?? "", `hd${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // Lists: consecutive bullet or numbered lines.
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        const b = /^\s*[-*+]\s+(.*)$/.exec(cur);
        const n = /^\s*\d+[.)]\s+(.*)$/.exec(cur);
        if (ordered && n) items.push(n[1] ?? "");
        else if (!ordered && b) items.push(b[1] ?? "");
        else break;
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List className="md-list" key={`b${key++}`}>
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `li${ii}`)}</li>
          ))}
        </List>,
      );
      continue;
    }

    // Blank line.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: gather until a blank line or a block starts.
    const para: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? "";
      if (
        cur.trim() === "" ||
        cur.trim().startsWith("```") ||
        /^(#{1,4})\s+/.test(cur) ||
        /^\s*[-*+]\s+/.test(cur) ||
        /^\s*\d+[.)]\s+/.test(cur) ||
        (cur.includes("|") && isTableDivider(lines[i + 1] ?? ""))
      ) {
        break;
      }
      para.push(cur);
      i++;
    }
    blocks.push(
      <p className="md-p" key={`b${key++}`}>
        {renderInline(para.join(" "), `p${key}`)}
      </p>,
    );
  }

  return <>{blocks}</>;
}
