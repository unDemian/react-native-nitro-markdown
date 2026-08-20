import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
  type FC,
  type ReactElement,
} from "react";
import {
  View,
  Text,
  FlatList,
  Platform,
  type ListRenderItemInfo,
  type FlatListProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  getFlattenedText,
  type MarkdownNode,
} from "./headless";
import type { ParserOptions } from "./Markdown.nitro";
import {
  MarkdownContext,
  type CustomRenderers,
  type LinkPressHandler,
  type MarkdownContextValue,
  type TableOptions,
} from "./MarkdownContext";
import { NodeRenderer, getBaseStyles } from "./node-renderer";
import type { ClassifyBlock } from "./selection/classification";
import { RunSourceContext } from "./selection/run-flow-context";
import type { RunTextProps } from "./selection/run-text";
import type { SelectableRunHostProps } from "./selection/selectable-run-host";
import {
  defaultMarkdownTheme,
  minimalMarkdownTheme,
  mergeThemes,
  type PartialMarkdownTheme,
  type NodeStyleOverrides,
  type StylingStrategy,
} from "./theme";
import type { CodeHighlighter } from "./utils/code-highlight";
import { reuseStableAstNodes } from "./utils/incremental-ast";
import type { UrlSafetyOptions } from "./utils/link-security";
import {
  applyAfterParsePlugins,
  applyBeforeParsePlugins,
  cloneMarkdownNode,
  getParserOptionsKey,
  hashString,
  isMarkdownNode,
  normalizeParserOptions,
  parseWithNativeParser,
  safeOnError,
  sortPluginsByPriority,
  warnInDev,
  ERROR_PHASE,
  type MarkdownErrorPhase,
} from "./utils/parse-pipeline";

export type { MarkdownErrorPhase } from "./utils/parse-pipeline";

type ParseAstCacheEntry = {
  text: string;
  ast: MarkdownNode;
};

const MAX_PARSE_CACHE_ENTRIES = 32;
const MAX_CACHEABLE_TEXT_LENGTH = 24_000;
const EMPTY_RENDERERS: CustomRenderers = {};

export type ParseCacheStats = {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
};

export type AstTransform = (ast: MarkdownNode) => MarkdownNode;
export type MarkdownVirtualizationOptions = Pick<
  FlatListProps<MarkdownNode>,
  | "initialNumToRender"
  | "maxToRenderPerBatch"
  | "windowSize"
  | "updateCellsBatchingPeriod"
  | "removeClippedSubviews"
>;

export type MarkdownPlugin = {
  /**
   * Optional plugin name used for diagnostics and debugging.
   */
  name?: string;
  /**
   * Optional plugin version metadata for diagnostics.
   */
  version?: string | number;
  /**
   * Execution priority. Higher values run first (default: 0).
   */
  priority?: number;
  /**
   * Optional text preprocessor executed before native parsing.
   * Should return a full markdown string.
   */
  beforeParse?: (markdown: string) => string;
  /**
   * Optional AST postprocessor executed after native parsing.
   */
  afterParse?: AstTransform;
};

export type MarkdownParseCompleteResult = {
  raw: string;
  ast: MarkdownNode;
  text: string;
  /**
   * Per-instance parse cache counters for the current parse cycle.
   */
  cacheStats?: ParseCacheStats;
};

const getCachedParsedAst = (
  text: string,
  options: ParserOptions | undefined,
  cache: Map<string, ParseAstCacheEntry>,
  stats: { hits: number; misses: number; evictions: number },
): MarkdownNode => {
  if (text.length > MAX_CACHEABLE_TEXT_LENGTH) {
    return parseWithNativeParser(text, options);
  }

  const cacheKey = `${getParserOptionsKey(options)}|${text.length}|${hashString(text)}`;
  const cachedEntry = cache.get(cacheKey);
  if (cachedEntry?.text === text) {
    stats.hits += 1;
    cache.delete(cacheKey);
    cache.set(cacheKey, cachedEntry);
    return cloneMarkdownNode(cachedEntry.ast);
  }

  stats.misses += 1;
  const parsedNode = parseWithNativeParser(text, options);
  cache.set(cacheKey, {
    text,
    ast: parsedNode,
  });
  if (cache.size > MAX_PARSE_CACHE_ENTRIES) {
    const oldestCacheKey = cache.keys().next().value;
    if (typeof oldestCacheKey === "string") {
      cache.delete(oldestCacheKey);
      stats.evictions += 1;
    }
  }

  return cloneMarkdownNode(parsedNode);
};

