import {
  createContext,
  useContext,
  type ReactNode,
  type ComponentType,
} from "react";
import type { MarkdownNode } from "./headless";
import type { ClassifyBlock } from "./selection/classification";
import type { RunTextProps } from "./selection/run-text";
import type { SelectableRunHostProps } from "./selection/selectable-run-host";
import {
  defaultMarkdownTheme,
  type MarkdownTheme,
  type NodeStyleOverrides,
  type StylingStrategy,
} from "./theme";
import type { CodeHighlighter } from "./utils/code-highlight";
import type { UrlSafetyOptions } from "./utils/link-security";

export type NodeRendererProps = {
  node: MarkdownNode;
  depth: number;
  inListItem: boolean;
  parentIsText?: boolean;
  /**
   * The character a reader sees immediately before this node, or undefined at
   * the start of a block. Only smart punctuation reads it — it is how a quote
   * that opens its own text node (`"**yes**"`) knows to curl closed.
   */
  precedingChar?: string | undefined;
};

export type BaseCustomRendererProps = {
  node: MarkdownNode;
  children: ReactNode;
  Renderer: ComponentType<NodeRendererProps>;
};

export type EnhancedRendererProps = {
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  href?: string;
  title?: string;
  url?: string;
  alt?: string;
  content?: string;
  language?: string;
  ordered?: boolean;
  start?: number;
  checked?: boolean;
} & BaseCustomRendererProps;

export type HeadingRendererProps = {
  level: 1 | 2 | 3 | 4 | 5 | 6;
} & BaseCustomRendererProps;

export type LinkRendererProps = {
  href: string;
  title?: string;
} & BaseCustomRendererProps;

export type ImageRendererProps = {
  url: string;
  alt?: string;
  title?: string;
} & BaseCustomRendererProps;

export type CodeBlockRendererProps = {
  content: string;
  language?: string;
} & BaseCustomRendererProps;

export type InlineCodeRendererProps = {
  content: string;
} & BaseCustomRendererProps;

export type ListRendererProps = {
  ordered: boolean;
  start?: number;
} & BaseCustomRendererProps;

export type TaskListItemRendererProps = {
  checked: boolean;
} & BaseCustomRendererProps;

export type MathRendererProps = {
  content: string;
} & BaseCustomRendererProps;

export type CustomRendererProps = EnhancedRendererProps;

export type LinkPressHandler = (
  href: string,
) => void | boolean | Promise<void | boolean>;

export type CustomRenderer<
  Props extends EnhancedRendererProps = EnhancedRendererProps,
> = (props: Props) => ReactNode | undefined;

export type CustomRendererPropsByNode = {
  document: CustomRendererProps;
  heading: HeadingRendererProps;
  paragraph: CustomRendererProps;
  text: CustomRendererProps;
  bold: CustomRendererProps;
  italic: CustomRendererProps;
  strikethrough: CustomRendererProps;
  link: LinkRendererProps;
  image: ImageRendererProps;
  code_inline: InlineCodeRendererProps;
  code_block: CodeBlockRendererProps;
  blockquote: CustomRendererProps;
  horizontal_rule: CustomRendererProps;
  line_break: CustomRendererProps;
  soft_break: CustomRendererProps;
  table: CustomRendererProps;
  table_head: CustomRendererProps;
  table_body: CustomRendererProps;
  table_row: CustomRendererProps;
  table_cell: CustomRendererProps;
  list: ListRendererProps;
  list_item: CustomRendererProps;
  task_list_item: TaskListItemRendererProps;
  math_inline: MathRendererProps;
  math_block: MathRendererProps;
  html_block: CustomRendererProps;
  html_inline: CustomRendererProps;
};

export type CustomRenderers = Partial<{
  [Type in MarkdownNode["type"]]: CustomRenderer<
    CustomRendererPropsByNode[Type]
  >;
}>;

export type MarkdownRenderers = CustomRenderers;

export type TableOptions = {
  minColumnWidth?: number;
  measurementStabilizeMs?: number;
};

export type MarkdownContextValue = {
  renderers: CustomRenderers;
  theme: MarkdownTheme;
  styles?: NodeStyleOverrides;
  stylingStrategy: StylingStrategy;
  onLinkPress?: LinkPressHandler;
  highlightCode?: boolean | CodeHighlighter;
  tableOptions?: TableOptions;
  imageOptions?: UrlSafetyOptions;
  /** Renders top-level blocks as selectable runs. */
  selectable?: boolean;
  /** Consumer classification of blocks into flowing/standalone. */
  classifyBlock?: ClassifyBlock;
  /** Receives the markdown source for the range the reader selected. */
  onCopyAsMarkdown?: (markdown: string) => void;
  /** The injectable inline text primitive; defaults to RunText. */
  textPrimitive?: ComponentType<RunTextProps>;
  /** The selectable host a run renders into; defaults per platform. */
  runHost?: ComponentType<SelectableRunHostProps>;
  /** Applies typographic quotes/dashes/ellipses to rendered text. */
  smartPunctuation?: boolean;
};

export const MarkdownContext = createContext<MarkdownContextValue>({
  renderers: {},
  theme: defaultMarkdownTheme,
  stylingStrategy: "opinionated",
});

export const useMarkdownContext = () => useContext(MarkdownContext);
