# Selectable runs

This fork makes runs and selection first-class library concepts. Vocabulary:
a **block** is one top-level node of a markdown document; a **flowing block**
(paragraph, heading, list, blockquote, thematic break) may merge with its
neighbours; a **standalone block** never merges, because it either owns a
gesture that would fight the selection gesture or renders a view; a **run** is
a maximal sequence of adjacent flowing blocks; the **selection scope** is
exactly one run.

## What the library does

- `<Markdown selectable>` classifies top-level blocks (`classifyBlock` prop
  extends the default), assembles runs, and renders each run into one
  selectable host — a single native text tree, so a selection can span every
  block inside the run.
- Standalone blocks by default: tables, fenced code blocks, images, math
  (inline and block) and HTML blocks. The first two own gestures; the rest
  render views, and a view nested in text is positioned via placeholder spans
  on Android, where selection degrades across it. Classification walks the
  tree, so a paragraph carrying an inline image or inline math is standalone
  too, and keeps the dedicated renderers' layout path.
- Standalone blocks are selectable *within* themselves: a fenced code block's
  text and each table cell render through the same selectable host, each as
  its own selection scope. A single selection still never crosses a
  standalone block — that boundary is the design, not a gap.
- Every span inside a run renders through the injectable inline text
  primitive (`RunText` by default, `textPrimitive` prop to swap). Custom
  inline renderers must emit text spans through the primitive, never views —
  the library cannot classify what a custom renderer will draw, so a custom
  block renderer that emits a view needs a `classifyBlock` rule to match.
- Spans are annotated with `sourceRange` (`beg`/`end` UTF-16 offsets into the
  markdown source, as emitted by the parser). Every span carries its own
  range, breaks included: a soft break annotated with the newline it came
  from is what keeps a selection across a wrapped line mapping to those
  characters instead of to the whole paragraph. Text the renderer
  synthesises — block separators, list bullets — carries no source range.
- Runs are memoization boundaries: a run is keyed by the source offset of its
  first block (never by index — block counts change mid-stream, and index
  keys would remount settled runs) and compared on the identity of the AST
  nodes it contains. `<Markdown>` reuses the identity of every node a parse
  left untouched, so this holds for the plain `<Markdown selectable>{text}</Markdown>`
  path as well as for a hand-wired `sourceAst`.
- `mapSelectionToSource` maps a selected range of rendered text back onto the
  markdown source; `onCopyAsMarkdown` receives the source substring for
  exactly the selected range. Inside a span, character positions are trusted
  only when rendered text has the same length as its source slice; otherwise
  the span maps to its whole source range. The source it slices is the text
  the offsets index — after `beforeParse` plugins have run, not the raw
  `children`.
- `smartPunctuation` applies typographic quotes/dashes/ellipses as a
  transform over parsed text content at render time. It must never become a
  pre-parse plugin: registering one disables incremental AST reuse and turns
  every streamed token into a full re-parse. Quote substitution is
  length-preserving, so mapping through it stays exact; dashes/ellipses
  shorten text and snap to node boundaries. Dash rules follow markdown-it's
  typographer, so prose that mentions `--verbose` keeps its hyphens. The
  character before each text node is threaded across siblings, so a quote
  that inline markup pushed into its own node still curls closed.

## How a run presents its blocks

A run is one text tree, so block chrome that needs a view box cannot apply
inside it. Toggling `selectable` therefore changes some presentation:

- Blocks carry typographic identity only — heading weight, size and letter
  spacing match the standalone renderers, but a heading's margins and the h1
  rule do not apply, and a blockquote is muted italic text rather than a
  bordered box.
- Spacing between blocks comes from separator spans (a blank line between
  blocks, a single break before a nested list), not from margins.
- A `styles` override for a block is narrowed to the properties a nested text
  span honours. Anything view-only (margins, padding, borders, layout) is
  dropped, and development builds name the dropped properties once per block
  type. Put that chrome on the `Markdown` container, or classify the block as
  standalone.
- A thematic break renders as text (`———`) rather than a hairline view, so
  unlike the standalone rule it is part of what a screen reader reads out.
- Task list items render as `☐`/`☑` glyphs rather than drawn checkboxes.

## Host contract (native work)

The default host is the platform's own selectable text component
(`SelectableRunHost`), which is complete on Android for selection itself:
Android's selectable text compiles nested children into one span tree and
supports drag-handle selection across the whole run. On iOS the platform
component only offers whole-text selection.

What the default host cannot do on **either** platform is report *which*
range the reader selected. It never calls `onCopyAsMarkdownRequested`, so a
consumer's `onCopyAsMarkdown` never fires — development builds warn when it
is set without a `runHost`. Out of the box a reader gets selection plus
plain-text copy on Android, and whole-run copy on iOS.

A native host replaces the default via the `runHost` prop and must:

1. Render `children` as a single native text tree (they are nested text
   spans; the primitive guarantees this).
2. Provide range selection UI (iOS: text interaction over the run's
   attributed string; Android: the platform selection ActionMode).
3. Add a **Copy as Markdown** item to the selection menu (iOS edit menu;
   Android ActionMode menu).
4. On that menu action, walk its span tree, collect `(text, sourceRange)` for
   each span in rendered order (nearest annotated ancestor wins; unannotated
   text is synthetic), and fire `onCopyAsMarkdownRequested` with
   `{ start, end, spans }` — offsets into the rendered text.

Range→source mapping stays in JavaScript (`mapSelectionToSource`, one
implementation, unit-tested); the host only reports geometry and
annotations. The default plain-text copy is the platform's own and needs no
JS round-trip.

Anything gated on native work is listed in the consumer app's spike protocol
(gesture arbitration: a tappable citation inside a native range selection),
which must conclude before the iOS host is built.

## Testing

Consumer suites run the real JavaScript library with the native parser
replaced by `parseMockMarkdown` (real source offsets), and drive selection by
invoking `simulateCopyAsMarkdown` on the host the way a native host would —
see `react-native-nitro-markdown/testing`. The helpers take any rendered
instance with `props` and `children`, so react-test-renderer and
`@testing-library/react-native` both work and neither becomes a dependency.

Known gap: the mock stands in for md4c, so these suites do not prove the
*native* parser handles a consumer's markup (citation URL suffixes,
`copy://` hrefs, and so on). That proof comes from this package's C++
conformance suite plus the consumer's on-device passes; keep the mock
source-faithful when extending it.
