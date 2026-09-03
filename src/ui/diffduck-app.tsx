import { App } from "@modelcontextprotocol/ext-apps";
import { useEffect, useRef, useState } from "react";
import { toolContracts } from "../protocol/diffduck.js";
import { DiscussionController } from "./discussion-controller.js";
import { DiffDuckBridge } from "./diffduck-bridge.js";
import { parseDiffDuckToolResult } from "./diffduck-tool-result.js";
import { AppLifetime } from "./app-lifetime.js";
import { ReviewSurface, type HostView } from "./review-surface.js";
import duckIcon from "../../assets/diffduck-icon.svg";

const initialHost: HostView = { theme: "light", fullscreen: false, canFullscreen: false, interactive: false, demo: false };

function viewRuntime() {
  return {
    newUuid: () => crypto.randomUUID(), nowMs: () => Date.now(),
    schedule: (delay: number, callback: () => void) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
  };
}

/** Connect a single mounted review to its originating Codex task, with owned setup and teardown. */
export function DiffDuckApp() {
  const [controller, setController] = useState<DiscussionController | null>(null);
  const [host, setHost] = useState<HostView>(initialHost);
  const [message, setMessage] = useState<string | null>(null);
  const appRef = useRef<App | null>(null);
  const lifetimeRef = useRef<AppLifetime | null>(null);

  useEffect(() => {
    let activeController: DiscussionController | undefined;
    let app: App | undefined;
    const lifetime = new AppLifetime(() => setMessage("DiffDuck could not connect to the host. Existing examples and drafts have been kept."));
    lifetimeRef.current = lifetime;
    const visibilityChanged = () => activeController?.setVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibilityChanged);
    const applyTheme = (theme: "light" | "dark") => { document.documentElement.style.colorScheme = theme; document.documentElement.dataset.theme = theme; };

    lifetime.run(async (signal) => {
      app = new App({ name: "DiffDuck", version: "0.2.0" }, { availableDisplayModes: ["inline", "fullscreen"] });
      appRef.current = app;
      activeController = new DiscussionController(new DiffDuckBridge(app), viewRuntime());
      const syncHost = () => {
        if (signal.aborted || app === undefined) return;
        const context = app.getHostContext(); const capabilities = app.getHostCapabilities();
        const theme = context?.theme ?? "light"; applyTheme(theme);
        setHost({ theme, fullscreen: context?.displayMode === "fullscreen", canFullscreen: context?.availableDisplayModes?.includes("fullscreen") ?? false,
          interactive: capabilities?.serverTools !== undefined && capabilities.message?.text !== undefined, demo: false });
      };
      app.addEventListener("toolresult", (result) => {
        if (signal.aborted) return;
        const parsed = parseDiffDuckToolResult("show_diffduck_review", result, toolContracts.show_diffduck_review.output);
        if (parsed._tag === "Ok") { activeController?.accept(parsed.value); setMessage(null); }
        else setMessage(parsed.error.message);
      });
      app.addEventListener("hostcontextchanged", syncHost);
      await app.connect(undefined, { signal });
      if (signal.aborted) return;
      syncHost(); setController(activeController);
    });
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      activeController?.dispose(); appRef.current = null;
      lifetime.dispose(async () => { await activeController?.settled(); await app?.close(); });
      lifetimeRef.current = null;
    };
  }, []);

  const toggleFullscreen = () => lifetimeRef.current?.run(async (signal) => {
    const app = appRef.current; if (app === null) return;
    const result = await app.requestDisplayMode({ mode: host.fullscreen ? "inline" : "fullscreen" }, { signal });
    if (!signal.aborted) setHost((current) => ({ ...current, fullscreen: result.mode === "fullscreen" }));
  });

  if (controller === null) return <main className="diffduck-empty"><img src={duckIcon} width="64" height="64" alt="DiffDuck duck" /><h1>DiffDuck</h1><p>{message ?? "Preparing a better conversation about code…"}</p></main>;
  return <ReviewSurface controller={controller} host={host} message={message} onFullscreen={toggleFullscreen} />;
}
