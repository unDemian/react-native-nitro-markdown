import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { MarkdownNode } from "../headless";
import { useIncrementalMarkdownAst } from "../use-incremental-markdown";

const capturedAsts: (MarkdownNode | null)[] = [];

function Probe({ text }: { text: string }) {
  capturedAsts.push(useIncrementalMarkdownAst(text));
  return null;
}

describe("useIncrementalMarkdownAst", () => {
  beforeEach(() => {
    capturedAsts.length = 0;
  });

  it("keeps settled block identity while a stream appends, so settled runs never re-render", () => {
    const settled = "Settled paragraph.\n\nTail starts";

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<Probe text={settled} />);
    });
    act(() => {
      renderer!.update(<Probe text={`${settled} and grows.`} />);
    });

    const [first, second] = capturedAsts;
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // The settled paragraph node is the same object across the append…
    expect(second!.children?.[0]).toBe(first!.children?.[0] as MarkdownNode);
    // …while the growing tail is a new node.
    expect(second!.children?.[1]).not.toBe(first!.children?.[1] as MarkdownNode);
  });

  it("recovers with a full parse when the text is not an append", () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<Probe text={"Alpha."} />);
    });
    act(() => {
      renderer!.update(<Probe text={"Completely different."} />);
    });

    const second = capturedAsts[1];
    expect(second).not.toBeNull();
    expect(second!.children?.[0]?.children?.[0]?.content).toBe(
      "Completely different.",
    );
  });
});
