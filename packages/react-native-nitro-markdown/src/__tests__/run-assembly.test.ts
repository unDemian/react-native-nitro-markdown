import type { MarkdownNode } from "../headless";
import { classifyBlock, type ClassifyBlock } from "../selection/classification";
import { assembleRuns } from "../selection/runs";

const block = (
  type: MarkdownNode["type"],
  beg: number,
  end: number,
): MarkdownNode => ({ type, beg, end, children: [] });

describe("block classification", () => {
  it("lets a reader select through paragraphs, headings, lists and blockquotes", () => {
    for (const type of [
      "paragraph",
      "heading",
      "list",
      "blockquote",
    ] as const) {
      expect(classifyBlock(block(type, 0, 1))).toBe("flowing");
    }
  });

  it("stops a selection at tables and fenced code blocks", () => {
    expect(classifyBlock(block("table", 0, 1))).toBe("standalone");
    expect(classifyBlock(block("code_block", 0, 1))).toBe("standalone");
  });

  it("stops a selection at every block that renders a view of its own", () => {
    // A view nested in a run's text host is positioned by placeholder spans on
    // Android and selection degrades across it, so anything the renderers draw
    // as a view has to terminate the run instead.
    for (const type of [
      "image",
      "math_inline",
      "math_block",
      "html_block",
    ] as const) {
      expect(classifyBlock(block(type, 0, 1))).toBe("standalone");
    }
  });

  it("keeps a paragraph carrying inline math out of the run", () => {
    // Inline math draws a view mid-sentence, so the paragraph around it keeps
    // the dedicated renderers and their inline-math layout path.
    const paragraphWithMath: MarkdownNode = {
      type: "paragraph",
      beg: 0,
      end: 20,
      children: [
        { type: "text", content: "see ", beg: 0, end: 4 },
        { type: "math_inline", beg: 4, end: 9, children: [] },
      ],
    };

    expect(classifyBlock(paragraphWithMath)).toBe("standalone");
  });

  it("does not stop a selection at a horizontal rule", () => {
    expect(classifyBlock(block("horizontal_rule", 0, 1))).toBe("flowing");
  });

  it("keeps a block out of the run when it carries a standalone block inside", () => {
    // A list item wrapping a fenced code block: the code block owns its own
    // gestures and must keep its view renderer, so the whole list cannot
    // merge into a run — the boundary is visible (the code block itself).
    const listWithCode: MarkdownNode = {
      type: "list",
      beg: 0,
      end: 40,
      children: [
        {
          type: "list_item",
          beg: 0,
          end: 40,
          children: [{ type: "code_block", beg: 8, end: 38, children: [] }],
        },
      ],
    };

    expect(classifyBlock(listWithCode)).toBe("standalone");
  });

  it("keeps a block out of the run when a consumer-standalone block nests inside it", () => {
    const consumerRule: ClassifyBlock = (node) =>
      node.type === "html_block" ? "standalone" : undefined;
    const quoteWithHtml: MarkdownNode = {
      type: "blockquote",
      beg: 0,
      end: 30,
      children: [{ type: "html_block", beg: 2, end: 28 }],
    };

    expect(classifyBlock(quoteWithHtml, consumerRule)).toBe("standalone");
  });

  it("does not let plain nested flowing content stop the merge", () => {
    const listWithProse: MarkdownNode = {
      type: "list",
      beg: 0,
      end: 20,
      children: [
        {
          type: "list_item",
          beg: 0,
          end: 20,
          children: [
            {
              type: "paragraph",
              beg: 2,
              end: 20,
              children: [{ type: "text", content: "plain", beg: 2, end: 7 }],
            },
          ],
        },
      ],
    };

    expect(classifyBlock(listWithProse)).toBe("flowing");
  });

  it("honours a consumer-supplied classification before the default", () => {
    const consumerRule: ClassifyBlock = (node) =>
      node.type === "blockquote" ? "standalone" : undefined;
    expect(classifyBlock(block("blockquote", 0, 1), consumerRule)).toBe(
      "standalone",
    );
    // Everything the consumer does not claim falls back to the default.
    expect(classifyBlock(block("table", 0, 1), consumerRule)).toBe(
      "standalone",
    );
    expect(classifyBlock(block("paragraph", 0, 1), consumerRule)).toBe(
      "flowing",
    );
  });
});

describe("run assembly", () => {
  it("merges adjacent flowing blocks into one run a reader can select across", () => {
    const blocks = [
      block("heading", 0, 8),
      block("paragraph", 10, 30),
      block("list", 32, 60),
      block("blockquote", 62, 80),
    ];

    const parts = assembleRuns(blocks);

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: "run" });
    if (parts[0]?.kind === "run") {
      expect(parts[0].blocks).toHaveLength(4);
    }
  });

  it("ends the run at a standalone block and starts a new run after it", () => {
    const blocks = [
      block("paragraph", 0, 10),
      block("table", 12, 40),
      block("paragraph", 42, 60),
    ];

    const parts = assembleRuns(blocks);

    expect(parts.map((part) => part.kind)).toEqual([
      "run",
      "standalone",
      "run",
    ]);
  });

  it("keeps adjacent standalone blocks as separate parts", () => {
    const blocks = [
      block("code_block", 0, 20),
      block("table", 22, 50),
    ];

    const parts = assembleRuns(blocks);

    expect(parts.map((part) => part.kind)).toEqual(["standalone", "standalone"]);
  });

  it("keys each run by the source offset of its first block, not by index", () => {
    const blocks = [
      block("paragraph", 0, 10),
      block("code_block", 12, 40),
      block("paragraph", 42, 60),
      block("paragraph", 62, 80),
    ];

    const parts = assembleRuns(blocks);

    expect(parts.map((part) => part.key)).toEqual([
      "run:0",
      "standalone:12",
      "run:42",
    ]);
  });

  it("keeps a settled run's key stable while later blocks are still arriving", () => {
    const firstParse = [block("paragraph", 0, 10), block("paragraph", 12, 20)];
    const secondParse = [
      block("paragraph", 0, 10),
      block("paragraph", 12, 30),
      block("table", 32, 60),
      block("paragraph", 62, 70),
    ];

    const before = assembleRuns(firstParse);
    const after = assembleRuns(secondParse);

    expect(before[0]?.key).toBe("run:0");
    expect(after[0]?.key).toBe("run:0");
  });

  it("honours the consumer classification when splitting runs", () => {
    const consumerRule: ClassifyBlock = (node) =>
      node.type === "html_block" ? "standalone" : undefined;
    const blocks = [
      block("paragraph", 0, 10),
      block("html_block", 12, 40),
      block("paragraph", 42, 60),
    ];

    const parts = assembleRuns(blocks, consumerRule);

    expect(parts.map((part) => part.kind)).toEqual([
      "run",
      "standalone",
      "run",
    ]);
  });

  it("returns nothing for an empty document", () => {
    expect(assembleRuns([])).toEqual([]);
  });

  it("falls back to an index key when a block carries no source offset, and says so", () => {
    // Index keys reshuffle as block counts change mid-stream, which remounts
    // settled runs — so a tree parsed without source offsets is worth a word.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const parts = assembleRuns([
        { type: "paragraph", children: [] },
        { type: "table", children: [] },
      ]);

      expect(parts.map((part) => part.key)).toEqual([
        "run@0",
        "standalone@1",
      ]);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0]![0])).toContain("sourceOffsets");
    } finally {
      warn.mockRestore();
    }
  });
});
