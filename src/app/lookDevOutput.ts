// FINAL-FIXES-08: which LookDev mode the application is left in when a final render (or another output) starts.

export type OutputPreviewMode = 'navigation' | 'fast' | 'still' | 'interactive' | 'live' | 'live2';

/**
 * Progressive Interactive LookDev keeps its own graphics device, kept surfaces and a running loop. The artist found that a final render
 * with it selected was much slower, and that switching to Still Image LookDev by hand restored the normal speed. So a final render
 * starts by leaving the progressive mode for the still mode; every other mode is left alone. The artist returns to Progressive LookDev by choice.
 */
/** How long a final render must have been over before the program goes back to the mode it left (a queue of jobs has short gaps between them that must not count). */
export const RETURN_AFTER_OUTPUT_MS = 1500;
/**
 * The mode to go back to when a final render is over: the one the artist worked in before it, but only if the program is still in the mode the render switched it to
 * (the artist has not chosen something else meanwhile). Nothing to return to: null.
 */
export function modeAfterOutput(before: OutputPreviewMode | '', now: OutputPreviewMode): OutputPreviewMode | null {
  return before && before !== now && modeForOutput(before) === now ? before : null;
}

export function modeForOutput(mode: OutputPreviewMode): OutputPreviewMode {
  return mode === 'interactive' || mode === 'live' || mode === 'live2' ? 'still' : mode;
}