export type MarkdownProps = {
  /**
   * The markdown string to parse and render.
   */
  children: string;
  /**
   * Parser options to enable GFM, math, or raw HTML AST support.
   */
  options?: ParserOptions;
  /**
   * Optional parser plugins for preprocessing and AST postprocessing.
   */
  plugins?: MarkdownPlugin[];
  /**
   * Optional pre-parsed AST.
   * When provided, native parse is skipped and this tree is rendered instead.
   */
  sourceAst?: MarkdownNode;
  /**
   * Enables internal parse AST cache keyed by parser options and markdown.
   * Disable to force native parse on each parse cycle.
   * @default true
   */
  parseCache?: boolean;
  /**
   * Optional transform applied after parsing and before rendering.
   * The transformed AST is also returned in `onParseComplete`.
   */
  astTransform?: AstTransform;
  /**
   * @deprecated Parsing is synchronous in `<Markdown>`, so this callback has
   * no in-progress window: it fires in the `useEffect` commit phase after the
   * new AST is already rendered. Use `onParseComplete` for post-parse
   * inspection, and `MarkdownStream` (`sourceAstStatus`, `initialParseMode`)
   * when you need a real asynchronous parse state.
   *
   * Callback fired after the current parse cycle completes and the component
   * has re-rendered with new content. Because the native parser runs
   * synchronously inside `useMemo`, there is no observable "in-progress"
   * window.
   */
  onParsingInProgress?: () => void;
  /**
   * Callback fired when parsing completes.
   */
  onParseComplete?: (result: MarkdownParseCompleteResult) => void;
  /**
   * Called when a parse error or plugin error occurs.
   * @param error - The thrown error.
   * @param phase - Where the error occurred.
   * @param pluginName - The plugin name, if applicable.
   */
  onError?: (
    error: Error,
    phase: MarkdownErrorPhase,
    pluginName?: string,
  ) => void;
  /**
   * Custom renderers for specific markdown node types.
   * Each renderer receives { node, children, Renderer } plus type-specific props.
   */
  renderers?: CustomRenderers;
  /**
   * Custom theme tokens to override default styles.
   */
  theme?: PartialMarkdownTheme;
  /**
   * Style overrides for specific node types.
   * Applied after internal styles, allowing fine-grained customization.
   * @example
   * ```tsx
   * <Markdown styles={{ heading: { color: 'red' }, code_block: { borderRadius: 0 } }}>
   *   {content}
   * </Markdown>
   * ```
   */
  styles?: NodeStyleOverrides;
  /**
   * Styling strategy for the component.
   * - "opinionated": Balanced defaults with spacing and neutral colors (default)
   * - "minimal": Bare minimum styling for a clean slate
   */
  stylingStrategy?: StylingStrategy;
  /**
   * Optional style for the container view.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * Optional link press handler.
   * Return false to prevent the default openURL behavior.
   */
  onLinkPress?: LinkPressHandler;
  /**
   * Enables top-level block virtualization for very large markdown documents.
   * Best used when Markdown is the primary scroll container on screen.
   * - `true`: always virtualize when block threshold is met
   * - `"auto"`: virtualize only when threshold is met (recommended for large docs)
   * - `false`: disable virtualization (default)
   */
  virtualize?: boolean | "auto";
  /**
   * Minimum number of top-level blocks before virtualization is activated.
   * Helps avoid FlatList overhead on small documents.
   */
  virtualizationMinBlocks?: number;
  /**
   * Optional FlatList tuning for virtualization.
   */
  virtualization?: MarkdownVirtualizationOptions;
  /**
   * Optional configuration for the table renderer.
   */
  tableOptions?: TableOptions;
  imageOptions?: UrlSafetyOptions;
  /**
   * Enable built-in syntax highlighting for code blocks.
   * Pass `true` to use the built-in tokenizer, or a custom highlighter function.
   */
  highlightCode?: boolean | CodeHighlighter;
  /**
   * Localized text shown when parsing fails.
   * @default "Error parsing markdown"
   */
  errorText?: string;
  /**
   * Renders adjacent flowing blocks (paragraphs, headings, lists,
   * blockquotes) as selectable runs: a reader can select and copy across all
   * blocks of a run in one gesture. Selection stops at standalone blocks
   * (tables, fenced code blocks, and whatever `classifyBlock` adds).
   * Mutually exclusive with virtualization — recycled cells cannot hold a
   * continuous selection — so virtualized renders ignore this flag.
   */
  selectable?: boolean;
  /**
   * Consumer classification of top-level blocks. Return "standalone" to
   * register additional standalone blocks, or undefined to defer to the
   * default (tables, fenced code blocks, images, math and HTML blocks are
   * standalone, because each renders a view).
   *
   * Read during render, so give it a stable identity (module scope, or
   * `useCallback`): a new function each render re-runs run assembly and
   * re-renders every block.
   */
  classifyBlock?: ClassifyBlock;
  /**
   * Receives the markdown source for exactly the range the reader selected
   * when they pick "Copy as Markdown". The consumer owns the clipboard.
   *
   * Requires a native `runHost`: the default host is the platform's own
   * selectable text component, which reports no selection range and has no
   * Copy as Markdown menu item on either platform, so this never fires
   * without one. Development builds warn when it is set without a host.
   *
   * Safe to pass as an inline arrow — it is read on the gesture, not during
   * render.
   */
  onCopyAsMarkdown?: (markdown: string) => void;
  /**
   * The injectable inline text primitive everything inside a run renders
   * through. Defaults to the plain React Native text component. Define it at
   * module scope: a component identity that changes remounts every span.
   */
  textPrimitive?: ComponentType<RunTextProps>;
  /**
   * The selectable host a run renders into. Defaults to the platform's own
   * selectable text component, which offers selection and plain-text copy on
   * Android and whole-text selection on iOS. Range selection and the Copy as
   * Markdown menu action come from a native host. Define it at module scope.
   */
  runHost?: ComponentType<SelectableRunHostProps>;
  /**
   * Applies typographic punctuation (curly quotes, en/em dashes, ellipses)
   * to rendered text. Implemented as a transform over parsed text content —
   * never as a pre-parse plugin, which would disable incremental AST reuse.
   */
  smartPunctuation?: boolean;
};

