import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import "./index.css";
import { App } from "./App";

// ── Sentry (gated on SENTRY_DSN) ─────────────────────────────────────────────
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}

// Keep <html lang> in sync with the player's saved language so mobile
// browsers / screen readers / hyphenation use the right locale.
try {
  const saved = localStorage.getItem("lang");
  if (saved === "tr" || saved === "th" || saved === "en") document.documentElement.lang = saved;
} catch {
  /* ignore */
}

// Block Chrome's right-click menu everywhere in the app so right-click can
// be used for camera orbit / game actions. Allows it only inside <input> /
// <textarea> so users can still paste/cut text.
document.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement | null;
  if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;
  e.preventDefault();
});

// Global click sfx for any <button> in the UI — tactile feedback.
// Lazy-loaded so AudioContext only initializes on first user interaction.
document.addEventListener("pointerdown", (e) => {
  const t = e.target as HTMLElement | null;
  if (!t) return;
  const btn = t.closest("button");
  if (!btn) return;
  // Skip rapid-fire elements (sliders / range)
  if (btn.querySelector("input[type=range]")) return;
  import("./sfx/sfx").then((m) => m.Sfx?.click?.()).catch(() => {});
}, { capture: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
