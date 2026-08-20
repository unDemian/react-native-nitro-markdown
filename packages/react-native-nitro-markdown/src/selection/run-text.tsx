import type { FC } from "react";
import { Text, type TextProps } from "react-native";
import type { MarkdownNode } from "../headless";

/**
 * Source range annotation carried by rendered spans inside a run. The
 * selectable host reads these to map a selection back onto markdown source.
 */
export type SourceRange = { beg: number; end: number };

/** The source range of a node, when the parse emitted offsets. */
export const sourceRangeOf = (node: MarkdownNode): SourceRange | undefined =>
  typeof node.beg === "number" && typeof node.end === "number"
    ? { beg: node.beg, end: node.end }
    : undefined;

export type RunTextProps = TextProps & {
  /**
   * The markdown source range this span renders. Synthetic text the renderer
   * invents (block separators, list bullets) carries no source range.
   */
  sourceRange?: SourceRange | undefined;
};

/**
 * The inline text primitive.
 *
 * Everything inside a run renders through this component — the library's own
 * inline spans and custom renderers alike. It is injectable (see the
 * `textPrimitive` prop on `Markdown`) so a platform can substitute a native
 * span implementation that carries `sourceRange` down to the selectable host.
 *
 * Custom inline renderers must emit text spans through this primitive, never
 * views: views nested in text are positioned via placeholder spans on Android
 * and selection degrades across them.
 */
export const RunText: FC<RunTextProps> = ({ sourceRange: _sourceRange, ...textProps }) => {
  return <Text {...textProps} />;
};
