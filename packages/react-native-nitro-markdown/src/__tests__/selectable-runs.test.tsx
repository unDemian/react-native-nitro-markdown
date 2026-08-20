import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import {
  getTextContent,
  parseMarkdown,
  type MarkdownNode,
} from "../headless";
import type { LinkRendererProps } from "../MarkdownContext";
import { Markdown } from "../markdown";
import { View } from "react-native";
import { Blockquote } from "../renderers/blockquote";
import { MathBlock, MathInline } from "../renderers/math";
import { RunText } from "../selection/run-text";
import {
  SelectableRunHost,
  type SelectableRunHostProps,
} from "../selection/selectable-run-host";
import {
  getRenderedRunText,
  simulateCopyAsMarkdown,
} from "../testing/run-host-simulation";
import { defaultMarkdownTheme } from "../theme";
import { reuseStableAstNodes } from "../utils/incremental-ast";

/** Resolves a style prop, which may be a single object or a nested array. */
const flattenStyle = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (merged, entry) => ({ ...merged, ...flattenStyle(entry) }),
      {},
    );
  }
  return style && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
};

/**
 * Stands in for a native host. It renders exactly what the default host
 * renders; the tests then fire its callbacks the way a native host does when a
 * reader drags a selection. Copy as Markdown is native-host work, so every
 * test that copies has to supply one — the same thing a consumer must do.
 */
const NativeHostStub: React.FC<SelectableRunHostProps> = (props) => (
  <SelectableRunHost {...props} />
);

const renderMarkdown = (element: React.ReactElement): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer as unknown as ReactTestRenderer;
};

const findHosts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(SelectableRunHost);

