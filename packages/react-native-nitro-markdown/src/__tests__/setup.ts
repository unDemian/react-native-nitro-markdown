import { parseMockMarkdown } from "../testing/mock-native-parser";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

type MockParserOptions = {
  gfm?: boolean;
  math?: boolean;
  html?: boolean;
  sourceOffsets?: boolean;
};

function serializeMockAst(text: string, includeOffsets: boolean): string {
  return JSON.stringify(parseMockMarkdown(text, includeOffsets));
}

const mockParser = {
  parse: jest.fn((text: string) => serializeMockAst(text, true)),
  parseWithOptions: jest.fn((text: string, options: MockParserOptions) =>
    serializeMockAst(text, options.sourceOffsets !== false),
  ),
  extractPlainText: jest.fn((text: string) => text),
  extractPlainTextWithOptions: jest.fn((text: string, _options: MockParserOptions) => text),
};

function createMockSession() {
  let buffer = "";
  let highlightPosition = 0;
  let isDisposed = false;
  const listeners = new Map<number, (from: number, to: number) => void>();
  let nextListenerId = 0;

  const assertActive = () => {
    if (isDisposed) {
      throw new Error("HybridMarkdownSession is destroyed");
    }
  };

  const notify = (from: number, to: number) => {
    for (const listener of listeners.values()) {
      listener(from, to);
    }
  };

  return {
    append: jest.fn((chunk: string) => {
      assertActive();
      const from = buffer.length;
      buffer += chunk;
      notify(from, buffer.length);
      return buffer.length;
    }),
    clear: jest.fn(() => {
      assertActive();
      buffer = "";
      highlightPosition = 0;
      notify(0, 0);
    }),
    dispose: jest.fn(() => {
      isDisposed = true;
      listeners.clear();
      buffer = "";
      highlightPosition = 0;
    }),
    getAllText: jest.fn(() => {
      assertActive();
      return buffer;
    }),
    getLength: jest.fn(() => {
      assertActive();
      return buffer.length;
    }),
    getTextRange: jest.fn((from: number, to: number) => {
      assertActive();
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < 0 || from > to) {
        return "";
      }
      const start = Math.max(0, Math.min(Math.trunc(from), buffer.length));
      const end = Math.max(start, Math.min(Math.trunc(to), buffer.length));
      return buffer.slice(start, end);
    }),
    get highlightPosition() {
      return highlightPosition;
    },
    set highlightPosition(value: number) {
      assertActive();
      highlightPosition = value;
    },
    reset: jest.fn((text: string) => {
      assertActive();
      buffer = text;
      highlightPosition = 0;
      notify(0, buffer.length);
    }),
    replace: jest.fn((from: number, to: number, text: string) => {
      assertActive();
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < 0 || from > to) {
        throw new Error(
          `Invalid range: from=${from} and to=${to} must be finite, from must be >= 0, and to must be >= from`,
        );
      }
      const start = Math.max(0, Math.min(Math.trunc(from), buffer.length));
      const end = Math.max(start, Math.min(Math.trunc(to), buffer.length));
      buffer = `${buffer.slice(0, start)}${text}${buffer.slice(end)}`;
      notify(start, start + text.length);
      return buffer.length;
    }),
    addListener: jest.fn((listener: (from: number, to: number) => void) => {
      assertActive();
      const id = nextListenerId++;
      listeners.set(id, listener);
      return () => {
        listeners.delete(id);
      };
    }),
  };
}

jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn((name: string) =>
      name === "MarkdownSession" ? createMockSession() : mockParser,
    ),
  },
}));

jest.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  FlatList: "FlatList",
  ScrollView: "ScrollView",
  PanResponder: {
    create: jest.fn((handlers) => ({ panHandlers: handlers })),
  },
  Image: {
    getSize: jest.fn(),
  },
  Linking: {
    canOpenURL: jest.fn(),
    openURL: jest.fn(),
  },
  StyleSheet: {
    create: (obj: Record<string, unknown>) => obj,
    flatten: (obj: unknown) => obj,
  },
  Platform: {
    OS: "ios",
    select: (obj: Record<string, unknown>) => obj.ios,
  },
}));

export { mockParser };
