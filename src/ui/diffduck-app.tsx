import { App } from "@modelcontextprotocol/ext-apps";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toolContracts } from "../protocol/diffduck.js";
import type { QuestionId, QuestionTarget, ScenarioDiscussion } from "../domain/discussion.js";
import { CodeComparison } from "./code-comparison.js";
import { DiscussionPanel } from "./discussion-panel.js";
import { DiscussionController } from "./discussion-controller.js";
import { DiffDuckBridge } from "./diffduck-bridge.js";
import { AppLifetime } from "./app-lifetime.js";
import { usePreservedScroll } from "./use-preserved-scroll.js";
import duckIcon from "../../assets/diffduck-icon.svg";

type HostView = { readonly theme: "light" | "dark"; readonly fullscreen: boolean; readonly canFullscreen: boolean; readonly interactive: boolean; readonly demo: boolean };
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
    let disposeDemo: (() => void) | undefined;
    const lifetime = new AppLifetime(() => setMessage("DiffDuck could not connect to the host. Existing examples and drafts have been kept."));
    lifetimeRef.current = lifetime;
    const visibilityChanged = () => activeController?.setVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibilityChanged);
    const applyTheme = (theme: "light" | "dark") => { document.documentElement.style.colorScheme = theme; document.documentElement.dataset.theme = theme; };

    lifetime.run(async (signal) => {
      if (import.meta.env.DEV && window.parent === window) {
        const { createDemo } = await import("./demo.js");
        if (signal.aborted) return;
        const demo = createDemo(); disposeDemo = demo.dispose;
        activeController = new DiscussionController(demo.port, viewRuntime());
        activeController.accept(demo.snapshot);
        const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        applyTheme(theme); setHost({ theme, fullscreen: false, canFullscreen: false, interactive: true, demo: true });
        setController(activeController); return;
      }
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
        const parsed = toolContracts.show_diffduck_review.output.safeParse(result.structuredContent);
        if (parsed.success && parsed.data._tag === "Ok") activeController?.accept(parsed.data.value);
      });
      app.addEventListener("hostcontextchanged", syncHost);
      await app.connect(undefined, { signal });
      if (signal.aborted) return;
      syncHost(); setController(activeController);
    });
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      activeController?.dispose(); disposeDemo?.(); appRef.current = null;
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

