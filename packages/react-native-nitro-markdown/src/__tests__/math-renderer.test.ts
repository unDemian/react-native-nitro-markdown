import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MarkdownContext } from "../MarkdownContext";
import { MathBlock, MathInline } from "../renderers/math";
import { defaultMarkdownTheme } from "../theme";

// The fork ships no math engine: the math rendering peer dependency was
// dropped outright, so math content renders as monospace text.

const renderWithContext = (
  ...children: Parameters<typeof createElement>[2][]
): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  const consoleErrorSpy = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    act(() => {
      renderer = create(
        createElement(
          MarkdownContext.Provider,
          {
            value: {
              renderers: {},
              theme: defaultMarkdownTheme,
              stylingStrategy: "opinionated",
            },
          },
          ...children,
        ),
      );
    });
  } finally {
    consoleErrorSpy.mockRestore();
  }
  return renderer as unknown as ReactTestRenderer;
};

describe("math renderers without a math engine", () => {
  it("shows a reader inline math as monospace text", () => {
    const renderer = renderWithContext(
      createElement(MathInline, { content: "E = mc^2" }),
    );

    const textNodes = renderer.root.findAllByType("Text");
    expect(textNodes).toHaveLength(1);
    expect(textNodes[0]!.children).toEqual(["E = mc^2"]);
  });

  it("shows a reader block math as monospace text in a horizontal viewport", () => {
    const content = "\\sum_{n=1}^{\\infty} n";
    const renderer = renderWithContext(
      createElement(MathBlock, { content }),
    );

    const textNodes = renderer.root.findAllByType("Text");
    expect(textNodes).toHaveLength(1);
    expect(textNodes[0]!.children).toEqual([content]);

    // Wide math can still be panned horizontally.
    const pannable = renderer.root.findAll(
      (instance) =>
        typeof instance.props.onMoveShouldSetPanResponder === "function",
    );
    expect(pannable.length).toBeGreaterThan(0);
  });

  it("renders nothing for empty math content", () => {
    const renderer = renderWithContext(
      createElement(MathInline, { content: "" }),
      createElement(MathBlock, { content: "" }),
    );

    expect(renderer.root.findAllByType("Text")).toHaveLength(0);
  });
});
