/**
 * The manifest's FunctionFile.
 *
 * Office loads this page in a hidden frame to host any ExecuteFunction ribbon
 * commands. Our only ribbon button opens the task pane directly, so there is
 * nothing to register yet — but the page must exist and must reach Office.onReady,
 * or Office reports the add-in's command surface as broken.
 *
 * This is deliberately a stub. It used to be a second full bundle of the React
 * task pane, which shipped about a megabyte of dead JavaScript and mounted the
 * whole UI in a frame nobody sees.
 */

declare const Office: { onReady(cb: () => void): void } | undefined;

if (typeof Office !== "undefined") {
  Office.onReady(() => {
    /* No ExecuteFunction commands registered. */
  });
}
