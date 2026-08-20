# react-native-nitro-markdown — selectable fork

[![fork of](https://img.shields.io/badge/fork%20of-JoaoPauloCMarra%2Freact--native--nitro--markdown-6366f1)](https://github.com/JoaoPauloCMarra/react-native-nitro-markdown)
[![version](https://img.shields.io/badge/version-0.11.0--superpower.4-f97316)](./CHANGELOG.md)

A Markdown renderer for React Native that parses in native C++ (CommonMark +
GFM, via [md4c](https://github.com/mity/md4c) over
[Nitro Modules](https://nitro.margelo.com/)) and renders real React Native
components — **with text selection that behaves like a document.** One drag
selects across a heading, several paragraphs and a list; "Copy as Markdown"
hands back the markdown *source* for exactly what was highlighted.

## Why this fork exists

Upstream renders each block as its own text node, so a selection stops at every
paragraph boundary — fine for an article, wrong for chat or LLM output a reader
wants to quote. You cannot fix that with styling: a selection can only span one
native text tree, so the blocks have to be *rendered into one*, which changes
how blocks are assembled, how they are styled, and how a selected range maps
back to source. That is what this fork adds.

Everything fast about the library is upstream's and unchanged — parser, JSI
bridge, streaming, headless AST, theming. This fork changes rendering only, and
tracks upstream.

## Features

Inherited from upstream: native C++ parsing, streaming for token-by-token LLM
output, headless AST parsing, themes and per-node renderers, GFM tables and task
lists, syntax highlighting, bounded parse input and a link/image URL policy.

Added by this fork:

| Feature | What it does |
| ------- | ------------ |
| **Selectable runs** (`selectable`) | Adjacent flowing blocks — paragraphs, headings, lists, blockquotes, thematic breaks — merge into a **run** rendered as a *single* native text tree, so one gesture selects across all of them. |
| **Copy as Markdown** (`onCopyAsMarkdown`) | A selected range maps back onto the source; the callback receives that exact substring, not the rendered plain text. Needs a native `runHost` (below). |
| **Block classification** (`classifyBlock`) | Blocks are *flowing* (mergeable) or *standalone* (never merge — they own a gesture or render a view). Standalone by default: tables, fenced code, images, math, HTML. Apps extend the rule for their own renderers. |
| **Selection inside standalone blocks** | Fenced code text and each table cell render through the same selectable host, each its own selection scope. A selection never *crosses* a standalone block — that boundary is deliberate. |
| **Source-range annotation** (`RunText`, `sourceRangeOf`) | Every span carries `beg`/`end` UTF-16 source offsets, soft and hard breaks included — which is why selecting across a wrapped line copies those lines instead of the whole paragraph. |
| **Injectable primitives** (`textPrimitive`, `runHost`) | The inline text primitive and the run's selectable host are both swappable, so a native selection host drops in without forking the renderer. |
| **Smart punctuation** (`smartPunctuation`) | Curly quotes, en/em dashes, ellipses as a render-time transform — deliberately not a pre-parse plugin, which would re-parse the document on every streamed token. Follows markdown-it's dash rules, so `--verbose` in prose keeps its hyphens. |
| **Incremental AST hook** (`useIncrementalMarkdownAst`) | Parses a growing string while preserving the identity of unchanged nodes, so a streamed append re-renders only the still-growing tail run — no native session required. |
| **Testing entry point** (`/testing`) | A source-faithful mock parser with real offsets, plus `simulateCopyAsMarkdown` to drive a host the way native would. Test the real library with no device. |
| **No math peer dependency** | The `ratex-react-native` peer dep and its autolinking workaround are gone. Math renders as monospace text; parsing is unchanged. |

Breaking vs upstream 0.10.0: images, math and HTML blocks are now standalone
blocks (a paragraph containing inline math or an inline image is standalone too,
keeping the dedicated renderers' layout path), and the run host no longer
declares `onSelectionChange`. Per-release detail: [CHANGELOG](./CHANGELOG.md).

## How selectable runs work

1. **Parse** — md4c emits an AST whose nodes carry `beg`/`end` source offsets as
   UTF-16 indices (matching `String.slice`).
2. **Classify** — each top-level block is flowing or standalone. Classification
   walks the subtree, so an inline image anywhere in a paragraph makes that
   paragraph standalone.
3. **Assemble** — maximal sequences of adjacent flowing blocks become runs. **A
   run is exactly one selection scope.**
4. **Render** — a run renders into one selectable host. Every span goes through
   the inline text primitive and is annotated with its source range; text the
   renderer synthesises (separators, bullets) carries none.
5. **Map back** — the host reports `{ start, end, spans }` in rendered-text
   offsets; `mapSelectionToSource` converts that to a source range and slices
   the text those offsets index (after `beforeParse` plugins, not raw
   `children`). Mapping is one unit-tested JavaScript implementation — the host
   only reports geometry.
6. **Memoize** — a run is keyed by the source offset of its first block (never
   by index: block counts change mid-stream) and compared on AST node identity.

**The trade-off.** A run is one text tree, so block chrome needing a view box
cannot apply inside it. With `selectable`, blocks keep typographic identity
(weight, size, letter spacing) but not margins or the h1 rule; a blockquote is
muted italic text, not a bordered box; spacing comes from separator spans; a
thematic break renders as text (`———`), so screen readers announce it; task
items render as `☐`/`☑`. View-only `styles` properties are dropped inside runs,
and dev builds name the ones they drop. Put that chrome on the container, or
classify the block as standalone.

**Copy as Markdown needs native work.** The default host is the platform's
selectable text component: on Android that gives real drag-handle selection
across the run plus plain-text copy; on iOS, whole-text selection only. Neither
reports *which* range was selected, so `onCopyAsMarkdown` cannot fire without a
native `runHost` (dev builds warn). The four requirements for a host are in
[docs/selectable-runs.md](./docs/selectable-runs.md#host-contract-native-work).

## Install

Not on npm — that name is upstream's package. A `github:` dependency won't work
either, since the package lives in `packages/` and neither npm nor bun installs
a git subdirectory. Every
[release](https://github.com/unDemian/react-native-nitro-markdown/releases)
attaches a built tarball; install it by URL:

```sh
# in your app
bun add react-native-nitro-markdown@https://github.com/unDemian/react-native-nitro-markdown/releases/download/v0.11.0-superpower.4/react-native-nitro-markdown-0.11.0-superpower.4.tgz
bun add react-native-nitro-modules@0.36.5
bunx expo prebuild
```

Or build the tarball yourself and vendor it:

```sh
git clone https://github.com/unDemian/react-native-nitro-markdown.git
cd react-native-nitro-markdown && bun install && bun run build
cd packages/react-native-nitro-markdown && bun pm pack
# then, in your app
bun add ./vendor/react-native-nitro-markdown-0.11.0-superpower.4.tgz
```

Requires React Native >=0.75 (New Architecture), Nitro Modules >=0.36.5 <0.37.0,
iOS or Android — Expo Go cannot load Nitro modules, so use a development build.
Setup detail: [Installation](./docs/installation.md).

## Usage

```tsx
import { Markdown } from "react-native-nitro-markdown";

<Markdown options={{ gfm: true, math: true }} onError={console.error}>
  {"# Hello\nThis is **native** markdown."}
</Markdown>;
```

Parse failures call `onError` rather than rendering an empty document.

Selectable, with Copy as Markdown:

```tsx
<Markdown
  selectable
  smartPunctuation
  runHost={NativeSelectableRunHost}
  classifyBlock={classifyCopyAction}
  onCopyAsMarkdown={(markdown) => Clipboard.setStringAsync(markdown)}
>
  {content}
</Markdown>
```

Streaming a selectable document, without a native session:

```tsx
const ast = useIncrementalMarkdownAst(text, PARSER_OPTIONS); // stable options
<Markdown selectable sourceAst={ast ?? undefined}>{text}</Markdown>;
```

Give `classifyBlock`, `renderers`, `textPrimitive` and `runHost` stable
identities — they are read during render, so a new one each render re-renders
the document. `onCopyAsMarkdown` and `onLinkPress` are read on the gesture and
are safe to pass inline. Custom inline renderers must emit text spans through
the primitive, never views; a custom block renderer that draws a view needs a
`classifyBlock` rule to match.

`selectable` is mutually exclusive with `virtualize` — recycled cells cannot
hold a continuous selection, so virtualized renders ignore the flag.

## API added by this fork

| Prop | Default | |
| ---- | ------- | --- |
| `selectable` | `false` | Render adjacent flowing blocks as selectable runs. |
| `classifyBlock` | `undefined` | Return `"standalone"` to register app-specific standalone blocks. |
| `onCopyAsMarkdown` | `undefined` | Source markdown for the selected range. Requires a native `runHost`. |
| `smartPunctuation` | `false` | Typographic punctuation as a render-time transform. |
| `textPrimitive` / `runHost` | `RunText` / `SelectableRunHost` | Injectable inline primitive and selectable host. |

```ts
import {
  classifyBlock,          // default classifier
  assembleRuns,           // blocks -> runs
  mapSelectionToSource,   // rendered range + spans -> source range
  RunText, sourceRangeOf,
  SelectableRunHost,
  RunFlowContext, useInRunFlow,
  smartenText,
  useIncrementalMarkdownAst,
} from "react-native-nitro-markdown";

import { parseMockMarkdown, simulateCopyAsMarkdown } from "react-native-nitro-markdown/testing";
```

Types: `BlockClass`, `ClassifyBlock`, `RunPart`, `AnnotatedSpan`,
`MappedSourceRange`, `RunTextProps`, `SourceRange`, `RunHostSelection`,
`SelectableRunHostProps`.

Upstream's API — themes, per-node styles, renderers, plugins, `MarkdownStream`,
the `/headless` parser — is unchanged: [Usage](./docs/usage.md),
[Customization](./docs/customization.md), [Streaming](./docs/streaming.md),
[Headless](./docs/headless.md). Note that selection mapping needs
`options.sourceOffsets` (the default) — without offsets there is nothing to map
back onto.

## Development

```sh
bun install
bun run check          # lint + typecheck + tests (JS and C++)
bun run example:ios    # example app — see the Selectable Runs screen
```

Selection architecture, host contract and testing helpers:
[docs/selectable-runs.md](./docs/selectable-runs.md). Fixes that are not
selection-specific belong
[upstream](https://github.com/JoaoPauloCMarra/react-native-nitro-markdown), as
do parser and security reports.

## Credits

Upstream library by [João Paulo C. Marra](https://github.com/JoaoPauloCMarra);
parsing by [md4c](https://github.com/mity/md4c); native bridge by
[Nitro Modules](https://nitro.margelo.com/). Selectable runs by
[unDemian](https://github.com/unDemian). [MIT](./LICENSE), same as upstream.
