import {
  mapSelectionToSource,
  type AnnotatedSpan,
} from "../selection/range-mapping";

describe("mapping a selected range back onto markdown source", () => {
  it("maps a selection inside one paragraph to the same characters of source", () => {
    const sourceText = "Hello world";
    const spans: AnnotatedSpan[] = [
      { text: "Hello world", sourceBeg: 0, sourceEnd: 11 },
    ];

    const range = mapSelectionToSource({
      sourceText,
      spans,
      start: 6,
      end: 11,
    });

    expect(range).toEqual({ start: 6, end: 11 });
    expect(sourceText.slice(range!.start, range!.end)).toBe("world");
  });

  it("maps a selection spanning two paragraphs across the synthetic separator", () => {
    const sourceText = "First one.\n\nSecond two.";
    const spans: AnnotatedSpan[] = [
      { text: "First one.", sourceBeg: 0, sourceEnd: 10 },
      { text: "\n\n" }, // separator the renderer synthesised; no source of its own
      { text: "Second two.", sourceBeg: 12, sourceEnd: 23 },
    ];

    // Rendered text is "First one.\n\nSecond two."; select "one.\n\nSecond".
    const range = mapSelectionToSource({
      sourceText,
      spans,
      start: 6,
      end: 18,
    });

    expect(sourceText.slice(range!.start, range!.end)).toBe(
      "one.\n\nSecond",
    );
  });

  it("maps a selection of bold text to the inner source characters", () => {
    const sourceText = "a **bold** b";
    const spans: AnnotatedSpan[] = [
      { text: "a ", sourceBeg: 0, sourceEnd: 2 },
      { text: "bold", sourceBeg: 4, sourceEnd: 8 },
      { text: " b", sourceBeg: 8, sourceEnd: 12 },
    ];

    // Rendered text is "a bold b"; select "old".
    const range = mapSelectionToSource({ sourceText, spans, start: 3, end: 6 });

    expect(sourceText.slice(range!.start, range!.end)).toBe("old");
  });

  it("snaps to whole-span source when rendered text no longer lines up with source", () => {
    // "to be continued..." rendered with an ellipsis is shorter than its source,
    // so character positions inside the span cannot be trusted.
    const sourceText = "to be continued...";
    const spans: AnnotatedSpan[] = [
      { text: "to be continued…", sourceBeg: 0, sourceEnd: 18 },
    ];

    const range = mapSelectionToSource({ sourceText, spans, start: 3, end: 8 });

    expect(range).toEqual({ start: 0, end: 18 });
  });

  it("returns nothing when the selection covers only synthesised text", () => {
    const sourceText = "- a\n- b";
    const spans: AnnotatedSpan[] = [
      { text: "• " },
      { text: "a", sourceBeg: 2, sourceEnd: 3 },
      { text: "\n" },
      { text: "• " },
      { text: "b", sourceBeg: 6, sourceEnd: 7 },
    ];

    // Select just the second bullet prefix.
    const range = mapSelectionToSource({ sourceText, spans, start: 4, end: 6 });

    expect(range).toBeNull();
  });

  it("returns nothing for an empty selection", () => {
    const range = mapSelectionToSource({
      sourceText: "abc",
      spans: [{ text: "abc", sourceBeg: 0, sourceEnd: 3 }],
      start: 2,
      end: 2,
    });

    expect(range).toBeNull();
  });

  it("returns nothing when the span offsets run past the end of the source", () => {
    // Offsets can outrun the source: a stale tree during a stream race, or a
    // source string that is not the one the offsets index. Clamping such a
    // range collapses it to a single point, and handing that back would make
    // Copy as Markdown fire with an empty string and wipe the clipboard.
    const range = mapSelectionToSource({
      sourceText: "0123456789",
      spans: [{ text: "x", sourceBeg: 40, sourceEnd: 60 }],
      start: 0,
      end: 1,
    });

    expect(range).toBeNull();
  });

  it("keeps the part of a range that is still inside the source", () => {
    const sourceText = "0123456789";
    const range = mapSelectionToSource({
      sourceText,
      spans: [{ text: "0123456789 and more", sourceBeg: 0, sourceEnd: 19 }],
      start: 0,
      end: 19,
    });

    expect(range).toEqual({ start: 0, end: 10 });
  });

  it("spans bullets and line breaks when a reader selects across list items", () => {
    const sourceText = "- alpha\n- beta";
    const spans: AnnotatedSpan[] = [
      { text: "• " },
      { text: "alpha", sourceBeg: 2, sourceEnd: 7 },
      { text: "\n" },
      { text: "• " },
      { text: "beta", sourceBeg: 10, sourceEnd: 14 },
    ];

    // Rendered text: "• alpha\n• beta" — select from "alpha" through "beta".
    const range = mapSelectionToSource({
      sourceText,
      spans,
      start: 2,
      end: 14,
    });

    expect(sourceText.slice(range!.start, range!.end)).toBe(
      "alpha\n- beta",
    );
  });
});
