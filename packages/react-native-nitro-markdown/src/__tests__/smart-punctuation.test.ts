import {
  smartenText,
  trailingSmartChar,
} from "../selection/smart-punctuation";

describe("smart punctuation", () => {
  it("shows a reader curly double quotes instead of straight ones", () => {
    expect(smartenText('She said "hello" to me')).toBe(
      "She said “hello” to me",
    );
  });

  it("shows a reader curly single quotes and apostrophes", () => {
    expect(smartenText("It's 'quoted' text")).toBe(
      "It’s ‘quoted’ text",
    );
  });

  it("shows an en dash for -- and an em dash for ---", () => {
    expect(smartenText("pages 10--20")).toBe("pages 10–20");
    expect(smartenText("wait --- what")).toBe("wait — what");
  });

  it("shows an ellipsis character for three dots", () => {
    expect(smartenText("to be continued...")).toBe("to be continued…");
  });

  it("leaves text without punctuation untouched, as the same string", () => {
    const text = "plain text with no punctuation";
    expect(smartenText(text)).toBe(text);
  });

  it("does not turn a hyphenated word into a dash", () => {
    expect(smartenText("well-known fact")).toBe("well-known fact");
  });

  it("keeps quote substitution the same length as the source", () => {
    const source = 'A "quote" and it\'s fine';
    expect(smartenText(source)).toHaveLength(source.length);
  });

  it("leaves a command-line flag alone instead of dashing it", () => {
    // markdown-it's typographer only converts a double hyphen that has space
    // on both sides or word characters on both sides. Prose that mentions a
    // flag outside backticks must survive intact.
    expect(smartenText("Run it with --verbose to trace.")).toBe(
      "Run it with --verbose to trace.",
    );
    expect(smartenText("git commit --amend")).toBe("git commit --amend");
  });

  it("still dashes a double hyphen that is spaced or word-tight", () => {
    expect(smartenText("wait -- what")).toBe("wait – what");
    expect(smartenText("pages 10--20")).toBe("pages 10–20");
  });

  it("closes a quote that starts its own text node after inline markup", () => {
    // Rendering 'She said "**yes**"' splits the prose into three text nodes and
    // the closing quote begins the last one. Without the preceding character
    // the reader sees two opening quotes.
    expect(smartenText('"', "s")).toBe("”");
    expect(smartenText('" and on', "s")).toBe("” and on");
  });

  it("still opens a quote when nothing precedes it", () => {
    expect(smartenText('"yes"', undefined)).toBe("“yes”");
    expect(smartenText('"yes"', " ")).toBe("“yes”");
  });

  it("reports the character a reader sees last, for the next node to use", () => {
    expect(trailingSmartChar("She said ")).toBe(" ");
    expect(trailingSmartChar("")).toBeUndefined();
  });
});
