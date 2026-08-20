import { useMemo, useRef } from "react";
import type { MarkdownNode } from "./headless";
import type { ParserOptions } from "./Markdown.nitro";
import { getNextStreamAst, parseMarkdownAst } from "./utils/incremental-ast";

/**
 * Parses a growing markdown string while preserving the identity of AST
 * nodes whose content did not change — the contract selectable-run
 * memoization is built on. Feed the result to `<Markdown sourceAst={…}>`:
 * settled runs then skip re-rendering on every streamed chunk, without
 * needing a native `MarkdownSession`.
 *
 * `options` must be referentially stable (a module constant); a changed
 * options object re-parses from scratch. Returns null when parsing fails —
 * pass nothing to `sourceAst` in that case and let `<Markdown>` surface the
 * error itself.
 */
export function useIncrementalMarkdownAst(
  text: string,
  options?: ParserOptions,
): MarkdownNode | null {
  /* eslint-disable react-hooks/refs -- the previous parse is a cache keyed by the memo below, never a render input on its own; state would re-render every consumer twice per chunk */
  const previousRef = useRef<{ text: string; ast: MarkdownNode } | null>(null);

  return useMemo(() => {
    try {
      const previous = previousRef.current;
      const ast =
        previous == null
          ? parseMarkdownAst(text, options)
          : getNextStreamAst({
              nextText: text,
              previousAst: previous.ast,
              previousText: previous.text,
              ...(options ? { options } : {}),
            });
      previousRef.current = { text, ast };
      return ast;
    } catch {
      previousRef.current = null;
      return null;
    }
  }, [text, options]);
  /* eslint-enable react-hooks/refs */
}
