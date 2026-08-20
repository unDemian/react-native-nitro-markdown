import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import { getHeadingWeight } from "../renderers/heading";
import { getCachedStyles } from "../renderers/style-cache";
import type { MarkdownTheme } from "../theme";

/**
 * Text-only styles for blocks rendered inside a run's span tree. A run is a
 * single native text tree, so block chrome that needs a view (margins,
 * borders) cannot apply here; these carry the typographic identity of each
 * block instead. Spacing between blocks comes from the separator spans the
 * run renders.
 *
 * Colour is deliberately absent from every entry that has a parent worth
 * inheriting from: the run host paints the base text style, so a block only
 * names what it changes. Re-stating the body colour on a paragraph would beat
 * an enclosing blockquote's muted colour, because the innermost span wins when
 * React Native resolves nested text.
 */
export type RunFlowStyles = {
  heading: Record<1 | 2 | 3 | 4 | 5 | 6, TextStyle>;
  blockquote: TextStyle;
  horizontalRule: TextStyle;
};

const flowStylesCache = new WeakMap<MarkdownTheme, RunFlowStyles>();

const headingStyle = (
  theme: MarkdownTheme,
  fontSize: number,
  letterSpacing: number,
): TextStyle => ({
  color: theme.colors.heading,
  // Shared with renderers/heading.tsx: a custom Android heading font that has
  // no bold face renders a synthetic, mangled bold, so the weight has to be
  // resolved the same way in both paths or toggling `selectable` restyles the
  // document.
  fontWeight: getHeadingWeight(theme),
  fontFamily: theme.fontFamilies.heading,
  fontSize,
  lineHeight: fontSize * 1.3,
  letterSpacing,
});

const createRunFlowStyles = (theme: MarkdownTheme): RunFlowStyles => {
  const styles = StyleSheet.create({
    h1: headingStyle(theme, theme.fontSizes.h1, -0.6),
    h2: headingStyle(theme, theme.fontSizes.h2, -0.4),
    h3: headingStyle(theme, theme.fontSizes.h3, -0.2),
    h4: headingStyle(theme, theme.fontSizes.h4, -0.2),
    h5: headingStyle(theme, theme.fontSizes.h5, -0.2),
    h6: {
      ...headingStyle(theme, theme.fontSizes.h6, -0.2),
      color: theme.colors.textMuted,
    },
    blockquote: {
      color: theme.colors.textMuted,
      fontStyle: "italic",
    },
    horizontalRule: {
      color: theme.colors.textMuted,
    },
  });

  return {
    heading: {
      1: styles.h1,
      2: styles.h2,
      3: styles.h3,
      4: styles.h4,
      5: styles.h5,
      6: styles.h6,
    },
    blockquote: styles.blockquote,
    horizontalRule: styles.horizontalRule,
  };
};

export const getRunFlowStyles = (theme: MarkdownTheme): RunFlowStyles =>
  getCachedStyles(flowStylesCache, theme, createRunFlowStyles);

/**
 * Style properties a nested text span can actually honour. Everything else —
 * margins, padding, borders, layout — needs a view box, which a run does not
 * have. Listing what survives (rather than what does not) keeps the filter
 * correct as React Native grows new view-only properties.
 */
const TEXT_SAFE_STYLE_KEYS: ReadonlySet<string> = new Set([
  "backgroundColor",
  "color",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "includeFontPadding",
  "letterSpacing",
  "lineHeight",
  "opacity",
  "textAlign",
  "textAlignVertical",
  "textDecorationColor",
  "textDecorationLine",
  "textDecorationStyle",
  "textShadowColor",
  "textShadowOffset",
  "textShadowRadius",
  "textTransform",
  "userSelect",
  "verticalAlign",
  "writingDirection",
]);

const warnedDroppedStyles = new Set<string>();

/**
 * Narrows a consumer's block style override to what a run's nested text span
 * can render, and says so in development.
 *
 * Without this the override is force-cast to a text style and the view-only
 * half disappears: `styles={{ paragraph: { marginBottom: 24 } }}` works on a
 * normal render and silently does nothing under `selectable`, with the cast
 * hiding it from the type-checker too.
 */
export const toRunFlowTextStyle = (
  style: ViewStyle | TextStyle | undefined,
  nodeType: string,
): TextStyle | undefined => {
  if (!style) return undefined;

  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined) continue;
    if (TEXT_SAFE_STYLE_KEYS.has(key)) {
      kept[key] = value;
    } else {
      dropped.push(key);
    }
  }

  if (__DEV__ && dropped.length > 0) {
    const signature = `${nodeType}:${dropped.join(",")}`;
    if (!warnedDroppedStyles.has(signature)) {
      warnedDroppedStyles.add(signature);
      console.warn(
        `[NitroMarkdown] styles.${nodeType} sets ${dropped.join(", ")}, which ` +
          "a selectable run cannot apply: a run is one native text tree, and " +
          "these properties need a view box. Move the chrome to the Markdown " +
          "container's style, or classify the block as standalone.",
      );
    }
  }

  return Object.keys(kept).length > 0 ? (kept as TextStyle) : undefined;
};
