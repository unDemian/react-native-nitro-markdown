import { StyleSheet } from "react-native";
import { Markdown } from "react-native-nitro-markdown";
import { ExampleHeader, ExamplePanel, ExampleScreen } from "../components/example-ui";
import { useBottomTabHeight } from "../hooks/use-bottom-tab-height";

const SELECTABLE_MARKDOWN = `# Selectable runs

Long-press anywhere in this prose and drag: the selection extends from this
paragraph **through the list and the quote below** — they are one run.

- One selection can span every flowing block in a run
- Bullets and separators are synthesised text, so copy reads naturally

> Selection stops only at a standalone block, because a standalone block owns
> gestures of its own, or draws a view.

\`\`\`ts
// This code block terminates the run above and starts a new one below.
const selection = "stops here";
\`\`\`

A new run begins here — smart punctuation is on, so "quotes" curl and spaced
dashes -- become en dashes, while a flag like --verbose keeps its hyphens.

## Copy as Markdown

The menu item that hands your app the markdown source for the selected range
is native work: the platform's own selectable text reports no selection
range, so this screen shows selection and plain-text copy only. Wire a native
host through the \`runHost\` prop to add it.
`;

export default function RenderSelectableScreen() {
  const tabHeight = useBottomTabHeight();

  return (
    <ExampleScreen paddingBottom={tabHeight + 20}>
      <ExampleHeader
        title="Selectable Runs"
        subtitle="One selection across adjacent flowing blocks; standalone blocks keep their own gestures."
      />
      <ExamplePanel style={styles.card}>
        {/*
          No onCopyAsMarkdown here: without a native runHost it could never
          fire, and a sample that wires a callback nothing calls is worse than
          one that says why.
        */}
        <Markdown
          selectable
          smartPunctuation
          options={{ gfm: true }}
          style={styles.markdown}
        >
          {SELECTABLE_MARKDOWN}
        </Markdown>
      </ExamplePanel>
    </ExampleScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
  },
  markdown: {
    flex: 1,
  },
});
