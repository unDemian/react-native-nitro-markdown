# react-native-nitro-markdown — selectable fork

[![upstream](https://img.shields.io/badge/fork%20of-JoaoPauloCMarra%2Freact--native--nitro--markdown-6366f1)](https://github.com/JoaoPauloCMarra/react-native-nitro-markdown)
[![version](https://img.shields.io/badge/version-0.11.0--superpower.4-f97316)](./CHANGELOG.md)
[![React Native](https://img.shields.io/badge/react--native-%3E%3D0.75-61dafb)](https://reactnative.dev/docs/0.86/getting-started-without-a-framework)
[![Expo](https://img.shields.io/badge/expo-SDK%2057-000020)](https://docs.expo.dev/versions/v57.0.0/)
[![Nitro Modules](https://img.shields.io/badge/nitro--modules-%3E%3D0.36.5%20%3C0.37.0-black)](https://www.npmjs.com/package/react-native-nitro-modules)
[![TypeScript](https://img.shields.io/badge/typescript-6.0-3178c6)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/badge/license-MIT-007ec6)](./LICENSE)

> **This is a fork of [JoaoPauloCMarra/react-native-nitro-markdown](https://github.com/JoaoPauloCMarra/react-native-nitro-markdown).**
> Everything that makes the library fast — the md4c C++ parser, the Nitro/JSI
> bridge, streaming, the headless AST, theming — is upstream's work, and this
> fork tracks it. What the fork adds is **text selection that behaves like a
> document**: a reader can drag one selection across a heading, several
> paragraphs and a list, and copy back the *markdown source* for exactly what
> they highlighted. It is not published to npm under this name — the npm
> package `react-native-nitro-markdown` is upstream's. See
> [Install](#install-this-fork).

**The fast Markdown engine for React Native.** Native **C++ parsing**
(CommonMark + GitHub Flavored Markdown), real React Native rendering,
first-class **streaming** for LLM/chat output, a **headless AST** API, and —
in this fork — **selectable runs with Copy as Markdown** — powered by
[md4c](https://github.com/mity/md4c) and [Nitro Modules](https://nitro.margelo.com/).

<p align="center">
  <img src="https://raw.githubusercontent.com/unDemian/react-native-nitro-markdown/main/readme/render.png" alt="Nitro Markdown rendering rich GitHub Flavored Markdown natively in React Native" width="250" />
  <img src="https://raw.githubusercontent.com/unDemian/react-native-nitro-markdown/main/readme/themes.png" alt="The same Markdown rendered with the built-in dark theme — fully customizable themes, per-node styles, and renderers" width="250" />
  <img src="https://raw.githubusercontent.com/unDemian/react-native-nitro-markdown/main/readme/streaming.png" alt="Streaming token-by-token markdown for LLM and chat output" width="250" />
</p>

## What this fork changes

Every item below is fork work, on top of upstream 0.10.0. Full detail per
release is in the [changelog](./CHANGELOG.md) (`0.11.0-superpower.*`).

| Change | What it means |
| ------ | ------------- |
| **Selectable runs** (`selectable`) | Adjacent flowing blocks — paragraphs, headings, lists, blockquotes, thematic breaks — merge into a **run** and render into a *single* native text tree. One selection gesture spans every block in the run, instead of stopping at each paragraph. |
| **Copy as Markdown** (`onCopyAsMarkdown`) | A selected range maps back onto the markdown source, and the callback receives that exact substring — not the rendered plain text. Requires a native `runHost`; see [the host contract](./docs/selectable-runs.md#host-contract-native-work). |
| **Block classification** (`classifyBlock`) | Every top-level block is *flowing* (mergeable) or *standalone* (never merges, because it owns a gesture or renders a view). Defaults: tables, fenced code, images, math, HTML blocks. Apps extend the rule for their own block renderers. |
| **Selection inside standalone blocks** | A fenced code block's text and each table cell render through the same selectable host, each as its own selection scope. A selection never *crosses* a standalone block — that boundary is the design. |
| **Source-range annotation** (`RunText`, `sourceRangeOf`) | Every rendered span carries `beg`/`end` UTF-16 offsets into the source, soft and hard breaks included — which is what makes a selection across a wrapped line copy those lines rather than the whole paragraph. |
| **Injectable primitives** (`textPrimitive`, `runHost`) | The inline text primitive and the selectable host a run renders into are both swappable, so a native selection host drops in without forking the renderer. |
| **Smart punctuation** (`smartPunctuation`) | Typographic quotes, dashes and ellipses applied as a render-time transform over parsed text — deliberately *not* a pre-parse plugin, which would disable incremental AST reuse and re-parse the document on every streamed token. Dash rules follow markdown-it's typographer, so prose mentioning `--verbose` keeps its hyphens. |
| **Incremental AST hook** (`useIncrementalMarkdownAst`) | Parses a growing string while preserving the identity of unchanged AST nodes, so streamed appends re-render only the still-growing tail run — without a native `MarkdownSession`. `<Markdown>` reuses node identity across parses too, so this holds for the plain `<Markdown selectable>{text}</Markdown>` path. |
| **Testing entry point** (`react-native-nitro-markdown/testing`) | A source-faithful mock native parser with real source offsets, plus `simulateCopyAsMarkdown` to drive a host the way native would. Consumer suites test the real library on any JS runtime, with no device and no `react-test-renderer` dependency. |
| **No math peer dependency** | **Breaking vs upstream 0.10.0:** the `ratex-react-native` peer dependency is dropped, along with the autolinking workaround it needed. Math nodes render as monospace text; parsing is unchanged. |
| **Streaming render cost** | `onCopyAsMarkdown` and `onLinkPress` are read through refs, so inline arrows no longer rebuild the context value and re-render every node on each chunk. |

Two upstream behaviours became **breaking changes** in this fork: images, math
and HTML blocks are now standalone blocks (a paragraph carrying inline math or
an inline image is standalone too, keeping the dedicated renderers' layout
path), and the run host no longer declares `onSelectionChange`.

## How selectable runs work

The pipeline, end to end:

1. **Parse** — md4c parses in C++ over JSI and emits an AST whose nodes carry
   `beg`/`end` source offsets as JavaScript UTF-16 indices (matching
   `String.slice`).
2. **Classify** — each top-level block is labelled flowing or standalone.
   Classification walks the subtree, so an inline image anywhere in a
   paragraph makes that paragraph standalone. `classifyBlock` extends the
   default rule; it cannot make a table or fenced code flow.
3. **Assemble** — maximal sequences of adjacent flowing blocks become runs.
   **A run is exactly one selection scope.**
4. **Render** — a run renders into one selectable host (`runHost`), i.e. one
   native text tree. Every span inside goes through the inline text primitive
   (`textPrimitive`, `RunText` by default) and is annotated with its own
   source range. Text the renderer synthesises — block separators, list
   bullets — carries no range.
5. **Map back** — on the Copy as Markdown menu action, the host reports
   `{ start, end, spans }` in *rendered-text* offsets.
   `mapSelectionToSource` converts that to a source range and slices the text
   the offsets index (after `beforeParse` plugins have run, not raw
   `children`). Inside a span, character positions are trusted only when the
   rendered text has the same length as its source slice; otherwise the span
   maps to its whole range. Mapping lives in JavaScript, unit-tested, with
   one implementation — the host only reports geometry.
6. **Memoize** — a run is keyed by the source offset of its first block
   (never by index: block counts change mid-stream, and index keys would
   remount settled runs) and compared on the identity of the AST nodes it
   holds.

**The presentation trade-off.** A run is one text tree, so block chrome that
needs a view box cannot apply inside it. Toggling `selectable` therefore
changes some rendering: blocks keep typographic identity (heading weight,
size, letter spacing) but not margins or the h1 rule; a blockquote is muted
italic text, not a bordered box; spacing between blocks comes from separator
spans; a thematic break renders as text (`———`), so a screen reader reads it;
task items render as `☐`/`☑` glyphs. A `styles` override is narrowed to
properties a nested span honours, and development builds name the view-only
properties they drop. Put that chrome on the `Markdown` container, or classify
the block as standalone.

**What needs native work.** The default host is the platform's own selectable
text component. On Android that is genuinely complete for *selection* —
drag-handle selection across the whole run, plus plain-text copy. On iOS the
platform component only offers whole-text selection. Neither reports **which**
range the reader selected on either platform, so `onCopyAsMarkdown` cannot
fire without a native `runHost` (development builds warn when you set one
without the other). The four things a native host must do are specified in
[docs/selectable-runs.md](./docs/selectable-runs.md#host-contract-native-work).

## Install (this fork)

This fork is **not on npm** — `react-native-nitro-markdown` there is
upstream's package. A plain `github:` dependency does not work either: the
package lives in `packages/react-native-nitro-markdown`, and neither npm nor
bun installs a subdirectory of a git repo. Build a tarball and vendor it:

```sh
git clone https://github.com/unDemian/react-native-nitro-markdown.git
cd react-native-nitro-markdown
bun install
bun run build
cd packages/react-native-nitro-markdown && bun pm pack
```

Then, in your app:

```sh
bun add ./vendor/react-native-nitro-markdown-0.11.0-superpower.4.tgz
bun add react-native-nitro-modules@0.36.5
bunx expo prebuild   # Expo development build
```

`react-native-nitro-modules` is a peer dependency (parsing uses native code).
Expo Go cannot load Nitro modules — use a development build. Platform setup is
otherwise unchanged from upstream: **[Installation](./docs/installation.md)**.

## Quick start

```tsx
import { Markdown } from "react-native-nitro-markdown";

export function Article() {
  return (
    <Markdown
      options={{ gfm: true, math: true }}
      onError={(error) => {
        console.error(error);
      }}
    >
      {"# Hello\nThis is **native** markdown."}
    </Markdown>
  );
}
```

Native parse failures call `onError` instead of rendering an empty document.
Headless `parseMarkdown` throws; do not treat an empty AST as success. Keep
product fonts and colors in an app wrapper around `<Markdown>`.

## Selectable runs

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

Out of the box — no `runHost` — a reader gets selection plus plain-text copy
on Android, and whole-run copy on iOS. Custom inline renderers must emit text
spans through the injectable primitive, never views; a custom *block* renderer
that draws a view needs a `classifyBlock` rule to match, because the library
cannot classify what a renderer will draw.

Give `classifyBlock`, `renderers`, `textPrimitive` and `runHost` stable
identities — they are read during render, so a new one each render re-renders
the document. `onCopyAsMarkdown` and `onLinkPress` are read on the gesture and
are safe to pass inline. Architecture, host contract and testing helpers:
**[docs/selectable-runs.md](./docs/selectable-runs.md)**.

`selectable` is mutually exclusive with `virtualize` — recycled cells cannot
hold a continuous selection, so virtualized renders ignore the flag.

## Streaming (LLM / chat)

```tsx
import { useEffect } from "react";
import { MarkdownStream, useMarkdownSession } from "react-native-nitro-markdown";

type StreamingMessageProps = {
  subscribe: (onToken: (token: string) => void) => () => void;
  onError: (error: Error) => void;
};

export function StreamingMessage({
  subscribe,
  onError,
}: StreamingMessageProps) {
  const session = useMarkdownSession();

  useEffect(
    () => subscribe((token) => session.getSession().append(token)),
    [session, subscribe],
  );

  return (
    <MarkdownStream
      session={session}
      updateStrategy="raf"
      incrementalParsing
      onError={onError}
    />
  );
}
```

`MarkdownStream` batches native range updates. Plain-text and fenced-code
appends take an incremental path; structural updates re-parse with stable AST
node reuse. Failed updates call `onError(error, "parse")` and retain the last
valid render. For very large initial content, pass `initialParseMode="async"`
so the first frame renders without parsing.

For a selectable stream without a native session, parse with the fork's
`useIncrementalMarkdownAst` and feed the result to `sourceAst` — node identity
survives each parse, so settled runs skip re-rendering:

```tsx
const ast = useIncrementalMarkdownAst(text, PARSER_OPTIONS); // module-constant options
return <Markdown selectable sourceAst={ast ?? undefined}>{text}</Markdown>;
```

Full guide: **[Streaming](./docs/streaming.md)**.

## Headless parsing

```ts
import {
  parseMarkdown,
  parseMarkdownWithOptions,
  extractPlainText,
} from "react-native-nitro-markdown/headless";

const ast = parseMarkdown("# Title");
const mathAst = parseMarkdownWithOptions("Inline $x^2$", { math: true });
const text = extractPlainText("Hello **world**"); // "Hello world"

// Search / indexing: skip source offsets natively for a leaner, faster AST.
const lean = parseMarkdownWithOptions(doc, { sourceOffsets: false });
```

Use the `/headless` export for AST data, plain-text extraction, indexing, or
tests without rendering UI. Parser functions throw when the native module is
unavailable, parsing fails, or native output is invalid; catch errors at your
application boundary. The headless entry still requires an iOS or Android
native runtime. Note that selectable runs need `sourceOffsets` (the default) —
without offsets there is nothing to map a selection back onto. Full guide:
**[Headless](./docs/headless.md)**.

## Testing without a device

```ts
import {
  parseMockMarkdown,
  simulateCopyAsMarkdown,
} from "react-native-nitro-markdown/testing";
```

`parseMockMarkdown` stands in for md4c with real source offsets, matching it on
CRLF input, loose lists, setext headings, and thematic breaks and tables that
interrupt a paragraph. `simulateCopyAsMarkdown` drives a rendered host the way
a native host would, and takes any instance with `props` and `children` — so
react-test-renderer and `@testing-library/react-native` both work and neither
becomes a dependency. Known gap: the mock is not md4c, so these suites do not
prove the *native* parser handles your markup; that proof comes from the C++
conformance suite and on-device passes.

## Source AST rendering

Already have a `MarkdownNode`? Pass it via `sourceAst` to skip native parsing
on render:

```tsx
<Markdown sourceAst={ast}>{"# Cached AST"}</Markdown>
```

When `sourceAst` is provided, `beforeParse` plugins are skipped because parsing
already happened. `afterParse` plugins and `astTransform` still run.

## Theming & customization

Because every node renders as a real React Native component, you can restyle
the whole document, tweak a single node type, or replace a renderer outright:

```tsx
import { Markdown, darkMarkdownTheme } from "react-native-nitro-markdown";

// 1. Swap the whole theme — built-in dark preset (or any partial theme)
<Markdown theme={darkMarkdownTheme}>{content}</Markdown>;

// 2. Override individual node styles (layered on top of the theme)
<Markdown styles={{ heading: { color: "#7c3aed" }, code_block: { borderRadius: 16 } }}>
  {content}
</Markdown>;

// 3. Replace a renderer entirely
<Markdown renderers={{ blockquote: MyCallout }}>{content}</Markdown>;
```

Presets: `defaultMarkdownTheme`, `darkMarkdownTheme`, `minimalMarkdownTheme` (or
`stylingStrategy="minimal"`). Compose with `mergeThemes`. In `selectable` mode,
view-only style properties are dropped inside runs — see the presentation
trade-off above. Full guide: **[Customization](./docs/customization.md)**.

## Common options

Rows marked ★ are fork additions.

| Prop / option | Default | What it does |
| ------------- | ------- | ------------ |
| `options.gfm` | `true` | Tables, strikethrough, task lists, autolinks. |
| `options.math` | `true` | Inline and block math nodes. Rendered as monospace text — this fork ships no math typesetting engine and needs no extra native dependency. |
| `options.html` | `false` | Preserve raw HTML nodes for custom renderers. |
| `options.sourceOffsets` | `true` | Emit per-node `beg`/`end` source offsets as JavaScript UTF-16 indices, matching `String.length` and `String.slice`. Set `false` for one-shot headless parses to shrink the AST (the native parser skips the offset map entirely). Required for selection mapping. |
| `options.maxInputLength` | `10000000` | Maximum accepted input length in characters. Oversized inputs fail with a typed `input_too_large` error instead of being parsed. |
| `parseCache` | `true` | Reuse parsed ASTs for repeated content. Scoped per `<Markdown>` instance (max 32 entries); hit/miss/eviction counters are reported via `onParseComplete`'s `cacheStats`. |
| `sourceAst` | `undefined` | Render a pre-parsed AST instead of parsing `children`. |
| `onError` | `undefined` | Receive parser and plugin failures as `(error, phase, pluginName?)`. Native parse and session failures are typed `MarkdownError`s with stable `code` and `source`. |
| `errorText` | `"Error parsing markdown"` | Localized text rendered when parsing fails. |
| `imageOptions` | `undefined` | Image URL policy: `allowedProtocols`, `allowedHosts`, and `remoteImages: "deny"` to block remote image loading entirely. |
| `highlightCode` | `false` | Built-in code syntax highlighting (fixture-backed languages: JS/TS family, Python, shell). |
| `virtualize` | `false` | Virtualize top-level blocks for long documents. Mutually exclusive with `selectable`. |
| ★ `selectable` | `false` | Render adjacent flowing blocks as selectable runs: one selection can span a heading, paragraphs, lists and blockquotes; it stops at standalone blocks. |
| ★ `classifyBlock` | `undefined` | Consumer classification of top-level blocks — return `"standalone"` to register app-specific standalone blocks. Read during render, so keep its identity stable. |
| ★ `onCopyAsMarkdown` | `undefined` | Receives the markdown source for exactly the range the reader selected. Requires a native `runHost` — the default host reports no selection range, so this never fires without one. |
| ★ `smartPunctuation` | `false` | Typographic quotes/dashes/ellipses, applied as a render-time transform over parsed text (never a pre-parse plugin, so incremental streaming stays intact). |
| ★ `textPrimitive` / `runHost` | `RunText` / `SelectableRunHost` | The injectable inline text primitive and the selectable host a run renders into. Define both at module scope. |

See **[Usage](./docs/usage.md)** for the full prop table and
**[Customization](./docs/customization.md)** for themes, per-node styles,
custom renderers, and plugins.

## Fork exports

On top of upstream's exports:

```ts
import {
  classifyBlock,          // default block classifier (extend via the prop)
  assembleRuns,           // blocks -> runs
  mapSelectionToSource,   // rendered range + spans -> source range
  RunText, sourceRangeOf, // inline primitive and its annotation reader
  SelectableRunHost,      // default host
  RunFlowContext, useInRunFlow,
  smartenText,
  useIncrementalMarkdownAst,
} from "react-native-nitro-markdown";
```

Types: `BlockClass`, `ClassifyBlock`, `RunPart`, `AnnotatedSpan`,
`MappedSourceRange`, `RunTextProps`, `SourceRange`, `RunHostSelection`,
`SelectableRunHostProps`.

## Performance

Parsing a ~320 KB document (example app, iOS Simulator; ratios are stable) —
upstream's numbers, unchanged by this fork, which touches rendering only:

| Parser | Time | vs Nitro |
| ------ | ---- | -------- |
| **Nitro (C++)** | **~41 ms** | — |
| CommonMark (JS) | ~113 ms | ~2.8× |
| Markdown-It (JS) | ~184 ms | ~4.5× |
| Marked (JS) | ~814 ms | ~19.8× |

Reproduce it: run the example app and tap **Run Benchmark**. Methodology and a
full capability matrix: **[Comparison & benchmarks](./docs/comparison.md)**.

## Security

- Parse input is bounded: the JavaScript boundary rejects documents above
  `options.maxInputLength` (default 10M characters) with a typed error, and the
  C++ parser enforces the same hard cap in bytes plus a 64 MB JSON output cap.
- Custom `onLinkPress` handlers receive the original href so apps can handle
  routes and custom schemes. The built-in `Linking` fallback opens only
  validated HTTP(S), mail, and telephone URLs. Remote images load by default
  for compatibility — set `imageOptions={{ remoteImages: "deny" }}` (and/or
  `allowedHosts`) when rendering untrusted markdown in privacy- or
  SSRF-sensitive apps.
- The C++ parser is fuzzed with a seeded, deterministic corpus and checked
  against a CommonMark/GFM conformance corpus in `bun run check`.

See [SECURITY.md](./SECURITY.md). **Report vulnerabilities upstream** — this
fork changes rendering, not the parser or the URL policy.

## Documentation

| Guide | What's inside |
| ----- | ------------- |
| [Selectable runs](./docs/selectable-runs.md) | ★ Runs, classification, range mapping, host contract, testing. |
| [Installation](./docs/installation.md) | Expo & bare RN setup, requirements, platforms. |
| [Usage](./docs/usage.md) | `<Markdown>`, props, elements, virtualization, source AST. |
| [Streaming](./docs/streaming.md) | Token-by-token LLM / chat rendering. |
| [Headless](./docs/headless.md) | Parse to AST, plain-text extraction. |
| [Customization](./docs/customization.md) | Themes, dark mode, per-node styles, renderers, plugins. |
| [Comparison & benchmarks](./docs/comparison.md) | Why Nitro, parse benchmarks, capability matrix. |
| [API reference](./docs/api-reference.md) | Full export and type listing. |
| [Security policy](./SECURITY.md) | Supported versions, link/image policy, reporting. |
| [Changelog](./CHANGELOG.md) | Package changes by version; fork releases are `0.11.0-superpower.*`. |
| [Troubleshooting](./docs/troubleshooting.md) | Common install and runtime issues. |

## Compatibility

| Dependency | Supported |
| ---------- | --------- |
| [React Native](https://reactnative.dev/) | `>=0.75` (New Architecture) |
| [Nitro Modules](https://www.npmjs.com/package/react-native-nitro-modules) | `>=0.36.5 <0.37.0` |
| [Expo](https://docs.expo.dev/) | SDK 57 development builds |
| Platforms | iOS, Android (Web not supported) |

## Contributing

```sh
bun install
bun run check          # lint + typecheck + tests (JS and C++)
bun run example:ios    # run the example app — see the Selectable Runs screen
```

Fixes that are not selection-specific belong
[upstream](https://github.com/JoaoPauloCMarra/react-native-nitro-markdown);
please send them there so both benefit. Keep this fork rebased on upstream
`main` rather than diverging. Run native example builds before releasing when
changing native, Nitro, rendering, or packaging files.

## Credits & license

Upstream library by [João Paulo C. Marra](https://github.com/JoaoPauloCMarra);
parsing by [md4c](https://github.com/mity/md4c); native bridge by
[Nitro Modules](https://nitro.margelo.com/). Selectable runs and the fork
changes listed above by [unDemian](https://github.com/unDemian).

[MIT](./LICENSE), same as upstream.
