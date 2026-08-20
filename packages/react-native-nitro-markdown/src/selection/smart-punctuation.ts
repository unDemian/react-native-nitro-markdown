/**
 * Typographic punctuation for rendered text, matching the behaviour of a
 * markdown-it "typographer" pass: curly quotes, en/em dashes and ellipses.
 *
 * This is deliberately a transform over parsed text content — it must never
 * be implemented as a pre-parse plugin, because registering one disables
 * incremental AST reuse and turns every streamed token into a full re-parse.
 *
 * Quote substitution is one-to-one in length, so source-offset mapping stays
 * exact through it. Dash and ellipsis substitution shortens the text; range
 * mapping detects the length change and snaps to node boundaries there.
 *
 * A text node is only a fragment of the prose a reader sees: inline markup
 * splits `She said "**yes**"` into three nodes, and the closing quote starts
 * its own node. Callers therefore pass the character rendered immediately
 * before the node so a quote at position 0 curls the right way.
 */

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char);

const opensQuote = (previous: string | undefined): boolean =>
  previous === undefined || /[\s([{‘“'"<«‹—–-]/.test(previous);

/**
 * The character a reader sees immediately before `text`, or undefined when
 * `text` starts the block. Feeding this back in is what keeps quote direction
 * correct across node boundaries.
 */
export const trailingSmartChar = (text: string): string | undefined =>
  text.length > 0 ? text[text.length - 1] : undefined;

export const smartenText = (
  text: string,
  precedingChar?: string | undefined,
): string => {
  if (!/["'.\-]/.test(text)) return text;

  // Dash rules are markdown-it's, verbatim: an en dash needs whitespace on
  // both sides or word characters on both sides. A bare negative lookahead
  // would eat CLI flags — "run it with --verbose" must stay hyphenated.
  const smartened = text
    .replace(/\.{3}/g, "…")
    .replace(/(^|[^-])---(?=[^-]|$)/gm, "$1—")
    .replace(/(^|\s)--(?=\s|$)/gm, "$1–")
    .replace(/(^|[^-\s])--(?=[^-\s]|$)/gm, "$1–");

  let result = "";
  for (let index = 0; index < smartened.length; index += 1) {
    const char = smartened[index] as string;
    const previous = index === 0 ? precedingChar : smartened[index - 1];
    if (char === '"') {
      result += opensQuote(previous) ? "“" : "”";
      continue;
    }
    if (char === "'") {
      const next = smartened[index + 1];
      if (isWordChar(previous) && isWordChar(next)) {
        result += "’"; // apostrophe
      } else if (opensQuote(previous)) {
        result += "‘";
      } else {
        result += "’";
      }
      continue;
    }
    result += char;
  }
  return result;
};
