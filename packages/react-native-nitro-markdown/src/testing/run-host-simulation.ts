/**
 * Test drivers for the selectable run host.
 *
 * Tests never call range mapping directly: they render markdown, find a run
 * host in the rendered tree, and invoke the selection callbacks the host
 * exposes — exactly what the native host does when a reader drags a
 * selection. Span extraction here mirrors the native host's span-tree walk:
 * every rendered string belongs to the nearest ancestor span annotated with
 * a `sourceRange`; strings with no annotated ancestor are synthetic.
 */
import type { AnnotatedSpan } from "../selection/range-mapping";
import type { SourceRange } from "../selection/run-text";

/**
 * The shape these helpers need from a rendered node. Declared structurally
 * rather than imported from a test renderer, so that consuming this entry
 * point costs nothing but this package: react-test-renderer instances and
 * @testing-library/react-native instances both satisfy it.
 */
export type RenderedInstance = {
  props: Record<string, unknown>;
  children: readonly (RenderedInstance | string)[];
};

export const extractAnnotatedSpans = (
  host: RenderedInstance,
): AnnotatedSpan[] => {
  const spans: AnnotatedSpan[] = [];

  const visit = (
    node: RenderedInstance | string,
    range: SourceRange | undefined,
  ): void => {
    if (typeof node === "string") {
      spans.push(
        range
          ? { text: node, sourceBeg: range.beg, sourceEnd: range.end }
          : { text: node },
      );
      return;
    }
    const annotation = (node.props as { sourceRange?: SourceRange })
      .sourceRange;
    const nextRange = annotation ?? range;
    node.children.forEach((child) => visit(child, nextRange));
  };

  host.children.forEach((child) => visit(child, undefined));
  return spans;
};

/** The text a reader actually sees inside one run. */
export const getRenderedRunText = (host: RenderedInstance): string =>
  extractAnnotatedSpans(host)
    .map((span) => span.text)
    .join("");

type HostCallbackProps = {
  onCopyAsMarkdownRequested?: (selection: {
    start: number;
    end: number;
    spans: AnnotatedSpan[];
  }) => void;
};

/**
 * Drives one run host as a native host would when the reader picks "Copy as
 * Markdown" over the given range of the run's rendered text.
 */
export const simulateCopyAsMarkdown = (
  host: RenderedInstance,
  range: { start: number; end: number },
): void => {
  const props = host.props as HostCallbackProps;
  props.onCopyAsMarkdownRequested?.({
    ...range,
    spans: extractAnnotatedSpans(host),
  });
};
