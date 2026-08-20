import type { MarkdownNode } from "../headless";
import { classifyBlock, type ClassifyBlock } from "./classification";

/**
 * One piece of a document as a reader perceives it: either a run — a maximal
 * sequence of adjacent flowing blocks that selection can span — or a single
 * standalone block that selection stops at.
 *
 * Keys are derived from the source offset of the part's first block, never
 * from its index: block counts change mid-stream, so index keys would
 * reshuffle and force remounts of settled runs.
 */
export type RunPart =
  | { kind: "run"; key: string; blocks: MarkdownNode[] }
  | { kind: "standalone"; key: string; block: MarkdownNode };

const partKey = (
  kind: RunPart["kind"],
  firstBlock: MarkdownNode,
  index: number,
): string => {
  if (typeof firstBlock.beg === "number") {
    return `${kind}:${firstBlock.beg}`;
  }
  if (__DEV__) {
    console.warn(
      "[NitroMarkdown] assembleRuns: block has no source offset; " +
        "falling back to an index key. Parse with sourceOffsets enabled — " +
        "index keys remount settled runs while streaming.",
    );
  }
  return `${kind}@${index}`;
};

export const assembleRuns = (
  blocks: readonly MarkdownNode[],
  classify?: ClassifyBlock,
): RunPart[] => {
  const parts: RunPart[] = [];
  let currentRun: MarkdownNode[] = [];

  const flushRun = (index: number) => {
    const firstBlock = currentRun[0];
    if (firstBlock === undefined) return;
    parts.push({
      kind: "run",
      key: partKey("run", firstBlock, index - currentRun.length),
      blocks: currentRun,
    });
    currentRun = [];
  };

  blocks.forEach((blockNode, index) => {
    if (classifyBlock(blockNode, classify) === "standalone") {
      flushRun(index);
      parts.push({
        kind: "standalone",
        key: partKey("standalone", blockNode, index),
        block: blockNode,
      });
      return;
    }
    currentRun.push(blockNode);
  });

  flushRun(blocks.length);
  return parts;
};
