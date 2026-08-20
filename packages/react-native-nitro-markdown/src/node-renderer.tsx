import {
  memo,
  type FC,
  Fragment,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  StyleSheet,
  Text,
  View,
  Platform,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { getTextContent, type MarkdownNode } from "./headless";
import {
  useMarkdownContext,
  type CustomRenderer,
  type NodeRendererProps,
} from "./MarkdownContext";
import { Blockquote } from "./renderers/blockquote";
import { useInRunFlow } from "./selection/run-flow-context";
import {
  getRunFlowStyles,
  toRunFlowTextStyle,
} from "./selection/run-flow-styles";
import { RunText, sourceRangeOf } from "./selection/run-text";
import { RunDocument } from "./selection/run-view";
import {
  smartenText,
  trailingSmartChar,
} from "./selection/smart-punctuation";
import { CodeBlock, InlineCode } from "./renderers/code";
import { Heading } from "./renderers/heading";
import { HorizontalRule } from "./renderers/horizontal-rule";
import { HtmlBlock, HtmlInline } from "./renderers/html";
import { Image } from "./renderers/image";
import { Link } from "./renderers/link";
import { List, ListItem, TaskListItem } from "./renderers/list";
import { MathInline, MathBlock } from "./renderers/math";
import { Paragraph } from "./renderers/paragraph";
import { TableRenderer } from "./renderers/table";
import type { MarkdownTheme } from "./theme";

const isInline = (type: MarkdownNode["type"]): boolean => {
  return (
    type === "text" ||
    type === "bold" ||
    type === "italic" ||
    type === "strikethrough" ||
    type === "link" ||
    type === "code_inline" ||
    type === "soft_break" ||
    type === "line_break" ||
    type === "html_inline" ||
    type === "math_inline"
  );
};

const containsInlineMath = (nodes?: MarkdownNode[]): boolean =>
  nodes?.some(
    (node) => node.type === "math_inline" || containsInlineMath(node.children),
  ) ?? false;

/**
 * The text a reader sees between two block children of the same container
 * inside a run. A nested list continues its parent item's line rather than
 * starting a new paragraph, so it takes a single break; everything else takes
 * the blank line that separates blocks in markdown.
 */
const blockSeparatorBefore = (node: MarkdownNode): string =>
  node.type === "list" ? "\n" : "\n\n";

/**
 * A list descends two renderer levels per level of nesting (list → list_item →
 * list), so raw depth grows twice as fast as the indent a reader expects.
 */
const runListIndentDepth = (depth: number): number =>
  Math.max(0, Math.floor((depth - 1) / 2));

/**
 * The character a reader sees at the end of what `node` renders, given the
 * character immediately before it.
 *
 * Smart punctuation runs per text node, but a text node is only a fragment of
 * the prose: `She said "**yes**"` splits into three nodes and the closing
 * quote starts its own. Threading the trailing character across siblings is
 * what lets that quote curl closed.
 */
const smartTrailingChar = (
  node: MarkdownNode,
  precedingChar: string | undefined,
): string | undefined => {
  switch (node.type) {
    case "text":
      return (
        trailingSmartChar(smartenText(node.content ?? "", precedingChar)) ??
        precedingChar
      );
    case "code_inline":
    case "html_inline":
      return trailingSmartChar(node.content ?? "") ?? precedingChar;
    case "soft_break":
      return " ";
    case "line_break":
      return "\n";
    case "image":
    case "math_inline":
    case "math_block":
      // Renders something that is not prose, so the next quote opens.
      return undefined;
    default: {
      const children = node.children;
      if (!children || children.length === 0) return undefined;
      let current = precedingChar;
      for (const child of children) {
        current = smartTrailingChar(child, current);
      }
      return current;
    }
  }
};

const NodeRendererComponent: FC<NodeRendererProps> = ({
  node,
  depth,
  inListItem,
  parentIsText = false,
  precedingChar,
}) => {
  const {
    renderers,
    theme,
    styles: nodeStyles,
    selectable,
    smartPunctuation,
    textPrimitive,
  } = useMarkdownContext();
  const baseStyles = getBaseStyles(theme);
  const inRunFlow = useInRunFlow();
  const Primitive = textPrimitive ?? RunText;

  const renderChildren = (
    children?: MarkdownNode[],
    childInListItem = false,
    childParentIsText = false,
  ): ReactNode => {
    if (!children || children.length === 0) return null;

    const elements: ReactNode[] = [];
    type InlineEntry = { node: MarkdownNode; before: string | undefined };
    let currentInlineGroup: InlineEntry[] = [];
    // The character a reader sees before the child about to be rendered. Only
    // tracked when smart punctuation is on; otherwise it stays undefined and
    // never perturbs the renderer memo.
    let runningChar = smartPunctuation ? precedingChar : undefined;

    const flushInlineGroup = () => {
      if (currentInlineGroup.length > 0) {
        const hasMath = currentInlineGroup.some(
          (entry) => entry.node.type === "math_inline",
        );

        if (hasMath && !childParentIsText) {
          elements.push(
            <View
              key={`inline-group-${elements.length}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexWrap: "wrap",
                flexShrink: 1,
              }}
            >
              {currentInlineGroup.map((entry, idx) => (
                <NodeRenderer
                  key={`${entry.node.type}-${idx}`}
                  node={entry.node}
                  depth={depth + 1}
                  inListItem={childInListItem}
                  parentIsText={false}
                  precedingChar={entry.before}
                />
              ))}
            </View>,
          );
        } else {
          // The inline group wrapper is the injectable text primitive — the
          // one wrapper custom renderers could never override upstream.
          const Wrapper = childParentIsText ? Fragment : Primitive;
          const wrapperProps = childParentIsText
            ? {}
            : { style: baseStyles.text };

          elements.push(
            <Wrapper key={`inline-group-${elements.length}`} {...wrapperProps}>
              {currentInlineGroup.map((entry, idx) => (
                <NodeRenderer
                  key={`${entry.node.type}-${idx}`}
                  node={entry.node}
                  depth={depth + 1}
                  inListItem={childInListItem}
                  parentIsText={true}
                  precedingChar={entry.before}
                />
              ))}
            </Wrapper>,
          );
        }
        currentInlineGroup = [];
      }
    };

    children.forEach((child, index) => {
      if (isInline(child.type)) {
        currentInlineGroup.push({ node: child, before: runningChar });
      } else {
        flushInlineGroup();
        // Inside a run every block collapses into the same span tree, so the
        // blank line markdown puts between blocks has to be rendered. Without
        // it a two-paragraph blockquote reads as one glued line, and a nested
        // list runs into its parent item's text.
        if (inRunFlow && elements.length > 0) {
          elements.push(
            <Primitive key={`block-separator-${index}`}>
              {blockSeparatorBefore(child)}
            </Primitive>,
          );
        }
        elements.push(
          <NodeRenderer
            key={`${child.type}-${index}`}
            node={child}
            depth={depth + 1}
            inListItem={childInListItem}
            parentIsText={childParentIsText}
            precedingChar={runningChar}
          />,
        );
      }
      if (smartPunctuation) {
        runningChar = smartTrailingChar(child, runningChar);
      }
    });

    flushInlineGroup();
    return elements;
  };

  const customRenderer = renderers[node.type] as CustomRenderer | undefined;
  if (customRenderer) {
    const childrenRendered = renderChildren(
      node.children,
      inListItem,
      parentIsText,
    );

    const baseProps = {
      node,
      children: childrenRendered,
      Renderer: NodeRenderer,
    };

    const enhancedProps = {
      ...baseProps,
      ...(node.type === "heading" && {
        level: (node.level ?? 1) as 1 | 2 | 3 | 4 | 5 | 6,
      }),
      ...(node.type === "link" && {
        href: node.href ?? "",
        ...(node.title ? { title: node.title } : {}),
      }),
      ...(node.type === "image" && {
        url: node.href ?? "",
        ...(node.alt ? { alt: node.alt } : {}),
        ...(node.title ? { title: node.title } : {}),
      }),
      ...(node.type === "code_block" && {
        content: getTextContent(node),
        ...(node.language ? { language: node.language } : {}),
      }),
      ...(node.type === "code_inline" && { content: node.content ?? "" }),
      ...((node.type === "math_inline" || node.type === "math_block") && {
        content: getTextContent(node),
      }),
      ...(node.type === "list" && {
        ordered: node.ordered ?? false,
        ...(node.start === undefined ? {} : { start: node.start }),
      }),
      ...(node.type === "task_list_item" && { checked: node.checked ?? false }),
    };

    const result = customRenderer(enhancedProps);
    if (result !== undefined) {
      return result as ReactElement | null;
    }
  }

  switch (node.type) {
    case "document":
      if (selectable) {
        return (
          <View style={[baseStyles.document, nodeStyles?.document]}>
            <RunDocument blocks={node.children ?? []} Renderer={NodeRenderer} />
          </View>
        );
      }
      return (
        <View style={[baseStyles.document, nodeStyles?.document]}>
          {renderChildren(node.children, false, false)}
        </View>
      );

    case "heading": {
      if (inRunFlow) {
        const level = (node.level ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
        return (
          <Primitive
            sourceRange={sourceRangeOf(node)}
            style={[getRunFlowStyles(theme).heading[level], nodeStyles?.heading]}
            accessibilityRole="header"
          >
            {renderChildren(node.children, inListItem, true)}
          </Primitive>
        );
      }
      return (
        <Heading
          level={node.level ?? 1}
          {...(nodeStyles?.heading ? { style: nodeStyles.heading } : {})}
        >
          {renderChildren(node.children, inListItem, true)}
        </Heading>
      );
    }

    case "paragraph":
      if (inRunFlow) {
        // No base text style here: the run host already paints it. Repeating
        // it would make the innermost span win and a paragraph inside a
        // blockquote would lose the quote's muted colour.
        return (
          <Primitive
            sourceRange={sourceRangeOf(node)}
            style={toRunFlowTextStyle(nodeStyles?.paragraph, "paragraph")}
          >
            {renderChildren(node.children, inListItem, true)}
          </Primitive>
        );
      }
      if (containsInlineMath(node.children)) {
        return (
          <Paragraph inListItem={inListItem} style={nodeStyles?.paragraph}>
            {renderChildren(node.children, inListItem, false)}
          </Paragraph>
        );
      }
      return (
        <Text
          style={[
            baseStyles.text,
            inListItem ? undefined : { marginBottom: theme.spacing.l },
            nodeStyles?.paragraph as StyleProp<TextStyle>,
          ]}
        >
          {renderChildren(node.children, inListItem, true)}
        </Text>
      );

    case "text": {
      const textContent =
        smartPunctuation && node.content
          ? smartenText(node.content, precedingChar)
          : node.content;
      if (inRunFlow) {
        return (
          <Primitive
            sourceRange={sourceRangeOf(node)}
            style={parentIsText ? undefined : [baseStyles.text, nodeStyles?.text]}
          >
            {textContent}
          </Primitive>
        );
      }
      if (parentIsText) {
        return <Text>{textContent}</Text>;
      }
      return (
        <Text style={[baseStyles.text, nodeStyles?.text]}>{textContent}</Text>
      );
    }

    case "bold":
      if (inRunFlow) {
        return (
          <Primitive
            sourceRange={sourceRangeOf(node)}
            style={[baseStyles.bold, nodeStyles?.bold]}
          >
            {renderChildren(node.children, inListItem, true)}
          </Primitive>
        );
      }
      return (
        <Text style={[baseStyles.bold, nodeStyles?.bold]}>
          {renderChildren(node.children, inListItem, true)}
        </Text>
      );

    case "italic":
      if (inRunFlow) {
        return (
          <Primitive
            sourceRange={sourceRangeOf(node)}
            style={[baseStyles.italic, nodeStyles?.italic]}
          >
            {renderChildren(node.children, inListItem, true)}
          </Primitive>
        );
      }
      return (
        <Text style={[baseStyles.italic, nodeStyles?.italic]}>
          {renderChildren(node.children, inListItem, true)}
        </Text>
      );

    case "strikethrough":
      if (inRunFlow) {
        return (
          <Primitive
            sourceRange={sourceRangeOf(node)}
            style={[baseStyles.strikethrough, nodeStyles?.strikethrough]}
          >
            {renderChildren(node.children, inListItem, true)}
          </Primitive>
        );
      }
      return (
        <Text style={[baseStyles.strikethrough, nodeStyles?.strikethrough]}>
          {renderChildren(node.children, inListItem, true)}
        </Text>
      );

    case "link": {
      const linkElement = (
        <Link
          href={node.href ?? ""}
          {...(nodeStyles?.link ? { style: nodeStyles.link } : {})}
        >
          {renderChildren(node.children, inListItem, true)}
        </Link>
      );
      if (inRunFlow) {
        return (
          <Primitive sourceRange={sourceRangeOf(node)}>{linkElement}</Primitive>
        );
      }
      return linkElement;
    }

    case "image":
      return (
        <Image
          url={node.href ?? ""}
          Renderer={NodeRenderer}
          {...(node.title ? { title: node.title } : {})}
          {...(node.alt ? { alt: node.alt } : {})}
          {...(nodeStyles?.image ? { style: nodeStyles.image } : {})}
        />
      );

    case "code_inline": {
      const inlineCodeElement = (
        <InlineCode
          {...(nodeStyles?.code_inline
            ? { style: nodeStyles.code_inline }
            : {})}
        >
          {node.content}
        </InlineCode>
      );
      if (inRunFlow) {
        return (
          <Primitive sourceRange={sourceRangeOf(node)}>
            {inlineCodeElement}
          </Primitive>
        );
      }
      return inlineCodeElement;
    }

    case "code_block":
      return (
        <CodeBlock
          content={getTextContent(node)}
          {...(node.language ? { language: node.language } : {})}
          {...(nodeStyles?.code_block ? { style: nodeStyles.code_block } : {})}
        />
      );

    case "blockquote":
      if (inRunFlow) {
        return (
          <Primitive
            sourceRange={sourceRangeOf(node)}
            style={[
              getRunFlowStyles(theme).blockquote,
              toRunFlowTextStyle(nodeStyles?.blockquote, "blockquote"),
            ]}
          >
            {renderChildren(node.children, inListItem, true)}
          </Primitive>
        );
      }
      return (
        <Blockquote
          {...(nodeStyles?.blockquote
            ? { style: nodeStyles.blockquote }
            : {})}
        >
          {renderChildren(node.children, inListItem, false)}
        </Blockquote>
      );

    case "horizontal_rule":
      if (inRunFlow) {
        // A rule inside a run is text, not a view: it is the one block whose
        // run presentation a reader can tell apart from the standalone one,
        // and a screen reader reads it out with the rest of the run.
        return (
          <Primitive
            style={[
              getRunFlowStyles(theme).horizontalRule,
              toRunFlowTextStyle(nodeStyles?.horizontal_rule, "horizontal_rule"),
            ]}
          >
            {"———"}
          </Primitive>
        );
      }
      return (
        <HorizontalRule
          {...(nodeStyles?.horizontal_rule
            ? { style: nodeStyles.horizontal_rule }
            : {})}
        />
      );

    case "line_break":
      // Inside a run a break carries its own source range like any other
      // span. Left unannotated it inherits the enclosing paragraph's range,
      // whose length never matches one character, and every selection
      // crossing a line wrap degrades to the whole paragraph.
      if (inRunFlow) {
        return (
          <Primitive sourceRange={sourceRangeOf(node)}>{"\n"}</Primitive>
        );
      }
      return <Text>{"\n"}</Text>;

    case "soft_break":
      if (inRunFlow) {
        return <Primitive sourceRange={sourceRangeOf(node)}> </Primitive>;
      }
      return <Text> </Text>;

    case "math_inline": {
      let mathContent = getTextContent(node);
      if (!mathContent) return null;
      // Native math content excludes the dollar delimiters. Strip them only
      // when a non-native source (e.g. a pre-parsed custom AST) includes them.
      if (mathContent.startsWith("$") || mathContent.endsWith("$")) {
        mathContent = mathContent.replace(/^\$+|\$+$/g, "").trim();
      }
      return (
        <MathInline
          content={mathContent}
          {...(nodeStyles?.math_inline
            ? { style: nodeStyles.math_inline }
            : {})}
        />
      );
    }

    case "math_block":
      return (
        <MathBlock
          content={getTextContent(node)}
          {...(nodeStyles?.math_block ? { style: nodeStyles.math_block } : {})}
        />
      );

    case "html_inline":
      return (
        <HtmlInline
          {...(node.content ? { content: node.content } : {})}
          {...(nodeStyles?.html_inline ? { style: nodeStyles.html_inline } : {})}
        />
      );

    case "html_block":
      return (
        <HtmlBlock
          {...(node.content ? { content: node.content } : {})}
          {...(nodeStyles?.html_block ? { style: nodeStyles.html_block } : {})}
        />
      );

    case "list": {
      if (inRunFlow) {
        const startNumber = node.start ?? 1;
        const indent = "  ".repeat(runListIndentDepth(depth));
        const items: ReactNode[] = [];
        node.children?.forEach((child, index) => {
          const itemKey =
            typeof child.beg === "number" ? `${child.beg}` : `@${index}`;
          if (index > 0) {
            items.push(
              <Primitive key={`line-break:${itemKey}`}>{"\n"}</Primitive>,
            );
          }
          const marker =
            child.type === "task_list_item"
              ? child.checked
                ? "☑ "
                : "☐ "
              : node.ordered
                ? `${startNumber + index}. `
                : "• ";
          items.push(
            <Primitive key={`marker:${itemKey}`}>{indent + marker}</Primitive>,
          );
          items.push(
            <NodeRenderer
              key={`item:${itemKey}`}
              node={child}
              depth={depth + 1}
              inListItem={true}
              parentIsText={true}
            />,
          );
        });
        return <>{items}</>;
      }
      return (
        <List
          ordered={node.ordered ?? false}
          depth={depth}
          {...(node.start === undefined ? {} : { start: node.start })}
          {...(nodeStyles?.list ? { style: nodeStyles.list } : {})}
        >
          {node.children?.map((child, index) => {
            if (child.type === "task_list_item") {
              return (
                <NodeRenderer
                  key={index}
                  node={child}
                  depth={depth + 1}
                  inListItem={true}
                  parentIsText={false}
                />
              );
            }
            return (
              <ListItem
                key={index}
                index={index}
                ordered={node.ordered ?? false}
                start={node.start ?? 1}
              >
                <NodeRenderer
                  node={child}
                  depth={depth + 1}
                  inListItem={true}
                  parentIsText={false}
                />
              </ListItem>
            );
          })}
        </List>
      );
    }

    case "list_item":
      return <>{renderChildren(node.children, true, inRunFlow)}</>;

    case "task_list_item":
      if (inRunFlow) {
        // The list case already rendered the checkbox marker.
        return <>{renderChildren(node.children, true, true)}</>;
      }
      return (
        <TaskListItem
          checked={node.checked ?? false}
          {...(nodeStyles?.task_list_item
            ? { style: nodeStyles.task_list_item }
            : {})}
        >
          {renderChildren(node.children, true, false)}
        </TaskListItem>
      );

    case "table":
      return (
        <TableRenderer
          node={node}
          Renderer={NodeRenderer}
          {...(nodeStyles?.table ? { style: nodeStyles.table } : {})}
        />
      );

    case "table_head":
    case "table_body":
    case "table_row":
    case "table_cell":
      return null;

    default:
      return null;
  }
};

export const NodeRenderer = memo(NodeRendererComponent, (previousProps, nextProps) => {
  return (
    previousProps.node === nextProps.node &&
    previousProps.depth === nextProps.depth &&
    previousProps.inListItem === nextProps.inListItem &&
    previousProps.parentIsText === nextProps.parentIsText &&
    previousProps.precedingChar === nextProps.precedingChar
  );
}) as FC<NodeRendererProps>;

export type BaseStyles = ReturnType<typeof createBaseStyles>;

export const getBaseStyles = (theme: MarkdownTheme): BaseStyles => {
  const cached = baseStylesCache.get(theme);
  if (cached) return cached;

  const created = createBaseStyles(theme);
  baseStylesCache.set(theme, created);
  return created;
};

const baseStylesCache = new WeakMap<MarkdownTheme, BaseStyles>();

export const createBaseStyles = (theme: MarkdownTheme) =>
  StyleSheet.create({
    container: {
      width: "100%",
      maxWidth: "100%",
      flexShrink: 1,
    },
    virtualizedList: {
      flex: 1,
    },
    document: {
      width: "100%",
      maxWidth: "100%",
      flexShrink: 1,
    },
    errorText: {
      color: "#f87171",
      fontSize: 14,
      fontFamily: theme.fontFamilies.mono ?? "monospace",
      ...(Platform.OS === "android" && { includeFontPadding: false }),
    },
    text: {
      color: theme.colors.text,
      fontSize: theme.fontSizes.m,
      lineHeight: theme.fontSizes.m * 1.6,
      fontFamily: theme.fontFamilies.regular,
      ...(Platform.OS === "android" && { includeFontPadding: false }),
    },
    bold: {
      fontWeight: "700",
      ...(Platform.OS === "android" && { includeFontPadding: false }),
    },
    italic: {
      fontStyle: "italic",
      ...(Platform.OS === "android" && { includeFontPadding: false }),
    },
    strikethrough: {
      textDecorationLine: "line-through",
      ...(Platform.OS === "android" && { includeFontPadding: false }),
    },
  });
