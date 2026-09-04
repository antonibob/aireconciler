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
  }
}

if (window.Office?.onReady) {
  window.Office.onReady((info) => {
    console.info("[AI Closer] Office ready:", String((info as { host?: string }).host ?? "?"));
    mount();
  });
} else {
  mount(); // browser demo
}