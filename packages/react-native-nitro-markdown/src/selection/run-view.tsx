import {
  memo,
  useCallback,
  useContext,
  useMemo,
  type ComponentType,
  type FC,
  type ReactNode,
} from "react";
import type { MarkdownNode } from "../headless";
import { useMarkdownContext, type NodeRendererProps } from "../MarkdownContext";
import { getBaseStyles } from "../node-renderer";
import { mapSelectionToSource } from "./range-mapping";
import { RunFlowContext, RunSourceContext } from "./run-flow-context";
import { RunText } from "./run-text";
import { assembleRuns } from "./runs";
import {
  SelectableRunHost,
  type RunHostSelection,
} from "./selectable-run-host";

type BlockRenderer = ComponentType<NodeRendererProps>;

type RunViewProps = {
  blocks: MarkdownNode[];
  Renderer: BlockRenderer;
};

const blockKey = (node: MarkdownNode, index: number): string =>
  typeof node.beg === "number" ? `${node.type}:${node.beg}` : `${node.type}@${index}`;

/**
 * One run: a maximal sequence of adjacent flowing blocks rendered into a
 * single selectable host, so a reader can select and copy across all of them
 * in one gesture.
 *
 * Each run is a memoization boundary compared on the identity of the AST
 * nodes it contains. `Markdown` reuses the identity of every node a parse left
 * untouched (see reuseStableAstNodes), so appending a chunk re-renders only
 * the still-growing tail run — whether the consumer streams through `children`
 * or hands over a pre-parsed `sourceAst`.
 */
const RunViewComponent: FC<RunViewProps> = ({ blocks, Renderer }) => {
  const { theme, runHost, onCopyAsMarkdown, textPrimitive } =
    useMarkdownContext();
  const getSourceText = useContext(RunSourceContext);
  const Host = runHost ?? SelectableRunHost;
  const Primitive = textPrimitive ?? RunText;

  const handleCopyAsMarkdownRequested = useCallback(
    (selection: RunHostSelection) => {
      if (!onCopyAsMarkdown) return;
      const sourceText = getSourceText();
      const range = mapSelectionToSource({
        sourceText,
        spans: selection.spans,
        start: selection.start,
        end: selection.end,
      });
      if (!range) return;
      onCopyAsMarkdown(sourceText.slice(range.start, range.end));
    },
    [onCopyAsMarkdown, getSourceText],
  );

  const children: ReactNode[] = [];
  blocks.forEach((blockNode, index) => {
    if (index > 0) {
      children.push(
        <Primitive key={`separator:${blockKey(blockNode, index)}`}>
          {"\n\n"}
        </Primitive>,
      );
    }
    children.push(
      <Renderer
        key={blockKey(blockNode, index)}
        node={blockNode}
        depth={1}
        inListItem={false}
        parentIsText={true}
      />,
    );
  });

  return (
    <RunFlowContext.Provider value={true}>
      <Host
        style={getBaseStyles(theme).text}
        onCopyAsMarkdownRequested={handleCopyAsMarkdownRequested}
      >
        {children}
      </Host>
    </RunFlowContext.Provider>
  );
};

export const RunView = memo(
  RunViewComponent,
  (previousProps, nextProps) =>
    previousProps.Renderer === nextProps.Renderer &&
    previousProps.blocks.length === nextProps.blocks.length &&
    previousProps.blocks.every(
      (blockNode, index) => blockNode === nextProps.blocks[index],
    ),
) as FC<RunViewProps>;

type RunDocumentProps = {
  blocks: MarkdownNode[];
  Renderer: BlockRenderer;
};

/**
 * Renders a document's top-level blocks as runs and standalone blocks.
 * Standalone blocks render through the normal path — they keep their own
 * renderers and gestures, and selection stops at them.
 */
export const RunDocument: FC<RunDocumentProps> = ({ blocks, Renderer }) => {
  const { classifyBlock } = useMarkdownContext();
  const parts = useMemo(
    () => assembleRuns(blocks, classifyBlock),
    [blocks, classifyBlock],
  );

  return (
    <>
      {parts.map((part) =>
        part.kind === "run" ? (
          <RunView key={part.key} blocks={part.blocks} Renderer={Renderer} />
        ) : (
          <Renderer
            key={part.key}
            node={part.block}
            depth={1}
            inListItem={false}
          />
        ),
      )}
    </>
  );
};
