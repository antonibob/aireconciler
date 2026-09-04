import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

/** Mount the React taskpane. */
function mount() {
  const el = document.getElementById("root");
  if (el) {
    createRoot(el).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }
}

/** Dual-mode bootstrap:
 *  - Inside Office: wait for Office.onReady (Excel globals available).
 *  - Plain browser demo: no Office.js loaded, render immediately.
 */
declare global {
  interface Window {
    Office?: { onReady(cb: (info: unknown) => void): void };
    Excel?: {
      run(context: unknown, cb: (ctx: ExcelContext) => Promise<unknown>): Promise<unknown>;
    };
  }
}

// Minimal structural Excel context used at runtime.
export interface ExcelContext {
  workbook: {
    getActiveCell(): { address: string; values: Array<Array<unknown>>; values2?: never };
  };
  sync(): Promise<void>;
}

if (window.Office?.onReady) {
  window.Office.onReady((info) => {
    console.info("[AI Closer] Office ready:", String((info as { host?: string }).host ?? "?"));
    mount();
  });
} else {
  mount(); // browser demo
}