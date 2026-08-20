/**
 * A source-faithful stand-in for the native md4c parser, for tests that run
 * the real JavaScript library without a native runtime (this package's own
 * suites and consumer app suites alike).
 *
 * It covers the constructs the library's tests exercise — headings,
 * paragraphs with soft breaks, fenced code, blockquotes, flat lists, simple
 * tables, bold, inline code and links — and, unlike a hand-stamped mock, it
 * emits REAL `beg`/`end` source offsets (UTF-16 indices into the input), so
 * range-to-source mapping behaves as it would against the native parser.
 */
import type { HeadingLevel, MarkdownNode } from "../headless";

type SourceLine = { text: string; start: number };

const textNode = (content: string, beg: number): MarkdownNode => ({
  type: "text",
  content,
  beg,
  end: beg + content.length,
});

const INLINE_PATTERN =
  /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]*)\]\(([^)\s]+)\))/g;

const parseInline = (text: string, base: number): MarkdownNode[] => {
  const nodes: MarkdownNode[] = [];
  let consumedUpTo = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > consumedUpTo) {
      nodes.push(textNode(text.slice(consumedUpTo, index), base + consumedUpTo));
    }
    if (match[1] !== undefined) {
      nodes.push({
        type: "bold",
        beg: base + index,
        end: base + index + match[1].length,
        children: [textNode(match[2] ?? "", base + index + 2)],
      });
    } else if (match[3] !== undefined) {
      nodes.push({
        type: "code_inline",
        content: match[4] ?? "",
        beg: base + index,
        end: base + index + match[3].length,
      });
    } else if (match[5] !== undefined) {
      nodes.push({
        type: "link",
        href: match[7] ?? "",
        beg: base + index,
        end: base + index + match[5].length,
        children: [textNode(match[6] ?? "", base + index + 1)],
      });
    }
    consumedUpTo = index + match[0].length;
  }
  if (consumedUpTo < text.length) {
    nodes.push(textNode(text.slice(consumedUpTo), base + consumedUpTo));
  }
  return nodes;
};

const lineEnd = (line: SourceLine): number => line.start + line.text.length;

const inlineLinesWithSoftBreaks = (lines: SourceLine[]): MarkdownNode[] => {
  const children: MarkdownNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) {
      const previous = lines[index - 1] as SourceLine;
      children.push({
        type: "soft_break",
        beg: lineEnd(previous),
        end: line.start,
      });
    }
    children.push(...parseInline(line.text, line.start));
  });
  return children;
};

const stripOffsets = (node: MarkdownNode): MarkdownNode => {
  const { beg: _beg, end: _end, children, ...rest } = node;
  return {
    ...rest,
    ...(children ? { children: children.map(stripOffsets) } : {}),
  };
};

