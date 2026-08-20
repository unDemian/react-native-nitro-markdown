import {
  getRunFlowStyles,
  toRunFlowTextStyle,
} from "../selection/run-flow-styles";
import { defaultMarkdownTheme, mergeThemes } from "../theme";

describe("styles for blocks rendered inside a run", () => {
  it("gives a heading the same typography as the standalone heading renderer", () => {
    // Toggling `selectable` must not restyle the document, so weight and
    // letter spacing are resolved the same way in both paths.
    const headings = getRunFlowStyles(defaultMarkdownTheme).heading;

    expect(headings[1].fontWeight).toBe("700");
    expect(headings[1].letterSpacing).toBe(-0.6);
    expect(headings[2].letterSpacing).toBe(-0.4);
    expect(headings[3].letterSpacing).toBe(-0.2);
    expect(headings[6].color).toBe(defaultMarkdownTheme.colors.textMuted);
  });

  it("honours a theme's own heading weight", () => {
    const theme = mergeThemes(defaultMarkdownTheme, { headingWeight: "500" });

    expect(getRunFlowStyles(theme).heading[2].fontWeight).toBe("500");
  });

  it("caches the styles it builds per theme", () => {
    expect(getRunFlowStyles(defaultMarkdownTheme)).toBe(
      getRunFlowStyles(defaultMarkdownTheme),
    );
  });

  it("leaves a blockquote's colour to cascade over the text inside it", () => {
    const blockquote = getRunFlowStyles(defaultMarkdownTheme).blockquote;

    expect(blockquote.color).toBe(defaultMarkdownTheme.colors.textMuted);
    expect(blockquote.fontStyle).toBe("italic");
  });
});

describe("narrowing a block style override to what a run can render", () => {
  it("keeps the text properties a nested span honours", () => {
    expect(
      toRunFlowTextStyle({ color: "#f00", fontSize: 20 }, "paragraph"),
    ).toEqual({ color: "#f00", fontSize: 20 });
  });

  it("passes undefined straight through", () => {
    expect(toRunFlowTextStyle(undefined, "paragraph")).toBeUndefined();
  });

  it("returns undefined when nothing survives the narrowing", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(toRunFlowTextStyle({ borderTopWidth: 3 }, "blockquote")).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it("drops view-only properties and says which ones, once", () => {
    // A run is one native text tree, so margins and borders cannot apply. The
    // old force-cast dropped them silently and hid it from the type-checker.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const style = toRunFlowTextStyle(
        { marginBottom: 24, paddingLeft: 12, color: "#0f0" },
        "listStyleWarning",
      );

      expect(style).toEqual({ color: "#0f0" });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain("marginBottom");
      expect(warn.mock.calls[0]![0]).toContain("paddingLeft");

      toRunFlowTextStyle(
        { marginBottom: 24, paddingLeft: 12, color: "#0f0" },
        "listStyleWarning",
      );
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("ignores properties a consumer explicitly left undefined", () => {
    expect(
      toRunFlowTextStyle({ marginTop: undefined, color: "#00f" }, "paragraph"),
    ).toEqual({ color: "#00f" });
  });
});
