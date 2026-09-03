import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { QuestionId, QuestionIntent, ScenarioDiscussion } from "../domain/discussion.js";
import type { DiscussionController } from "./discussion-controller.js";
import { RevisionTrail } from "./revision-trail.js";
import type { RevisionSelection } from "./revision-panels.js";
import { DiscussionPanel } from "./discussion-panel.js";
import { usePreservedScroll } from "./use-preserved-scroll.js";
import duckIcon from "../../assets/diffduck-icon.svg";

/** Host presentation capabilities; transport and session ownership stay outside the surface. */
export type HostView = { readonly theme: "light" | "dark"; readonly fullscreen: boolean; readonly canFullscreen: boolean; readonly interactive: boolean; readonly demo: boolean };

/** Shared production review UI; its session owner lives outside this component. */
export function ReviewSurface({ controller, host, message, onFullscreen }: { readonly controller: DiscussionController; readonly host: HostView; readonly message: string | null; readonly onFullscreen: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const select = useCallback((selection: RevisionSelection) => { setSelectionMessage(null); controller.attachRevision(selection.revisionId, selection.target); }, [controller]);
  const discuss = useCallback((selection: RevisionSelection, intent: QuestionIntent) => { setSelectionMessage(null); controller.attachRevision(selection.revisionId, selection.target); controller.setIntent(intent); composerRef.current?.focus(); }, [controller]);
  const focusQuestion = useCallback((id: QuestionId) => controller.focusQuestion(id), [controller]);
  const invalidSelection = useCallback((message: string) => setSelectionMessage(message), []);
  const review = state.session?.review;
  const active = state.session?.scenarios.find((scenario) => scenario.scenarioId === state.activeScenarioId);
  const tab = active === undefined ? undefined : state.tabs.get(active.scenarioId);
  const exampleScroll = usePreservedScroll(active?.scenarioId ?? "");
  if (review === undefined || active === undefined || tab === undefined) return <main className="diffduck-empty"><img src={duckIcon} width="64" height="64" alt="DiffDuck duck" /><h1>Waiting for the comparison</h1><p role="status">{message ?? "Codex will open this surface with complete before-and-after examples."}</p></main>;
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
      <div className="example-column" ref={exampleScroll.ref} onScroll={exampleScroll.onScroll}>
        <div className="scenario-intro"><div><h2>{revision.scenario.title}</h2><p>{revision.scenario.description}</p></div></div>
        {selectionMessage !== null ? <p className="surface-notice" role="status">{selectionMessage}</p> : null}
        <RevisionTrail scenario={active} tab={tab} themeType={host.theme} disabled={disabled} onSelect={select} onDiscuss={discuss} onQuestion={focusQuestion} onInvalidSelection={invalidSelection} />
        <p className="example-footnote">Select lines in any column to discuss them. New revisions update examples only, never your repository.</p>
      </div>
      <DiscussionPanel controller={controller} state={state} scenario={active} tab={tab} composerRef={composerRef} interactive={host.interactive} />
    </div>
    <footer className="app-footer"><span>Before & after, with a conversation in between.</span><span>Session-only history · stays in this task</span></footer>
  </main>;
}
