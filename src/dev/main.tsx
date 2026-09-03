import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { OpenReview } from "../domain/commands.js";
import { exampleReview } from "../testing/fixtures.js";
import type { ViewRuntime } from "../ui/discussion-controller.js";
import { AppLifetime } from "../ui/app-lifetime.js";
import { DevelopmentSession } from "./development-session.js";
import { WorkbenchApp } from "./workbench-app.js";
import "../ui/styles.css";
import "./workbench.css";

// This entrypoint, not a React effect, owns the session. Fast Refresh may rerun
// effects in UI components without stopping polling or discarding their drafts.
const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Missing DiffDuck workbench root");
const root = createRoot(rootElement);
const runtime: ViewRuntime = {
  newUuid: () => crypto.randomUUID(), nowMs: () => Date.now(),
  schedule: (delay, callback) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
};
const opened = DevelopmentSession.open(exampleReview(), runtime);
if (opened._tag === "Err") throw new Error("Invalid development fixture");
let session = opened.value;
const lifetime = new AppLifetime(() => { console.error("DiffDuck development cleanup failed."); });

function replaceReview(review: OpenReview): string | null {
  const next = DevelopmentSession.open(review, runtime);
  if (next._tag === "Err") return next.error.message;
  next.value.setReplyMode(session.getSnapshot().replyMode);
  const previous = session;
  previous.dispose();
  lifetime.run(async () => previous.settled());
  session = next.value;
  visibilityChanged();
  render();
  return null;
}
function render() { root.render(<StrictMode><WorkbenchApp session={session} replaceReview={replaceReview} /></StrictMode>); }
function visibilityChanged() { session.controller.setVisible(!document.hidden); }
function pageHidden(event: PageTransitionEvent) { if (!event.persisted) dispose(); }
function dispose() {
  document.removeEventListener("visibilitychange", visibilityChanged);
  window.removeEventListener("pagehide", pageHidden);
  root.unmount(); session.dispose();
  lifetime.dispose(async () => session.settled());
}
document.addEventListener("visibilitychange", visibilityChanged);
window.addEventListener("pagehide", pageHidden);
import.meta.hot?.dispose(dispose);
visibilityChanged(); render();
