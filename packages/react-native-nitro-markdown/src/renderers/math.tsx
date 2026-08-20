// Math rendering intentionally ships without a native math engine: the fork
// dropped the math rendering peer dependency outright, which removes the
// autolinking workaround consumers previously needed. Math content renders as
// monospace text.
import type { FC, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  PanResponder,
  StyleSheet,
  Platform,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { getCachedStyles } from "./style-cache";
import { useMarkdownContext } from "../MarkdownContext";
import type { MarkdownTheme } from "../theme";

type MathInlineProps = {
  content?: string;
  style?: ViewStyle;
};

type MathStyles = ReturnType<typeof createMathStyles>;

const mathStylesCache = new WeakMap<MarkdownTheme, MathStyles>();

type HorizontalMathViewportProps = {
  children: ReactNode;
  contentWidth?: number;
  style: StyleProp<ViewStyle>;
  contentStyle: StyleProp<ViewStyle>;
};

const HorizontalMathViewport: FC<HorizontalMathViewportProps> = ({
  children,
  contentWidth,
  style,
  contentStyle,
}) => {
  const [viewportWidth, setViewportWidth] = useState(0);
  const [measuredContentWidth, setMeasuredContentWidth] = useState(
    contentWidth ?? 0,
  );
  const [offset, setOffset] = useState(0);
  const viewportWidthRef = useRef(0);
  const contentWidthRef = useRef(contentWidth ?? 0);
  const offsetRef = useRef(0);
  const gestureStartOffsetRef = useRef(0);
  const [panHandlers, setPanHandlers] = useState<
    ReturnType<typeof PanResponder.create>["panHandlers"] | null
  >(null);

  const setClampedOffset = useCallback((nextOffset: number) => {
    const maxOffset = Math.max(
      0,
      contentWidthRef.current - viewportWidthRef.current,
    );
    const clampedOffset = Math.min(0, Math.max(-maxOffset, nextOffset));
    offsetRef.current = clampedOffset;
    setOffset(clampedOffset);
  }, []);

  useEffect(() => {
    if (typeof contentWidth !== "number") return;

    contentWidthRef.current = contentWidth;
    setMeasuredContentWidth(contentWidth);
    setClampedOffset(offsetRef.current);
  }, [contentWidth, setClampedOffset]);

  const handleViewportLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportWidthRef.current = event.nativeEvent.layout.width;
      setViewportWidth(viewportWidthRef.current);
      setClampedOffset(offsetRef.current);
    },
    [setClampedOffset],
  );

  const handleContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (typeof contentWidth === "number") return;

      contentWidthRef.current = event.nativeEvent.layout.width;
      setMeasuredContentWidth(contentWidthRef.current);
      setClampedOffset(offsetRef.current);
    },
    [contentWidth, setClampedOffset],
  );

  useEffect(() => {
    const responder = PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gestureState) => {
        const hasOverflow =
          contentWidthRef.current > viewportWidthRef.current + 1;
        const isHorizontal =
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) + 4;
        return hasOverflow && isHorizontal;
      },
      onPanResponderGrant: () => {
        gestureStartOffsetRef.current = offsetRef.current;
      },
      onPanResponderMove: (_event, gestureState) => {
        setClampedOffset(gestureStartOffsetRef.current + gestureState.dx);
      },
      onPanResponderTerminationRequest: () => false,
    });

    setPanHandlers(responder.panHandlers);
  }, [setClampedOffset]);

  const centeredOffset =
    measuredContentWidth > 0 && viewportWidth > measuredContentWidth
      ? (viewportWidth - measuredContentWidth) / 2
      : 0;

  return (
    <View
      style={style}
      onLayout={handleViewportLayout}
      pointerEvents="box-only"
      {...(panHandlers ?? {})}
    >
      <View
        style={[
          contentStyle,
          typeof contentWidth === "number" && { width: contentWidth },
          { transform: [{ translateX: centeredOffset + offset }] },
        ]}
        onLayout={handleContentLayout}
        pointerEvents="none"
      >
        {children}
      </View>
    </View>
  );
};

const createMathStyles = (theme: MarkdownTheme) =>
  StyleSheet.create({
    mathInlineFallbackContainer: {
      backgroundColor: theme.colors.codeBackground,
      paddingHorizontal: theme.spacing.xs,
      paddingVertical: 2,
      borderRadius: theme.borderRadius.s,
      marginHorizontal: 2,
    },
    mathInlineFallback: {
      fontFamily:
        theme.fontFamilies.mono ??
        Platform.select({ ios: "Courier", android: "monospace" }),
      fontSize: theme.fontSizes.s,
      color: theme.colors.code,
      ...(Platform.OS === "android" && { includeFontPadding: false }),
    },
    mathBlockScroll: {
      width: "100%",
      alignSelf: "stretch",
      maxWidth: "100%",
      overflow: "hidden",
    },
    mathBlockScrollContent: {
      alignSelf: "flex-start",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: theme.spacing.s,
    },
    mathBlockFallbackContainer: {
      width: "100%",
      maxWidth: "100%",
      alignSelf: "stretch",
      marginVertical: theme.spacing.m,
      paddingVertical: theme.spacing.m,
      paddingHorizontal: theme.spacing.l,
      backgroundColor: theme.colors.codeBackground,
      borderRadius: theme.borderRadius.m,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
    },
    mathBlockFallback: {
      fontFamily:
        theme.fontFamilies.mono ??
        Platform.select({ ios: "Courier", android: "monospace" }),
      fontSize: theme.fontSizes.m,
      color: theme.colors.code,
      textAlign: "center",
      flexShrink: 0,
      ...(Platform.OS === "android" && { includeFontPadding: false }),
    },
  });

export const MathInline: FC<MathInlineProps> = ({ content, style }) => {
  const { theme } = useMarkdownContext();
  const styles = getCachedStyles(mathStylesCache, theme, createMathStyles);

  if (!content) return null;

  return (
    <View style={[styles.mathInlineFallbackContainer, style]}>
      <Text style={styles.mathInlineFallback}>{content}</Text>
    </View>
  );
};

type MathBlockProps = {
  content?: string;
  style?: ViewStyle;
};

export const MathBlock: FC<MathBlockProps> = ({ content, style }) => {
  const { theme } = useMarkdownContext();
  const styles = getCachedStyles(mathStylesCache, theme, createMathStyles);

  if (!content) return null;

  return (
    <View style={[styles.mathBlockFallbackContainer, style]}>
      <HorizontalMathViewport
        style={styles.mathBlockScroll}
        contentStyle={styles.mathBlockScrollContent}
      >
        <Text style={styles.mathBlockFallback}>{content}</Text>
      </HorizontalMathViewport>
    </View>
  );
};
