import type { MarkdownNode } from "../headless";

/**
 * How a top-level block participates in selection.
 *
 * - "flowing": the block may merge with its neighbours into a single run,
 *   so a selection extends through it (paragraphs, headings, lists,
 *   blockquotes, horizontal rules).
 * - "standalone": the block cannot live inside a run's text tree — either it
 *   owns a gesture that would fight the selection gesture (horizontal
 *   scrolling, its own tap target), or it renders a view, and a view nested in
 *   text is positioned via placeholder spans on Android, where selection
 *   degrades across it. It terminates the run before it and a new run begins
 *   after it.
 */
export type BlockClass = "flowing" | "standalone";

/**
 * Consumer-supplied classification. Return a class to claim the block, or
 * `undefined` to fall back to the default classification. This is how an app
 * registers its own standalone blocks (e.g. a copy action rendered from a
 * marker node) without changing the library.
 */
export type ClassifyBlock = (node: MarkdownNode) => BlockClass | undefined;

/**
 * Every node type whose built-in renderer emits a view. This set must stay in
 * step with the renderers: a type that renders a view and is missing here ends
 * up nested inside the run's text host, which is exactly what the run design
 * exists to prevent. Inline types belong here too (`math_inline`, `image`) —
 * `containsStandalone` walks the tree, so a paragraph carrying one is itself
 * standalone and keeps the dedicated renderers' layout path.
 */
const DEFAULT_STANDALONE_TYPES: ReadonlySet<MarkdownNode["type"]> = new Set([
  "table",
  "code_block",
  "image",
  "math_inline",
  "math_block",
  "html_block",
]);

const ownClass = (
  node: MarkdownNode,
  classify?: ClassifyBlock,
): BlockClass | undefined => {
  const consumerClass = classify?.(node);
  if (consumerClass !== undefined) return consumerClass;
  return DEFAULT_STANDALONE_TYPES.has(node.type) ? "standalone" : undefined;
};

const containsStandalone = (
  node: MarkdownNode,
  classify?: ClassifyBlock,
): boolean =>
  ownClass(node, classify) === "standalone" ||
  (node.children?.some((child) => containsStandalone(child, classify)) ??
    false);

export const classifyBlock = (
  node: MarkdownNode,
  classify?: ClassifyBlock,
): BlockClass => {
  const blockClass = ownClass(node, classify);
  if (blockClass !== undefined) return blockClass;
  // A flowing block carrying a standalone block inside (a code block nested
  // in a list item, say) cannot merge either: a run is one text tree, and the
  // nested block must keep its own view renderer and gestures. The whole
  // block stays standalone — the boundary is visible, the nested block is on
  // screen.
  if (node.children?.some((child) => containsStandalone(child, classify))) {
    return "standalone";
  }
  return "flowing";
};
