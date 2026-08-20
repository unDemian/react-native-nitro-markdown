import type { MarkdownNode } from "../headless";
import { parseMockMarkdown } from "../testing/mock-native-parser";

const blocks = (source: string): MarkdownNode[] =>
  parseMockMarkdown(source).children ?? [];

const types = (source: string): string[] =>
  blocks(source).map((block) => block.type);

/**
 * The mock parser is what consumer test suites run in place of md4c, so a
 * block structure it invents is a block structure those suites will assert
 * against and never see on a device. These cover the shapes it used to get
 * wrong.
 */
describe("the mock native parser against md4c's block structure", () => {
  it("parses a CRLF document as the same blocks as an LF one", () => {
    expect(types("# Title\r\n\r\n- a\r\n- b\r\n")).toEqual(["heading", "list"]);
    expect(types("# Title\n\n- a\n- b\n")).toEqual(["heading", "list"]);
  });

  it("keeps offsets pointing at the real source through CRLF line endings", () => {
    const source = "# Title\r\n\r\n- a\r\n- b\r\n";
    const [heading, list] = blocks(source);

    expect(source.slice(heading!.beg, heading!.end)).toBe("# Title");
    const [firstItem, secondItem] = list!.children ?? [];
    expect(source.slice(firstItem!.beg, firstItem!.end)).toBe("- a");
    expect(source.slice(secondItem!.beg, secondItem!.end)).toBe("- b");
  });

  it("keeps a loose list as one list, the way md4c emits it", () => {
    // Splitting it into one single-item list per item would put an extra blank
    // line into every run a consumer renders.
    const looseBlocks = blocks("- alpha\n\n- beta");

    expect(looseBlocks).toHaveLength(1);
    expect(looseBlocks[0]!.type).toBe("list");
    expect(looseBlocks[0]!.children).toHaveLength(2);
  });

  it("keeps a list together across several blank lines", () => {
    const looseBlocks = blocks("- alpha\n\n\n- beta");

    expect(looseBlocks).toHaveLength(1);
    expect(looseBlocks[0]!.children).toHaveLength(2);
  });

  it("ends a list at the first line that is not an item", () => {
    expect(types("- alpha\nProse.")).toEqual(["list", "paragraph"]);
    expect(types("- alpha\n\nProse.")).toEqual(["list", "paragraph"]);
    expect(types("- alpha\n\n1. one")).toEqual(["list", "list"]);
  });

  it("reads a task item with its checked state and its content offsets", () => {
    const source = "- [x] done\n- [ ] todo";
    const items = blocks(source)[0]!.children ?? [];

    expect(items.map((item) => item.type)).toEqual([
      "task_list_item",
      "task_list_item",
    ]);
    expect(items[0]!.checked).toBe(true);
    expect(items[1]!.checked).toBe(false);

    const firstContent = items[0]!.children?.[0];
    expect(source.slice(firstContent!.beg, firstContent!.end)).toBe("done");
  });

  it("lets a thematic break end the paragraph above it", () => {
    expect(types("Intro\n***\nOutro")).toEqual([
      "paragraph",
      "horizontal_rule",
      "paragraph",
    ]);
  });

  it("reads a rule under prose as a setext heading, not a break", () => {
    const setextBlocks = blocks("Intro\n---\nOutro");

    expect(setextBlocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
    ]);
    expect(setextBlocks[0]!.level).toBe(2);
    expect(blocks("Intro\n===\nOutro")[0]!.level).toBe(1);
  });

  it("lets a table end the paragraph above it", () => {
    expect(types("Intro\n| Col |\n| --- |\n| Cell |")).toEqual([
      "paragraph",
      "table",
    ]);
  });
});