describe("selectable runs", () => {
  it("lets a reader select from a heading through paragraphs, a list and a blockquote as one piece of text", () => {
    const markdown =
      "# Title\n\nFirst paragraph.\n\n- alpha\n- beta\n\n> quoted line\n\nLast paragraph.";

    const renderer = renderMarkdown(<Markdown selectable>{markdown}</Markdown>);

    const hosts = findHosts(renderer);
    expect(hosts).toHaveLength(1);
    expect(getRenderedRunText(hosts[0]!)).toBe(
      "Title\n\nFirst paragraph.\n\n• alpha\n• beta\n\nquoted line\n\nLast paragraph.",
    );
  });

  it("still announces a heading to a screen reader inside a run", () => {
    const renderer = renderMarkdown(
      <Markdown selectable>{"# Title\n\nBody."}</Markdown>,
    );

    const host = findHosts(renderer)[0]!;
    const headers = host.findAll(
      (instance) => instance.props.accessibilityRole === "header",
    );
    expect(headers.length).toBeGreaterThan(0);
  });

  it("stops a selection at a fenced code block and resumes below it, while the code itself stays selectable", () => {
    const markdown = "Before code.\n\n```\nconst x = 1;\n```\n\nAfter code.";

    const renderer = renderMarkdown(<Markdown selectable>{markdown}</Markdown>);

    // Three selection scopes: the run above, the code block's own text, and
    // the run below. One drag can never cross the code block, but a reader
    // can select inside it.
    const hosts = findHosts(renderer);
    const hostTexts = hosts.map((host) => getRenderedRunText(host));
    expect(hostTexts).toEqual([
      "Before code.",
      "const x = 1;",
      "After code.",
    ]);
  });

  it("keeps table cells selectable, without letting a selection cross the table", () => {
    const markdown =
      "Intro.\n\n| Col |\n| --- |\n| Cell |\n\nOutro.";

    const renderer = renderMarkdown(<Markdown selectable>{markdown}</Markdown>);

    const hosts = findHosts(renderer);
    const hostTexts = hosts.map((host) => getRenderedRunText(host));

    // The prose runs never contain the table's text…
    expect(hostTexts).toContain("Intro.");
    expect(hostTexts).toContain("Outro.");
    expect(hostTexts.find((text) => text.includes("Intro"))).not.toContain(
      "Cell",
    );
    // …but each cell is its own selection scope.
    expect(hostTexts).toContain("Col");
    expect(hostTexts).toContain("Cell");
  });

  it("honours a consumer-registered standalone block when splitting runs", () => {
    const markdown = "Above.\n\n> aside\n\nBelow.";

    const renderer = renderMarkdown(
      <Markdown
        selectable
        classifyBlock={(node) =>
          node.type === "blockquote" ? "standalone" : undefined
        }
      >
        {markdown}
      </Markdown>,
    );

    expect(findHosts(renderer)).toHaveLength(2);
    // The standalone blockquote renders through its normal view renderer.
    expect(renderer.root.findAllByType(Blockquote)).toHaveLength(1);
  });

  it("hands the reader the markdown source for exactly the range they selected", () => {
    const markdown = "First one.\n\nSecond two.";
    const onCopyAsMarkdown = jest.fn();

    const renderer = renderMarkdown(
      <Markdown selectable runHost={NativeHostStub} onCopyAsMarkdown={onCopyAsMarkdown}>
        {markdown}
      </Markdown>,
    );

    const host = findHosts(renderer)[0]!;
    const renderedText = getRenderedRunText(host);
    const start = renderedText.indexOf("one.");
    const end = renderedText.indexOf("Second") + "Second".length;
    simulateCopyAsMarkdown(host, { start, end });

    expect(onCopyAsMarkdown).toHaveBeenCalledWith("one.\n\nSecond");
  });

  it("copies the inner characters when the selection is inside bold text", () => {
    const markdown = "a **bold** b";
    const onCopyAsMarkdown = jest.fn();

    const renderer = renderMarkdown(
      <Markdown selectable runHost={NativeHostStub} onCopyAsMarkdown={onCopyAsMarkdown}>
        {markdown}
      </Markdown>,
    );

    const host = findHosts(renderer)[0]!;
    expect(getRenderedRunText(host)).toBe("a bold b");
    // Select "old" out of the rendered "a bold b".
    simulateCopyAsMarkdown(host, { start: 3, end: 6 });

    expect(onCopyAsMarkdown).toHaveBeenCalledWith("old");
  });

  it("keeps a citation renderer tappable inside a run, with hidden citations staying hidden", () => {
    const markdown =
      "See [1](cite://a) and [2](cite://broken).\n\nNext paragraph.";
    const onCitationPress = jest.fn();
    const renderers = {
      link: (props: LinkRendererProps) => {
        if (props.href === "cite://broken") return null;
        return (
          <RunText
            sourceRange={
              typeof props.node.beg === "number" &&
              typeof props.node.end === "number"
                ? { beg: props.node.beg, end: props.node.end }
                : undefined
            }
            onPress={onCitationPress}
          >
            {`[${getTextContent(props.node)}]`}
          </RunText>
        );
      },
    };

    const renderer = renderMarkdown(
      <Markdown selectable renderers={renderers}>
        {markdown}
      </Markdown>,
    );

    const hosts = findHosts(renderer);
    expect(hosts).toHaveLength(1);

    const renderedText = getRenderedRunText(hosts[0]!);
    expect(renderedText).toContain("[1]");
    expect(renderedText).not.toContain("[2]");

    const tappable = hosts[0]!.findAll(
      (instance) => typeof instance.props.onPress === "function",
    );
    expect(tappable.length).toBeGreaterThan(0);
    tappable[0]!.props.onPress();
    expect(onCitationPress).toHaveBeenCalled();
  });

  it("copies the full citation markdown when a selection crosses a citation", () => {
    const markdown = "See [1](cite://a) here.";
    const onCopyAsMarkdown = jest.fn();
    const renderers = {
      link: (props: LinkRendererProps) => (
        <RunText
          sourceRange={
            typeof props.node.beg === "number" &&
            typeof props.node.end === "number"
              ? { beg: props.node.beg, end: props.node.end }
              : undefined
          }
        >
          {`[${getTextContent(props.node)}]`}
        </RunText>
      ),
    };

    const renderer = renderMarkdown(
      <Markdown
        selectable
        runHost={NativeHostStub}
        renderers={renderers}
        onCopyAsMarkdown={onCopyAsMarkdown}
      >
        {markdown}
      </Markdown>,
    );

    const host = findHosts(renderer)[0]!;
    const renderedText = getRenderedRunText(host);
    expect(renderedText).toBe("See [1] here.");
    simulateCopyAsMarkdown(host, { start: 0, end: renderedText.length });

    expect(onCopyAsMarkdown).toHaveBeenCalledWith("See [1](cite://a) here.");
  });

  it("shows the reader typographic punctuation and still copies the straight-quoted source", () => {
    const markdown = 'She said "hello" -- twice.';
    const onCopyAsMarkdown = jest.fn();

    const renderer = renderMarkdown(
      <Markdown
        selectable
        runHost={NativeHostStub}
        smartPunctuation
        onCopyAsMarkdown={onCopyAsMarkdown}
      >
        {markdown}
      </Markdown>,
    );

    const host = findHosts(renderer)[0]!;
    const renderedText = getRenderedRunText(host);
    expect(renderedText).toBe("She said “hello” – twice.");

    simulateCopyAsMarkdown(host, { start: 0, end: renderedText.length });
    expect(onCopyAsMarkdown).toHaveBeenCalledWith(markdown);
  });

  it("does not re-render settled runs when a streamed chunk arrives", () => {
    const spyRenderer = jest.fn(() => undefined);
    const renderers = { text: spyRenderer };

    const settledText =
      "Settled paragraph.\n\n```\ncode\n```\n\nTail starts";
    const grownText = `${settledText} and grows.`;

    const settledAst = parseMarkdown(settledText);
    const grownAst = reuseStableAstNodes(settledAst, parseMarkdown(grownText));

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <Markdown selectable sourceAst={settledAst} renderers={renderers}>
          {settledText}
        </Markdown>,
      );
    });
    act(() => {
      renderer!.update(
        <Markdown selectable sourceAst={grownAst} renderers={renderers}>
          {grownText}
        </Markdown>,
      );
    });

    const settledRenders = spyRenderer.mock.calls.filter(
      (call) =>
        (call as unknown as [{ node: { content?: string } }])[0].node
          .content === "Settled paragraph.",
    );
    const tailRenders = spyRenderer.mock.calls.filter((call) =>
      (
        (call as unknown as [{ node: { content?: string } }])[0].node.content ??
        ""
      ).startsWith("Tail starts"),
    );

    // The settled run rendered once; only the still-growing tail re-rendered.
    expect(settledRenders).toHaveLength(1);
    expect(tailRenders.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps selection available mid-stream through the same rendering path", () => {
    const streamingText = "First paragraph.\n\nStill arri";
    const streamingAst = parseMarkdown(streamingText);
    const onCopyAsMarkdown = jest.fn();

    const renderer = renderMarkdown(
      <Markdown
        selectable
        runHost={NativeHostStub}
        sourceAst={streamingAst}
        onCopyAsMarkdown={onCopyAsMarkdown}
      >
        {streamingText}
      </Markdown>,
    );

    const host = findHosts(renderer)[0]!;
    expect(getRenderedRunText(host)).toBe("First paragraph.\n\nStill arri");

    const renderedText = getRenderedRunText(host);
    simulateCopyAsMarkdown(host, { start: 0, end: renderedText.length });
    expect(onCopyAsMarkdown).toHaveBeenCalledWith(streamingText);
  });

  it("copies only the wrapped lines a reader selected across a source line break", () => {
    const markdown = "Alpha beta\ngamma delta.\n\nNext.";
    const onCopyAsMarkdown = jest.fn();

    const renderer = renderMarkdown(
      <Markdown
        selectable
        runHost={NativeHostStub}
        onCopyAsMarkdown={onCopyAsMarkdown}
      >
        {markdown}
      </Markdown>,
    );

    const host = findHosts(renderer)[0]!;
    const renderedText = getRenderedRunText(host);
    expect(renderedText).toBe("Alpha beta gamma delta.\n\nNext.");

    // The soft break renders as one space and owns the newline it came from,
    // so a selection crossing the wrap maps to those characters — not to the
    // whole paragraph, which is what an unannotated break used to produce.
    simulateCopyAsMarkdown(host, {
      start: renderedText.indexOf("beta"),
      end: renderedText.indexOf("gamma") + "gamma".length,
    });

    expect(onCopyAsMarkdown).toHaveBeenCalledWith("beta\ngamma");
  });

  it("closes a quote that inline markup pushed into its own text node", () => {
    const renderer = renderMarkdown(
      <Markdown selectable smartPunctuation>
        {'She said "**yes**" and left.'}
      </Markdown>,
    );

    expect(getRenderedRunText(findHosts(renderer)[0]!)).toBe(
      "She said “yes” and left.",
    );
  });

  it("leaves a command-line flag in prose alone under smart punctuation", () => {
    const renderer = renderMarkdown(
      <Markdown selectable smartPunctuation>
        {"Run it with --verbose to trace."}
      </Markdown>,
    );

    expect(getRenderedRunText(findHosts(renderer)[0]!)).toBe(
      "Run it with --verbose to trace.",
    );
  });
});

