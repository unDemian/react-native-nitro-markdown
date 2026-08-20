import type { FC, ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import type { AnnotatedSpan } from "./range-mapping";

/**
 * A selection reported by the host: offsets into the rendered text of the
 * run, plus the annotated spans that make that text up, in rendered order.
 * The host owns span extraction because only the rendered tree knows what
 * custom renderers actually emitted.
 */
export type RunHostSelection = {
  start: number;
  end: number;
  spans: AnnotatedSpan[];
};

export type SelectableRunHostProps = {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  /**
   * Fired when the reader picks "Copy as Markdown" from the selection menu.
   * Only a native host can fire this; see the note on the default host below.
   */
  onCopyAsMarkdownRequested?: (selection: RunHostSelection) => void;
};

/**
 * The host a run renders into: one native text tree per run, so that a
 * selection can span every block inside it.
 *
 * This default host is the platform's own selectable text component. On
 * Android that already compiles nested children into a single span tree and
 * supports drag-handle selection across the whole run; on iOS the platform
 * component only offers whole-text selection.
 *
 * What it cannot do on either platform is report *which* range the reader
 * selected, so it never calls `onCopyAsMarkdownRequested` and a consumer's
 * `onCopyAsMarkdown` never fires. Range selection and the "Copy as Markdown"
 * menu action are native work, provided by the host that replaces this one
 * through the `runHost` prop (see docs/selectable-runs.md — host contract).
 */
export const SelectableRunHost: FC<SelectableRunHostProps> = ({
  children,
  style,
  onCopyAsMarkdownRequested: _onCopyAsMarkdownRequested,
}) => {
  return (
    <Text selectable style={style}>
      {children}
    </Text>
  );
};
