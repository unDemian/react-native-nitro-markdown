import type { FC, ComponentType } from "react";
import {
  View,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { MarkdownNode } from "../../headless";
import { useMarkdownContext, type NodeRendererProps } from "../../MarkdownContext";
import { RunFlowContext } from "../../selection/run-flow-context";
import { SelectableRunHost } from "../../selection/selectable-run-host";

type CellContentProps = {
  node: MarkdownNode;
  Renderer: ComponentType<NodeRendererProps>;
  styles: {
    cellContentWrapper: StyleProp<ViewStyle>;
    [key: string]: StyleProp<ViewStyle | TextStyle> | undefined;
  };
  textStyle?: StyleProp<TextStyle>;
};

export const CellContent: FC<CellContentProps> = ({
  node,
  Renderer,
  styles,
  textStyle,
}) => {
  const { selectable, runHost } = useMarkdownContext();

  // In selectable mode each cell is its own selection scope: its content
  // renders as one span tree inside the selectable host, so a reader can
  // select within a cell (a selection never crosses the table itself).
  if (selectable) {
    const CellHost = runHost ?? SelectableRunHost;
    if (!node.children || node.children.length === 0) {
      return <CellHost style={textStyle}>{node.content ?? ""}</CellHost>;
    }
    return (
      <RunFlowContext.Provider value={true}>
        <CellHost style={textStyle}>
          {node.children.map((child, idx) => (
            <Renderer
              key={
                child.beg != null
                  ? `${child.type}-${child.beg}`
                  : `${child.type}-${idx}`
              }
              node={child}
              depth={0}
              inListItem={false}
              parentIsText={true}
            />
          ))}
        </CellHost>
      </RunFlowContext.Provider>
    );
  }

  if (!node.children || node.children.length === 0) {
    return <Text style={textStyle}>{node.content ?? ""}</Text>;
  }

  return (
    <View style={styles.cellContentWrapper}>
      {node.children.map((child, idx) => (
        <Renderer
          key={
            child.beg != null
              ? `${child.type}-${child.beg}`
              : `${child.type}-${idx}`
          }
          node={child}
          depth={0}
          inListItem={false}
          parentIsText={false}
        />
      ))}
    </View>
  );
};