describe("blocks that render a view keep their own renderer", () => {
  // The mock parser emits neither images nor math, so the tree comes in
  // pre-parsed — the point under test is classification, not parsing.
  const source = "Intro.\n\n$$x^2$$\n\nSee $y$ inline.";
  const sourceAst: MarkdownNode = {
    type: "document",
    beg: 0,
    end: source.length,
    children: [
      {
        type: "paragraph",
        beg: 0,
        end: 6,
        children: [{ type: "text", content: "Intro.", beg: 0, end: 6 }],
      },
      {
        type: "math_block",
        beg: 8,
        end: 15,
        children: [{ type: "text", content: "x^2", beg: 10, end: 13 }],
      },
      {
        type: "paragraph",
        beg: 17,
        end: 32,
        children: [
          { type: "text", content: "See ", beg: 17, end: 21 },
          {
            type: "math_inline",
            beg: 21,
            end: 24,
            children: [{ type: "text", content: "y", beg: 22, end: 23 }],
          },
          { type: "text", content: " inline.", beg: 24, end: 32 },
        ],
      },
    ],
  };

  it("never nests a view inside a run's text host", () => {
    const renderer = renderMarkdown(
      <Markdown selectable sourceAst={sourceAst}>
        {source}
      </Markdown>,
    );

    // Math draws a view. A view nested in text is positioned by placeholder
    // spans on Android and selection degrades across it, so both the math
    // block and the paragraph carrying inline math terminate the run instead.
    const hosts = findHosts(renderer);
    expect(hosts.map(getRenderedRunText)).toEqual(["Intro."]);
    for (const host of hosts) {
      expect(host.findAllByType(View)).toHaveLength(0);
    }
  });

  it("still renders the math through its own renderer", () => {
    const renderer = renderMarkdown(
      <Markdown selectable sourceAst={sourceAst}>
        {source}
      </Markdown>,
    );

    expect(renderer.root.findAllByType(MathBlock)).toHaveLength(1);
    expect(renderer.root.findAllByType(MathInline)).toHaveLength(1);
  });
});

