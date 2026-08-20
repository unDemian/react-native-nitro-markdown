/**
 * Test-only entry point (`react-native-nitro-markdown/testing`).
 *
 * Consumers' test suites run the real JavaScript library with the native
 * parser replaced by `parseMockMarkdown`, and drive selection through the
 * host simulation helpers — the same seam the library's own suites use.
 * Never import this from production code.
 */
export { parseMockMarkdown } from "./mock-native-parser";
export {
  extractAnnotatedSpans,
  getRenderedRunText,
  simulateCopyAsMarkdown,
  type RenderedInstance,
} from "./run-host-simulation";
