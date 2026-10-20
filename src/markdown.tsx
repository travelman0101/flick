import { Fragment, type ReactNode } from "react";

/**
 * The small Markdown subset AI tidy produces: headings, "-" / "1." lists and **bold**.
 * Builds React elements only (no innerHTML), so a note can never inject markup.
 */
type Block =
  | { kind: "h"; text: string }
  | { kind: "hr" }
  | { kind: "ul" | "ol"; items: { text: string; depth: number }[] }
  | { kind: "p"; lines: string[] };

const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^(\s*)[-*・]\s+(.*)$/;
const NUMBER = /^(\s*)\d+[.)]\s+(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;

function blocks(src: string): Block[] {
  const out: Block[] = [];
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const last = out[out.length - 1];
    if (!line.trim()) {
      out.push({ kind: "p", lines: [] }); // paragraph break
      continue;
    }
    if (RULE.test(line.trim())) {
      out.push({ kind: "hr" });
      continue;
    }
    const h = HEADING.exec(line.trim());
    const b = BULLET.exec(line);
    const n = b ? null : NUMBER.exec(line);
    if (h) out.push({ kind: "h", text: h[1] });
    else if (b || n) {
      const kind = b ? "ul" : "ol";
      const [, indent, text] = (b ?? n)!;
      const item = { text, depth: Math.min(2, Math.floor(indent.replace(/\t/g, "  ").length / 2)) };
      if (last?.kind === kind) last.items.push(item);
      else out.push({ kind, items: [item] });
    } else if (last?.kind === "p" && last.lines.length) last.lines.push(line.trim());
    else out.push({ kind: "p", lines: [line.trim()] });
  }
  return out.filter((b) => b.kind !== "p" || b.lines.length);
}

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <>
      {blocks(text).map((b, i) => {
        if (b.kind === "h") return <h4 key={i}>{inline(b.text)}</h4>;
        if (b.kind === "hr") return <hr key={i} />;
        if (b.kind === "p")
          return (
            <p key={i}>
              {b.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(l)}
                </Fragment>
              ))}
            </p>
          );
        const List = b.kind;
        return (
          <List key={i}>
            {b.items.map((it, j) => (
              <li key={j} className={it.depth ? `d${it.depth}` : undefined}>
                {inline(it.text)}
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}

/** First meaningful line without Markdown symbols, for the folded peek. */
export function plainFirstLine(text: string) {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^([-*・]|\d+[.)])\s+/, "")
    .replace(/\*\*/g, "");
}
