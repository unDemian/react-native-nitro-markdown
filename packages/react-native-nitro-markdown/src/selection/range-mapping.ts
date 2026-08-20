/**
 * Maps a selected range of a run's rendered text back onto the markdown
 * source that produced it.
 *
 * The selectable host reports selection offsets into the text it actually
 * displays. Each rendered span is annotated with the source range of the AST
 * node it came from; synthetic text the renderer added (block separators,
 * list bullets) carries no source range and never contributes to mapping.
 *
 * Inside a span, character positions are trusted only when the rendered text
 * is the same length as its source slice (plain text is; text that went
 * through a length-changing transform, or contained entities, is not). When
 * positions cannot be trusted the span maps to its whole source range.
 */

export type AnnotatedSpan = {
  /** The text this span actually renders. */
  text: string;
  /** Source range the span was rendered from; omitted for synthetic text. */
  sourceBeg?: number;
  sourceEnd?: number;
};

export type MappedSourceRange = { start: number; end: number };

export const mapSelectionToSource = ({
  sourceText,
  spans,
  start,
  end,
}: {
  sourceText: string;
  spans: readonly AnnotatedSpan[];
  start: number;
  end: number;
}): MappedSourceRange | null => {
  if (!(end > start)) return null;

  let renderedCursor = 0;
  let mappedStart: number | null = null;
  let mappedEnd: number | null = null;

  for (const span of spans) {
    const spanStart = renderedCursor;
    const spanEnd = spanStart + span.text.length;
    renderedCursor = spanEnd;

    if (spanEnd <= start || spanStart >= end) continue;
    if (span.sourceBeg === undefined || span.sourceEnd === undefined) continue;

    const exact = span.text.length === span.sourceEnd - span.sourceBeg;
    const overlapStart = Math.max(start, spanStart);
    const overlapEnd = Math.min(end, spanEnd);

    const from = exact
      ? span.sourceBeg + (overlapStart - spanStart)
      : span.sourceBeg;
    const to = exact
      ? span.sourceBeg + (overlapEnd - spanStart)
      : span.sourceEnd;

    if (mappedStart === null || from < mappedStart) mappedStart = from;
    if (mappedEnd === null || to > mappedEnd) mappedEnd = to;
  }

  if (mappedStart === null || mappedEnd === null) return null;

  // Clamp before the emptiness check, never after: offsets can outrun the
  // source (a stale tree mid-stream, or a source string that is not the one
  // the offsets index), and a range clamped to a single point is not a
  // selection. Returning it would hand the consumer an empty string to copy.
  const clampedStart = Math.max(0, Math.min(mappedStart, sourceText.length));
  const clampedEnd = Math.max(0, Math.min(mappedEnd, sourceText.length));
  if (clampedEnd <= clampedStart) return null;

  return { start: clampedStart, end: clampedEnd };
};
