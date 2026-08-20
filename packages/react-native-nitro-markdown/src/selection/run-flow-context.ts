import { createContext, useContext } from "react";

/**
 * True while rendering inside a run's selectable host. Block renderers
 * consult this to emit text spans (one continuous span tree per run) instead
 * of their standalone view layout. There is exactly one rendering path per
 * mode — a run renders the same way whether or not a stream is in flight.
 */
export const RunFlowContext = createContext(false);

export const useInRunFlow = (): boolean => useContext(RunFlowContext);

/**
 * Returns the latest markdown source for the document being rendered.
 * Provided as a stable function reading a ref, so that consuming it never
 * forces settled runs to re-render as streamed source grows.
 */
export const RunSourceContext = createContext<() => string>(() => "");