describe("how a run presents the blocks inside it", () => {
  it("keeps the blank line between a blockquote's paragraphs", () => {
    // The mock parser folds a quote into one paragraph, so the two-paragraph
    // shape comes in as a pre-parsed tree.
    const source = "> first\n>\n> second";
    const sourceAst: MarkdownNode = {
      type: "document",
      beg: 0,
      end: source.length,
      children: [
        {
          type: "blockquote",
          beg: 0,
          end: source.length,
          children: [
            {
              type: "paragraph",
              beg: 2,
              end: 7,
              children: [{ type: "text", content: "first", beg: 2, end: 7 }],
            },
            {
              type: "paragraph",
              beg: 12,
              end: 18,
              children: [{ type: "text", content: "second", beg: 12, end: 18 }],
            },
          ],
        },
      ],
    };

    const renderer = renderMarkdown(
      <Markdown selectable sourceAst={sourceAst}>
        {source}
      </Markdown>,
    );

    expect(getRenderedRunText(findHosts(renderer)[0]!)).toBe("first\n\nsecond");
  });

  it("breaks and indents a nested list by one level per level of nesting", () => {
    const source = "- parent\n  - child";
    const sourceAst: MarkdownNode = {
      type: "document",
      beg: 0,
      end: source.length,
      children: [
        {
          type: "list",
          ordered: false,
          beg: 0,
          end: source.length,
          children: [
            {
              type: "list_item",
              beg: 0,
              end: source.length,
              children: [
                {
                  type: "paragraph",
                  beg: 2,
                  end: 8,
                  children: [
                    { type: "text", content: "parent", beg: 2, end: 8 },
                  ],
                },
                {
                  type: "list",
                  ordered: false,
                  beg: 11,
                  end: 18,
                  children: [
                    {
                      type: "list_item",
                      beg: 11,
                      end: 18,
                      children: [
                        {
                          type: "paragraph",
                          beg: 13,
                          end: 18,
                          children: [
                            { type: "text", content: "child", beg: 13, end: 18 },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const renderer = renderMarkdown(
      <Markdown selectable sourceAst={sourceAst}>
        {source}
      </Markdown>,
    );

    expect(getRenderedRunText(findHosts(renderer)[0]!)).toBe(
      "• parent\n  • child",
    );
  });

  it("lets a blockquote's muted colour reach the text inside it", () => {
    const renderer = renderMarkdown(
      <Markdown selectable>{"> quoted line"}</Markdown>,
    );

    const host = findHosts(renderer)[0]!;
    const declaredColours = host
      .findAllByType(RunText)
      .map((span) => flattenStyle(span.props.style).color)
      .filter((colour) => colour !== undefined);

    // Exactly one span names a colour — the quote's. A paragraph that restated
    // the body colour would win, because the innermost span does.
    expect(declaredColours).toEqual([defaultMarkdownTheme.colors.textMuted]);
  });

  it("says so when a block style override cannot apply inside a run", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const renderer = renderMarkdown(
        <Markdown selectable styles={{ paragraph: { marginBottom: 24 } }}>
          {"Body."}
        </Markdown>,
      );

      const paragraphWarnings = warn.mock.calls.filter((call) =>
        String(call[0]).includes("marginBottom"),
      );
      expect(paragraphWarnings).toHaveLength(1);

      const host = findHosts(renderer)[0]!;
      for (const span of host.findAllByType(RunText)) {
        expect(flattenStyle(span.props.style).marginBottom).toBeUndefined();
      }
    } finally {
      warn.mockRestore();
    }
  });
});
