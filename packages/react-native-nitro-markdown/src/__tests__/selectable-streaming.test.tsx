import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import type { CustomRendererProps } from "../MarkdownContext";
import { Markdown, type MarkdownPlugin } from "../markdown";
import {
  SelectableRunHost,
  type SelectableRunHostProps,
} from "../selection/selectable-run-host";
import {
  getRenderedRunText,
  simulateCopyAsMarkdown,
} from "../testing/run-host-simulation";

const NativeHostStub: React.FC<SelectableRunHostProps> = (props) => (
  <SelectableRunHost {...props} />
);

const findHosts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(SelectableRunHost);

const rendersOf = (
  spy: jest.Mock,
  predicate: (content: string) => boolean,
): number =>
  spy.mock.calls.filter((call) =>
    predicate((call[0] as CustomRendererProps).node.content ?? ""),
  ).length;

// A stable renderers object, so the only thing under test is what the
// component itself does with identity.
const spyTextRenderer = jest.fn(() => undefined);
const renderers = { text: spyTextRenderer };

const SETTLED = "Settled paragraph.\n\n```\ncode\n```\n\nTail starts";

describe("what a streamed chunk re-renders", () => {
  beforeEach(() => {
    spyTextRenderer.mockClear();
  });

  it("re-renders only the growing tail when markdown arrives as children", () => {
    // The obvious way to stream: hold the text in state and pass it as
    // children. Nothing here hand-wires a pre-parsed tree, so the node
    // identity that the run memo compares has to come from the component.
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <Markdown selectable renderers={renderers}>
          {SETTLED}
        </Markdown>,
      );
    });
    act(() => {
      renderer!.update(
        <Markdown selectable renderers={renderers}>
          {`${SETTLED} and grows.`}
        </Markdown>,
      );
    });

    expect(rendersOf(spyTextRenderer, (c) => c === "Settled paragraph.")).toBe(
      1,
    );
    expect(
      rendersOf(spyTextRenderer, (c) => c.startsWith("Tail starts")),
    ).toBeGreaterThanOrEqual(2);
  });

  it("re-renders nothing when the same markdown arrives twice", () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <Markdown selectable renderers={renderers}>
          {SETTLED}
        </Markdown>,
      );
    });
    const settledRenders = spyTextRenderer.mock.calls.length;
    act(() => {
      renderer!.update(
        <Markdown selectable renderers={renderers}>
          {SETTLED}
        </Markdown>,
      );
    });

    expect(spyTextRenderer.mock.calls.length).toBe(settledRenders);
  });

  it("survives a consumer passing gesture callbacks as inline arrows", () => {
    // The example app's own pattern. A callback that changes identity every
    // render used to rebuild the context value, which re-renders every node of
    // the document — on each streamed chunk.
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <Markdown
          selectable
          runHost={NativeHostStub}
          renderers={renderers}
          onCopyAsMarkdown={() => {}}
          onLinkPress={() => {}}
        >
          {SETTLED}
        </Markdown>,
      );
    });
    const settledRenders = spyTextRenderer.mock.calls.length;
    act(() => {
      renderer!.update(
        <Markdown
          selectable
          runHost={NativeHostStub}
          renderers={renderers}
          onCopyAsMarkdown={() => {}}
          onLinkPress={() => {}}
        >
          {SETTLED}
        </Markdown>,
      );
    });

    expect(spyTextRenderer.mock.calls.length).toBe(settledRenders);
  });

  it("calls the newest inline callback, not the one from the first render", () => {
    const first = jest.fn();
    const second = jest.fn();
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <Markdown selectable runHost={NativeHostStub} onCopyAsMarkdown={first}>
          {"Body text."}
        </Markdown>,
      );
    });
    act(() => {
      renderer!.update(
        <Markdown selectable runHost={NativeHostStub} onCopyAsMarkdown={second}>
          {"Body text."}
        </Markdown>,
      );
    });

    const host = findHosts(renderer!)[0]!;
    simulateCopyAsMarkdown(host, { start: 0, end: 4 });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("Body");
  });
});

describe("the source that Copy as Markdown slices", () => {
  it("slices the text the parse offsets actually index", () => {
    // A before-parse plugin that changes the source's length shifts every
    // offset. Slicing the untransformed children would hand the reader a
    // displaced substring, with nothing to signal it.
    const plugins: MarkdownPlugin[] = [
      { name: "strip-markers", beforeParse: (md) => md.replace(/@@/g, "") },
    ];
    const onCopyAsMarkdown = jest.fn();

    const renderer = ((): ReactTestRenderer => {
      let created: ReactTestRenderer | undefined;
      act(() => {
        created = TestRenderer.create(
          <Markdown
            selectable
            runHost={NativeHostStub}
            plugins={plugins}
            onCopyAsMarkdown={onCopyAsMarkdown}
          >
            {"@@Hello world"}
          </Markdown>,
        );
      });
      return created!;
    })();

    const host = findHosts(renderer)[0]!;
    const renderedText = getRenderedRunText(host);
    expect(renderedText).toBe("Hello world");

    simulateCopyAsMarkdown(host, {
      start: renderedText.indexOf("world"),
      end: renderedText.length,
    });

    expect(onCopyAsMarkdown).toHaveBeenCalledWith("world");
  });
});

describe("telling a consumer that Copy as Markdown needs a native host", () => {
  it("warns when a copy handler is set without one", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      act(() => {
        TestRenderer.create(
          <Markdown selectable onCopyAsMarkdown={() => {}}>
            {"Body."}
          </Markdown>,
        );
      });

      expect(
        warn.mock.calls.filter((call) =>
          String(call[0]).includes("onCopyAsMarkdown will never fire"),
        ),
      ).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("warns when a copy handler is set on a document that is not selectable", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      act(() => {
        TestRenderer.create(
          <Markdown onCopyAsMarkdown={() => {}}>{"Body."}</Markdown>,
        );
      });

      expect(
        warn.mock.calls.filter((call) =>
          String(call[0]).includes("selectable is not"),
        ),
      ).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("stays quiet once a host is supplied", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      act(() => {
        TestRenderer.create(
          <Markdown
            selectable
            runHost={NativeHostStub}
            onCopyAsMarkdown={() => {}}
          >
            {"Body."}
          </Markdown>,
        );
      });

      expect(
        warn.mock.calls.filter((call) =>
          String(call[0]).includes("onCopyAsMarkdown will never fire"),
        ),
      ).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});