export const Markdown: FC<MarkdownProps> = ({
  children,
  options,
  plugins,
  sourceAst,
  parseCache = true,
  astTransform,
  renderers = EMPTY_RENDERERS,
  theme: userTheme,
  styles: nodeStyles,
  stylingStrategy = "opinionated",
  style,
  onParsingInProgress,
  onParseComplete,
  onLinkPress,
  onError,
  virtualize = false,
  virtualizationMinBlocks = 40,
  virtualization,
  tableOptions,
  imageOptions,
  highlightCode,
  errorText = "Error parsing markdown",
  selectable = false,
  classifyBlock,
  onCopyAsMarkdown,
  textPrimitive,
  runHost,
  smartPunctuation = false,
}) => {
  const parserOptionGfm = options?.gfm;
  const parserOptionMath = options?.math;
  const parserOptionHtml = options?.html;
  const parserOptionSourceOffsets = options?.sourceOffsets;
  const parserOptionMaxInputLength = options?.maxInputLength;

  /* eslint-disable react-hooks/refs -- Refs updated/read intentionally to avoid re-parsing on callback identity changes */
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Gesture callbacks are read when the gesture happens, never during render,
  // so they go through refs behind a stable identity. An inline arrow in a
  // consumer's JSX would otherwise rebuild the context value on every render
  // and re-render every node of the document — on each streamed chunk, which
  // is exactly the cost the run memoization boundary exists to avoid.
  const onCopyAsMarkdownRef = useRef(onCopyAsMarkdown);
  onCopyAsMarkdownRef.current = onCopyAsMarkdown;
  const onLinkPressRef = useRef(onLinkPress);
  onLinkPressRef.current = onLinkPress;

  // The tree the previous render committed, so an unchanged block keeps its
  // node identity across parses and the renderer memo can bail out on it.
  const previousAstRef = useRef<MarkdownNode | null>(null);

  const parseAstCacheRef = useRef<Map<string, ParseAstCacheEntry> | null>(null);
  const cacheStatsRef = useRef({ hits: 0, misses: 0, evictions: 0 });
  if (parseAstCacheRef.current === null) {
    parseAstCacheRef.current = new Map();
    cacheStatsRef.current = { hits: 0, misses: 0, evictions: 0 };
  }

  const parseResult = useMemo(() => {
    try {
      const sortedPlugins = sortPluginsByPriority(plugins);
      const markdownToParse = sourceAst
        ? children
        : applyBeforeParsePlugins(children, sortedPlugins, onErrorRef.current);
      const parserOptions = normalizeParserOptions(
        Object.assign(
          {},
          parserOptionGfm === undefined ? null : { gfm: parserOptionGfm },
          parserOptionMath === undefined ? null : { math: parserOptionMath },
          parserOptionHtml === undefined ? null : { html: parserOptionHtml },
          parserOptionSourceOffsets === undefined
            ? null
            : { sourceOffsets: parserOptionSourceOffsets },
          parserOptionMaxInputLength === undefined
            ? null
            : { maxInputLength: parserOptionMaxInputLength },
        ),
      );
      const shouldCloneSourceAst =
        sourceAst &&
        (Boolean(astTransform) ||
          sortedPlugins?.some((plugin) => plugin.afterParse) === true);
      let parsedAst = sourceAst
        ? shouldCloneSourceAst
          ? cloneMarkdownNode(sourceAst)
          : sourceAst
        : parseCache
          ? getCachedParsedAst(
              markdownToParse,
              parserOptions,
              parseAstCacheRef.current!,
              cacheStatsRef.current,
            )
          : parseWithNativeParser(markdownToParse, parserOptions);
      parsedAst = applyAfterParsePlugins(
        parsedAst,
        sortedPlugins,
        onErrorRef.current,
      );

      let ast = parsedAst;
      if (astTransform) {
        try {
          const nextAst = astTransform(parsedAst);
          if (isMarkdownNode(nextAst)) {
            ast = nextAst;
          }
        } catch (error) {
          warnInDev(
            "[react-native-nitro-markdown] astTransform threw; falling back to parsed AST.",
            error,
          );
          ast = parsedAst;
        }
      }

      // Reuse the identity of every node the parse left untouched. Without
      // this the documented "a streamed append re-renders only the still
      // growing tail run" holds only for consumers who hand-wire `sourceAst`:
      // a plain re-parse (and even a parse-cache hit, which clones) hands back
      // all-new objects, so every memo boundary in the document misses.
      const previousAst = previousAstRef.current;
      const stableAst = previousAst ? reuseStableAstNodes(previousAst, ast) : ast;
      previousAstRef.current = stableAst;

      return {
        ast: stableAst,
        sourceText: markdownToParse,
      };
    } catch (parseError) {
      safeOnError(onErrorRef.current, parseError, ERROR_PHASE.PARSE);
      return {
        ast: null,
        sourceText: children,
      };
    }
  }, [
    children,
    parserOptionGfm,
    parserOptionMath,
    parserOptionHtml,
    parserOptionSourceOffsets,
    parserOptionMaxInputLength,
    sourceAst,
    parseCache,
    astTransform,
    plugins,
  ]);
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    onParsingInProgress?.();
  }, [
    children,
    parserOptionGfm,
    parserOptionMath,
    parserOptionHtml,
    parserOptionSourceOffsets,
    parserOptionMaxInputLength,
    onParsingInProgress,
  ]);

  useEffect(() => {
    if (!parseResult.ast || !onParseComplete) return;

    const cacheStats: ParseCacheStats = parseCache
      ? {
          hits: cacheStatsRef.current.hits,
          misses: cacheStatsRef.current.misses,
          evictions: cacheStatsRef.current.evictions,
          size: parseAstCacheRef.current?.size ?? 0,
        }
      : {
          hits: 0,
          misses: 0,
          evictions: 0,
          size: 0,
        };

    onParseComplete({
      raw: children,
      ast: parseResult.ast,
      text: getFlattenedText(parseResult.ast),
      ...(parseCache ? { cacheStats } : {}),
    });
    // Keyed on the parse result object, not on `parseResult.ast`: an unchanged
    // document now keeps its node identity across a parse cycle, so the tree
    // alone can no longer tell one cycle from the next.
  }, [parseResult, onParseComplete, children, parseCache]);

  const theme = useMemo(() => {
    const base =
      stylingStrategy === "minimal"
        ? minimalMarkdownTheme
        : defaultMarkdownTheme;
    return mergeThemes(base, userTheme);
  }, [userTheme, stylingStrategy]);

  const baseStyles = getBaseStyles(theme);

  /* eslint-disable react-hooks/refs -- latest source is read on copy gestures only; going through state would re-render settled runs on every streamed chunk */
  // The text the parse offsets actually index — the before-parse plugins have
  // already run against it. Handing out the untransformed `children` here
  // would make Copy as Markdown slice at displaced offsets the moment a plugin
  // changes the source's length.
  const sourceTextRef = useRef(parseResult.sourceText);
  sourceTextRef.current = parseResult.sourceText;
  const getSourceText = useCallback(() => sourceTextRef.current, []);

  const handleCopyAsMarkdown = useCallback((markdown: string) => {
    onCopyAsMarkdownRef.current?.(markdown);
  }, []);
  const handleLinkPress = useCallback<LinkPressHandler>(
    (href) => onLinkPressRef.current?.(href),
    [],
  );
  /* eslint-enable react-hooks/refs */

  const contextValue = useMemo<MarkdownContextValue>(
    () => ({
      renderers,
      theme,
      stylingStrategy,
      onLinkPress: handleLinkPress,
      onCopyAsMarkdown: handleCopyAsMarkdown,
      ...(nodeStyles ? { styles: nodeStyles } : {}),
      ...(tableOptions ? { tableOptions } : {}),
      ...(imageOptions ? { imageOptions } : {}),
      ...(highlightCode === undefined ? {} : { highlightCode }),
      ...(selectable ? { selectable } : {}),
      ...(classifyBlock ? { classifyBlock } : {}),
      ...(textPrimitive ? { textPrimitive } : {}),
      ...(runHost ? { runHost } : {}),
      ...(smartPunctuation ? { smartPunctuation } : {}),
    }),
    [
      renderers,
      theme,
      nodeStyles,
      stylingStrategy,
      handleLinkPress,
      handleCopyAsMarkdown,
      tableOptions,
      imageOptions,
      highlightCode,
      selectable,
      classifyBlock,
      textPrimitive,
      runHost,
      smartPunctuation,
    ],
  );

  const topLevelBlocks =
    parseResult.ast?.type === "document"
      ? (parseResult.ast.children ?? [])
      : parseResult.ast
        ? [parseResult.ast]
        : [];
  const shouldVirtualizeBySetting =
    virtualize === true ||
    (virtualize === "auto" && topLevelBlocks.length >= virtualizationMinBlocks);
  const shouldVirtualize =
    parseResult.ast !== null && shouldVirtualizeBySetting;

  if (__DEV__ && selectable && shouldVirtualize) {
    console.warn(
      "[NitroMarkdown] selectable and virtualization are mutually exclusive: " +
        "recycled cells cannot hold a continuous selection. This render is " +
        "virtualized, so selection stays per block. Choose one per surface.",
    );
  }

  // Copy as Markdown fails silently in two ways, and a consumer sees the same
  // nothing from both: no runs to select in, or no host that can report what
  // was selected.
  const hasCopyHandler = onCopyAsMarkdown !== undefined;
  const hasCustomRunHost = runHost !== undefined;
  useEffect(() => {
    if (!__DEV__ || !hasCopyHandler) return;
    if (!selectable) {
      console.warn(
        "[NitroMarkdown] onCopyAsMarkdown is set but selectable is not, so " +
          "there are no runs to select across and the callback never fires.",
      );
      return;
    }
    if (hasCustomRunHost) return;
    console.warn(
      "[NitroMarkdown] onCopyAsMarkdown will never fire with the default run " +
        "host: the platform's selectable text component reports no selection " +
        "range and has no Copy as Markdown menu item, on either platform. " +
        "Supply a native host through the runHost prop — see " +
        "docs/selectable-runs.md, host contract.",
    );
  }, [hasCopyHandler, hasCustomRunHost, selectable]);

  const keyExtractor = useCallback((node: MarkdownNode, index: number) => {
    const beg = typeof node.beg === "number" ? node.beg : index;
    const end = typeof node.end === "number" ? node.end : index;
    return `${node.type}:${beg}:${end}:${index}`;
  }, []);

  const renderVirtualizedItem = useCallback(
    ({ item }: ListRenderItemInfo<MarkdownNode>): ReactElement => (
      <NodeRenderer node={item} depth={0} inListItem={false} />
    ),
    [],
  );

  if (!parseResult.ast) {
    return (
      <View style={[baseStyles.container, style]}>
        <Text style={baseStyles.errorText}>{errorText}</Text>
      </View>
    );
  }

  return (
    <MarkdownContext.Provider value={contextValue}>
      <RunSourceContext.Provider value={getSourceText}>
      <View style={[baseStyles.container, style]}>
        {shouldVirtualize ? (
          <FlatList
            data={topLevelBlocks}
            renderItem={renderVirtualizedItem}
            keyExtractor={keyExtractor}
            style={baseStyles.virtualizedList}
            initialNumToRender={virtualization?.initialNumToRender ?? 12}
            maxToRenderPerBatch={virtualization?.maxToRenderPerBatch ?? 12}
            windowSize={virtualization?.windowSize ?? 10}
            updateCellsBatchingPeriod={
              virtualization?.updateCellsBatchingPeriod ?? 16
            }
            removeClippedSubviews={
              virtualization?.removeClippedSubviews ?? Platform.OS === "android"
            }
            bounces={false}
            alwaysBounceVertical={false}
            overScrollMode="never"
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <NodeRenderer node={parseResult.ast} depth={0} inListItem={false} />
        )}
      </View>
      </RunSourceContext.Provider>
    </MarkdownContext.Provider>
  );
};