function ReviewSurface({ controller, host, message, onFullscreen }: { readonly controller: DiscussionController; readonly host: HostView; readonly message: string | null; readonly onFullscreen: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const select = useCallback((target: QuestionTarget) => { setSelectionMessage(null); controller.selectLines(target); }, [controller]);
  const ask = useCallback(() => { controller.setIntent("ask"); composerRef.current?.focus(); }, [controller]);
  const explore = useCallback(() => { controller.setIntent("explore-alternative"); composerRef.current?.focus(); }, [controller]);
  const focusQuestion = useCallback((id: QuestionId) => controller.focusQuestion(id), [controller]);
  const invalidSelection = useCallback(() => setSelectionMessage("Choose a line range on one side of the comparison."), []);
  const review = state.session?.review;
  const active = state.session?.scenarios.find((scenario) => scenario.scenarioId === state.activeScenarioId);
  const tab = active === undefined ? undefined : state.tabs.get(active.scenarioId);
  const exampleScroll = usePreservedScroll(`${active?.scenarioId ?? ""}:${tab?.displayedRevisionId ?? ""}`);
  if (review === undefined || active === undefined || tab === undefined) return <main className="diffduck-empty"><img src={duckIcon} width="64" height="64" alt="DiffDuck duck" /><h1>Waiting for the comparison</h1><p>Codex will open this surface with complete before-and-after examples.</p></main>;
  const revision = active.revisions.find((item) => item.id === tab.displayedRevisionId);
  if (revision === undefined) return <p role="alert">The displayed revision is unavailable.</p>;
  const disabled = !host.interactive || state.connection === "unavailable";
  const titleOf = (scenario: ScenarioDiscussion) => scenario.revisions[0]?.scenario.title ?? "Example";

  return <main className={`diffduck-shell${host.fullscreen ? " is-fullscreen" : ""}`}>
    <header className="app-header"><div className="brand-lockup"><img src={duckIcon} alt="" width="40" height="40" /><div><strong className="brand-name">DiffDuck</strong><span className="brand-caption">Talk through the change.</span></div></div>
      <div className="header-actions"><span className="connection-chip"><span className="status-dot" />{state.connection === "unavailable" ? "Session unavailable" : host.demo ? "Demo · simulated replies" : host.interactive ? "Connected to this Codex task" : "Read-only connection"}</span><span className="repository-chip">{review.repository}</span>{host.canFullscreen ? <button className="icon-button" type="button" onClick={onFullscreen} aria-label={host.fullscreen ? "Exit fullscreen" : "Open fullscreen"}>⤢</button> : null}</div>
    </header>
    <section className="review-summary"><div><p className="eyebrow">{review.mode === "review" ? "Change review" : "API design discussion"}</p><h1>{review.title}</h1><p>{review.summary}</p></div><div className="revision-line"><span>{review.base ?? "Before"}</span><span aria-hidden="true">→</span><span>{review.head ?? "After"}</span></div></section>
    {message !== null || state.message !== null || !host.interactive ? <p className="surface-notice" role="status">{message ?? state.message ?? "This host can display examples but does not expose the required discussion capabilities."}</p> : null}
    <nav className="scenario-tabs" aria-label="Examples" role="tablist">{state.session?.scenarios.map((scenario, index) => {
      const view = state.tabs.get(scenario.scenarioId);
      return <button role="tab" tabIndex={active.scenarioId === scenario.scenarioId ? 0 : -1} aria-selected={active.scenarioId === scenario.scenarioId} aria-controls={active.scenarioId === scenario.scenarioId ? `scenario-${scenario.scenarioId}` : undefined} id={`tab-${scenario.scenarioId}`} key={scenario.scenarioId} type="button" className={active.scenarioId === scenario.scenarioId ? "is-active" : ""}
        onClick={() => { controller.selectTab(scenario.scenarioId); setSelectionMessage(null); }}
        onKeyDown={(event) => {
          if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); const scenarios = state.session?.scenarios ?? [];
          const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? scenarios.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + scenarios.length) % scenarios.length;
          const next = scenarios[nextIndex];
          if (next !== undefined) { controller.selectTab(next.scenarioId); document.getElementById(`tab-${next.scenarioId}`)?.focus(); }
        }}><span className="tab-index">{String(index + 1).padStart(2, "0")}</span>{titleOf(scenario)}{(view?.unreadAnswers ?? 0) > 0 ? <span className="unread-count" aria-label={`${view?.unreadAnswers} unread answers`}>{view?.unreadAnswers}</span> : view?.draft.text ? <span className="draft-dot" aria-label="Has a draft" /> : null}</button>;
    })}</nav>
    <div className="review-workspace" role="tabpanel" id={`scenario-${active.scenarioId}`} aria-labelledby={`tab-${active.scenarioId}`}>
      <div className="example-column" ref={exampleScroll.ref} onScroll={exampleScroll.onScroll}><div className="scenario-intro"><div><h2>{revision.scenario.title}</h2><p>{revision.scenario.description}</p></div>
        <label className="revision-picker">Example <select aria-label="Displayed example revision" value={revision.id} onChange={(event) => { const next = active.revisions.find((item) => item.id === event.target.value); if (next !== undefined) controller.selectRevision(next.id); }}>{active.revisions.map((item, index) => <option key={item.id} value={item.id}>Revision {index + 1}{item.id === active.currentRevisionId ? " · current" : ""}</option>)}</select></label>
      </div>
      {selectionMessage !== null ? <p className="surface-notice" role="status">{selectionMessage}</p> : null}
      <div className="comparison-card"><div className="comparison-headings"><div><span className="before-dot" />{revision.scenario.before.label}<small>{revision.scenario.provenance.before._tag === "SourceInspected" ? "Source inspected" : revision.scenario.provenance.before._tag === "Proposed" ? "Proposed" : "Unverified"}</small></div><div><span className="after-dot" />{revision.scenario.after.label}<small>{revision.scenario.provenance.after._tag === "SourceInspected" ? "Source inspected" : revision.scenario.provenance.after._tag === "Proposed" ? "Proposed" : "Unverified"}</small></div></div>
        <CodeComparison revision={revision} questions={active.questions} selection={tab.draft.revisionId === revision.id ? tab.draft.target : { _tag: "WholeExample" }} themeType={host.theme} disabled={disabled} onSelect={select} onAsk={ask} onExplore={explore} onQuestion={focusQuestion} onInvalidSelection={invalidSelection} />
      </div>
      <div className="example-observations">{revision.scenario.observations.map((observation) => <p key={observation}><span aria-hidden="true">↳</span>{observation}</p>)}</div>
      <p className="example-footnote">Select lines on either side to ask about them. Examples are never applied to your repository.</p>
      </div>
      <DiscussionPanel controller={controller} state={state} scenario={active} tab={tab} composerRef={composerRef} interactive={host.interactive} />
    </div>
    <footer className="app-footer"><span>Before & after, with a conversation in between.</span><span>Session-only history · stays in this task</span></footer>
  </main>;
}