const HEADING_PATTERN = /^(#{1,6})(\s+)(.*)$/;
const FENCE_PATTERN = /^```(\w*)\s*$/;
const HR_PATTERN = /^[-*_]{3,}\s*$/;
const UNORDERED_ITEM_PATTERN = /^([-*+])(\s+)(.*)$/;
const ORDERED_ITEM_PATTERN = /^(\d+)([.)])(\s+)(.*)$/;
const TASK_ITEM_PATTERN = /^\[([ xX])\](\s+)(.*)$/;
const TABLE_SEPARATOR_PATTERN = /^\|?[\s\-:|]+\|?\s*$/;
const SETEXT_UNDERLINE_PATTERN = /^ {0,3}(=+|-+)\s*$/;

/** A pipe row followed by a delimiter row — the only table md4c recognises. */
const startsTable = (lines: readonly SourceLine[], index: number): boolean => {
  const line = lines[index];
  const separator = lines[index + 1];
  if (!line || !separator) return false;
  return (
    line.text.trim().startsWith("|") &&
    TABLE_SEPARATOR_PATTERN.test(separator.text) &&
    separator.text.includes("-")
  );
};

const parseListItem = (line: SourceLine): MarkdownNode | null => {
  const unordered = line.text.match(UNORDERED_ITEM_PATTERN);
  const ordered = line.text.match(ORDERED_ITEM_PATTERN);
  const match = unordered ?? ordered;
  if (!match) return null;

  const markerLength =
    line.text.length - (match[match.length - 1] as string).length;
  let contentStart = line.start + markerLength;
  let content = match[match.length - 1] as string;
  let type: MarkdownNode["type"] = "list_item";
  let checked: boolean | undefined;

  if (unordered) {
    const task = content.match(TASK_ITEM_PATTERN);
    if (task) {
      type = "task_list_item";
      checked = (task[1] as string).toLowerCase() === "x";
      const taskMarkerLength = content.length - (task[3] as string).length;
      contentStart += taskMarkerLength;
      content = task[3] as string;
    }
  }

  return {
    type,
    ...(checked === undefined ? {} : { checked }),
    beg: line.start,
    end: lineEnd(line),
    children: [
      {
        type: "paragraph",
        beg: contentStart,
        end: lineEnd(line),
        children: parseInline(content, contentStart),
      },
    ],
  };
};

const parseTableRow = (line: SourceLine, isHeader: boolean): MarkdownNode => {
  const cells: MarkdownNode[] = [];
  const pattern = /\|([^|]*)/g;
  for (const match of line.text.matchAll(pattern)) {
    const rawCell = match[1] ?? "";
    const cellOffset = (match.index ?? 0) + 1;
    const trimmed = rawCell.trim();
    if (trimmed.length === 0 && cellOffset + rawCell.length >= line.text.length) {
      continue; // trailing pipe
    }
    const leading = rawCell.length - rawCell.trimStart().length;
    const contentStart = line.start + cellOffset + leading;
    cells.push({
      type: "table_cell",
      isHeader,
      beg: contentStart,
      end: contentStart + trimmed.length,
      children: trimmed.length > 0 ? parseInline(trimmed, contentStart) : [],
    });
  }
  return {
    type: "table_row",
    beg: line.start,
    end: lineEnd(line),
    children: cells,
  };
};

export const parseMockMarkdown = (
  source: string,
  includeOffsets = true,
): MarkdownNode => {
  const lines: SourceLine[] = [];
  let offset = 0;
  for (const rawLine of source.split("\n")) {
    // A CRLF source must parse as the same blocks as an LF one, so the
    // carriage return is dropped from the line's text — every line pattern
    // anchors with `$`, and a trailing \r would defeat all of them. Offsets
    // still index the original source: `start` advances by the raw length, and
    // the excluded \r simply sits outside the line's range.
    const text = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    lines.push({ text, start: offset });
    offset += rawLine.length + 1;
  }

  const blocks: MarkdownNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as SourceLine;
    const trimmed = line.text.trim();

    if (trimmed === "") {
      index += 1;
      continue;
    }

    const heading = line.text.match(HEADING_PATTERN);
    if (heading) {
      const contentStart =
        line.start + (heading[1] as string).length + (heading[2] as string).length;
      blocks.push({
        type: "heading",
        level: (heading[1] as string).length as HeadingLevel,
        beg: line.start,
        end: lineEnd(line),
        children: parseInline(heading[3] as string, contentStart),
      });
      index += 1;
      continue;
    }

    const fence = line.text.match(FENCE_PATTERN);
    if (fence) {
      const codeLines: SourceLine[] = [];
      let cursor = index + 1;
      while (cursor < lines.length && !FENCE_PATTERN.test((lines[cursor] as SourceLine).text)) {
        codeLines.push(lines[cursor] as SourceLine);
        cursor += 1;
      }
      const closed = cursor < lines.length;
      const endLine = (closed ? lines[cursor] : lines[lines.length - 1]) as SourceLine;
      const firstCodeLine = codeLines[0];
      const lastCodeLine = codeLines[codeLines.length - 1];
      blocks.push({
        type: "code_block",
        ...(fence[1] ? { language: fence[1] } : {}),
        beg: line.start,
        end: lineEnd(endLine),
        children: [
          firstCodeLine && lastCodeLine
            ? {
                type: "text",
                content: codeLines.map((codeLine) => codeLine.text).join("\n"),
                beg: firstCodeLine.start,
                end: lineEnd(lastCodeLine),
              }
            : { type: "text", content: "", beg: lineEnd(line), end: lineEnd(line) },
        ],
      });
      index = closed ? cursor + 1 : cursor;
      continue;
    }

    if (HR_PATTERN.test(trimmed)) {
      blocks.push({ type: "horizontal_rule", beg: line.start, end: lineEnd(line) });
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: SourceLine[] = [];
      while (index < lines.length && (lines[index] as SourceLine).text.trim().startsWith(">")) {
        const quoteLine = lines[index] as SourceLine;
        const stripped = quoteLine.text.replace(/^\s*>\s?/, "");
        quoteLines.push({
          text: stripped,
          start: quoteLine.start + (quoteLine.text.length - stripped.length),
        });
        index += 1;
      }
      const firstQuoteLine = quoteLines[0] as SourceLine;
      const lastQuoteLine = quoteLines[quoteLines.length - 1] as SourceLine;
      const paragraph: MarkdownNode = {
        type: "paragraph",
        beg: firstQuoteLine.start,
        end: lineEnd(lastQuoteLine),
        children: inlineLinesWithSoftBreaks(quoteLines),
      };
      blocks.push({
        type: "blockquote",
        beg: (lines[index - quoteLines.length] as SourceLine).start,
        end: lineEnd(lastQuoteLine),
        children: [paragraph],
      });
      continue;
    }

    const firstItem = parseListItem(line);
    if (firstItem) {
      const orderedMatch = line.text.match(ORDERED_ITEM_PATTERN);
      const ordered = orderedMatch !== null;
      const startNumber = ordered ? Number(orderedMatch[1]) : undefined;
      const items: MarkdownNode[] = [];
      while (index < lines.length) {
        const candidate = lines[index] as SourceLine;
        if (candidate.text.trim() === "") {
          // A blank line between items makes the list loose; it does not end
          // it. md4c emits one list of two items here, and splitting into two
          // single-item lists would put an extra separator into every run.
          let lookahead = index + 1;
          while (
            lookahead < lines.length &&
            (lines[lookahead] as SourceLine).text.trim() === ""
          ) {
            lookahead += 1;
          }
          const nextLine = lines[lookahead];
          if (!nextLine || !parseListItem(nextLine)) break;
          if (ORDERED_ITEM_PATTERN.test(nextLine.text) !== ordered) break;
          index = lookahead;
          continue;
        }
        const item = parseListItem(candidate);
        if (!item || ORDERED_ITEM_PATTERN.test(candidate.text) !== ordered) {
          break;
        }
        items.push(item);
        index += 1;
      }
      const lastItem = items[items.length - 1] as MarkdownNode;
      blocks.push({
        type: "list",
        ordered,
        ...(startNumber === undefined ? {} : { start: startNumber }),
        beg: line.start,
        end: lastItem.end ?? lineEnd(line),
        children: items,
      });
      continue;
    }

    if (startsTable(lines, index)) {
      const headRow = parseTableRow(line, true);
      const bodyRows: MarkdownNode[] = [];
      let cursor = index + 2;
      while (
        cursor < lines.length &&
        (lines[cursor] as SourceLine).text.trim().startsWith("|")
      ) {
        bodyRows.push(parseTableRow(lines[cursor] as SourceLine, false));
        cursor += 1;
      }
      const lastRowLine = (bodyRows.length > 0 ? lines[cursor - 1] : lines[index + 1]) as SourceLine;
      blocks.push({
        type: "table",
        beg: line.start,
        end: lineEnd(lastRowLine),
        children: [
          { type: "table_head", beg: line.start, end: lineEnd(line), children: [headRow] },
          {
            type: "table_body",
            beg:
              (bodyRows.length > 0
                ? (bodyRows[0] as MarkdownNode).beg
                : undefined) ?? lineEnd(lastRowLine),
            end: lineEnd(lastRowLine),
            children: bodyRows,
          },
        ],
      });
      index = cursor;
      continue;
    }

    // Nothing above claimed this line, so it opens a paragraph. Consuming it
    // before the loop is what guarantees the outer walk always advances.
    const paragraphLines: SourceLine[] = [line];
    index += 1;
    let setextUnderline: SourceLine | null = null;
    let setextLevel: HeadingLevel | null = null;
    while (index < lines.length) {
      const candidate = lines[index] as SourceLine;
      const candidateTrimmed = candidate.text.trim();

      // A row of `=` or `-` under accumulated prose is a setext heading, not
      // a paragraph followed by a thematic break.
      const setext = candidate.text.match(SETEXT_UNDERLINE_PATTERN);
      if (setext) {
        setextLevel = (setext[1] as string).startsWith("=") ? 1 : 2;
        setextUnderline = candidate;
        index += 1;
        break;
      }

      // Every construct that interrupts a paragraph has to be listed here as
      // well as in the dispatch above; a rule or a table left off this list is
      // swallowed into the prose it should have ended.
      if (
        candidateTrimmed === "" ||
        HEADING_PATTERN.test(candidate.text) ||
        FENCE_PATTERN.test(candidate.text) ||
        HR_PATTERN.test(candidateTrimmed) ||
        candidateTrimmed.startsWith(">") ||
        startsTable(lines, index) ||
        parseListItem(candidate) !== null
      ) {
        break;
      }
      paragraphLines.push(candidate);
      index += 1;
    }
    const lastLine = paragraphLines[paragraphLines.length - 1] as SourceLine;
    blocks.push({
      ...(setextLevel === null
        ? { type: "paragraph" as const }
        : { type: "heading" as const, level: setextLevel }),
      beg: line.start,
      end: lineEnd(setextUnderline ?? lastLine),
      children: inlineLinesWithSoftBreaks(paragraphLines),
    });
  }

  const document: MarkdownNode = {
    type: "document",
    beg: 0,
    end: source.length,
    children: blocks,
  };
  return includeOffsets ? document : stripOffsets(document);
};
