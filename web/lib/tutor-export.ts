import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { marked, type Token, type Tokens } from "marked";

/**
 * Turning a document the tutor wrote into a file a student can hand in.
 *
 * This runs on the server and takes nothing but markdown, which is the point:
 * every backend can produce markdown, so every model — not just the ones that
 * can drive a local Claude Code session — ends up able to make a real .docx.
 * The alternative was letting a model run a script to build the file, which
 * only one backend supports and needs shell access to do.
 */

/** Word's own default body size is 22 half-points (11pt). */
const BODY_SIZE = 22;
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

/**
 * Inline markdown to Word runs.
 *
 * Recursive because emphasis nests — `**bold with _italic_ inside**` is a
 * strong token containing an em token, and flattening it would lose one of
 * the two.
 */
function runs(tokens: Token[] | undefined, style: { bold?: boolean; italics?: boolean } = {}): TextRun[] {
  if (!tokens?.length) return [];
  const out: TextRun[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "strong":
        out.push(...runs((token as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...runs((token as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case "codespan":
        out.push(
          new TextRun({ text: (token as Tokens.Codespan).text, font: "Consolas", size: BODY_SIZE - 2, ...style })
        );
        break;
      case "link": {
        const link = token as Tokens.Link;
        // Rendered as text rather than a hyperlink field: a printed essay is
        // the common destination, and a live link there reads as a URL anyway.
        out.push(...runs(link.tokens, style));
        out.push(new TextRun({ text: ` (${link.href})`, size: BODY_SIZE, ...style }));
        break;
      }
      case "br":
        out.push(new TextRun({ text: "", break: 1 }));
        break;
      case "del":
        out.push(...runs((token as Tokens.Del).tokens, style));
        break;
      default: {
        const text = "text" in token ? String(token.text) : "";
        if (text) out.push(new TextRun({ text, size: BODY_SIZE, ...style }));
      }
    }
  }
  return out;
}

/** One list, flattened into paragraphs — Word numbers and bullets per paragraph. */
function listParagraphs(list: Tokens.List, depth: number): Paragraph[] {
  const out: Paragraph[] = [];

  list.items.forEach((item, index) => {
    const marker = list.ordered ? `${(Number(list.start) || 1) + index}. ` : "• ";
    // The item's own text, then any nested blocks under it.
    const inline = item.tokens?.filter((t) => t.type === "text" || t.type === "paragraph") ?? [];
    const nested = item.tokens?.filter((t) => t.type === "list") ?? [];

    out.push(
      new Paragraph({
        indent: { left: 360 + depth * 360, hanging: 240 },
        spacing: { after: 80 },
        children: [
          new TextRun({ text: marker, size: BODY_SIZE }),
          ...inline.flatMap((t) => runs((t as Tokens.Text).tokens ?? [{ type: "text", raw: "", text: (t as Tokens.Text).text } as Token])),
        ],
      })
    );
    for (const child of nested) out.push(...listParagraphs(child as Tokens.List, depth + 1));
  });

  return out;
}

function tableFrom(token: Tokens.Table): Table {
  const row = (cells: Tokens.TableCell[], header: boolean) =>
    new TableRow({
      tableHeader: header,
      children: cells.map(
        (cell) =>
          new TableCell({
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            children: [new Paragraph({ children: runs(cell.tokens, { bold: header }) })],
          })
      ),
    });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [row(token.header, true), ...token.rows.map((r) => row(r, false))],
  });
}

/** Block-level markdown to Word content. */
function blocks(tokens: Token[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const h = token as Tokens.Heading;
        out.push(
          new Paragraph({
            heading: HEADINGS[Math.min(h.depth, 6) - 1],
            spacing: { before: 240, after: 120 },
            children: runs(h.tokens),
          })
        );
        break;
      }
      case "paragraph":
        out.push(
          new Paragraph({ spacing: { after: 160 }, children: runs((token as Tokens.Paragraph).tokens) })
        );
        break;
      case "list":
        out.push(...listParagraphs(token as Tokens.List, 0));
        break;
      case "table":
        out.push(tableFrom(token as Tokens.Table));
        out.push(new Paragraph({ text: "", spacing: { after: 160 } }));
        break;
      case "code":
        out.push(
          new Paragraph({
            shading: { fill: "F4F4F5" },
            spacing: { after: 160 },
            children: [
              new TextRun({ text: (token as Tokens.Code).text, font: "Consolas", size: BODY_SIZE - 2 }),
            ],
          })
        );
        break;
      case "blockquote":
        out.push(
          new Paragraph({
            indent: { left: 480 },
            spacing: { after: 160 },
            children: runs((token as Tokens.Blockquote).tokens?.flatMap((t) => (t as Tokens.Paragraph).tokens ?? [])),
          })
        );
        break;
      case "hr":
        out.push(
          new Paragraph({
            spacing: { before: 160, after: 160 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D4D4D8" } },
            children: [],
          })
        );
        break;
      default:
        break;
    }
  }
  return out;
}

/** A document the tutor wrote, as .docx bytes. */
export async function markdownToDocx(title: string, body: string): Promise<Buffer> {
  const doc = new Document({
    // Word shows these in the file's properties; a study guide with no title
    // there is the sort of thing a teacher notices.
    title,
    creator: "Slates",
    description: "Written by the Slates tutor",
    styles: {
      default: {
        document: { run: { font: "Calibri", size: BODY_SIZE } },
      },
    },
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.LEFT,
            spacing: { after: 240 },
            children: [new TextRun({ text: title, bold: true, size: 40 })],
          }),
          ...blocks(marked.lexer(body)),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/** Formats the tutor can turn a document into. */
export const EXPORT_FORMATS = ["docx", "md"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (EXPORT_FORMATS as readonly string[]).includes(value);
}
