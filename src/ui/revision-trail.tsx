import { useLayoutEffect, useMemo, useRef } from "react";
import type { QuestionId, QuestionIntent, ScenarioDiscussion } from "../domain/discussion.js";
import type { TabView } from "./discussion-controller.js";
import { CodeComparison } from "./code-comparison.js";
import { buildRevisionPanels, type RevisionSelection } from "./revision-panels.js";
import { usePreservedScroll } from "./use-preserved-scroll.js";

/** Horizontally browse all retained revisions; each diff compares only adjacent saved versions. */
export function RevisionTrail({ scenario, tab, themeType, disabled, onSelect, onDiscuss, onQuestion, onInvalidSelection }: {
  readonly scenario: ScenarioDiscussion;
  readonly tab: TabView;
  readonly themeType: "light" | "dark";
  readonly disabled: boolean;
  readonly onSelect: (selection: RevisionSelection) => void;
  readonly onDiscuss: (selection: RevisionSelection, intent: QuestionIntent) => void;
  readonly onQuestion: (id: QuestionId) => void;
  readonly onInvalidSelection: (message: string) => void;
}) {
  const result = useMemo(() => buildRevisionPanels({ revisions: scenario.revisions }), [scenario.revisions]);
  const selection = useMemo<RevisionSelection>(() => ({ revisionId: tab.draft.revisionId, target: tab.draft.target }), [tab.draft.revisionId, tab.draft.target]);
  const scroll = usePreservedScroll(scenario.scenarioId);
  const columns = useRef(new Map<string, HTMLElement>());
  const previous = useRef({ scenarioId: scenario.scenarioId, currentId: scenario.currentRevisionId, questionId: tab.focusedQuestionId });

  function reveal(id: string) {
    const rail = scroll.ref.current;
    const column = columns.current.get(id);
    if (rail === null || column === undefined) return;
    rail.scrollTo({ left: rail.scrollLeft + column.getBoundingClientRect().left - rail.getBoundingClientRect().left, behavior: "instant" });
  }
  useLayoutEffect(() => {
    const old = previous.current;
    if (old.scenarioId === scenario.scenarioId) {
      if (old.currentId !== scenario.currentRevisionId) reveal(scenario.currentRevisionId);
      else if (tab.focusedQuestionId !== null && old.questionId !== tab.focusedQuestionId) {
        const question = scenario.questions.find((record) => record.context.question.id === tab.focusedQuestionId);
        if (question !== undefined) reveal(question.context.question.target._tag === "Lines" && question.context.question.target.side === "before"
          ? `before-${scenario.revisions[0]?.id}` : question.context.example.id);
      }
    }
    previous.current = { scenarioId: scenario.scenarioId, currentId: scenario.currentRevisionId, questionId: tab.focusedQuestionId };
  }, [scenario.scenarioId, scenario.currentRevisionId, tab.focusedQuestionId]);

  if (result._tag === "Err") return <p className="surface-notice" role="alert">{result.error.message}</p>;
  return <section className="revision-history" aria-label="Example revisions">
    <div className="revision-history-toolbar"><div><strong>Revision trail</strong><span>Before → {scenario.revisions.length} {scenario.revisions.length === 1 ? "revision" : "revisions"} · each compared with the previous</span></div>
      <div className="revision-scroll-actions"><button type="button" aria-label="Scroll to earlier revisions" onClick={() => scroll.ref.current?.scrollBy({ left: -scroll.ref.current.clientWidth * .8, behavior: "instant" })}>←</button><button type="button" aria-label="Scroll to later revisions" onClick={() => scroll.ref.current?.scrollBy({ left: scroll.ref.current.clientWidth * .8, behavior: "instant" })}>→</button><button type="button" onClick={() => reveal(scenario.currentRevisionId)}>Latest</button></div>
    </div>
    <div className="revision-scroll" ref={scroll.ref} onScroll={scroll.onScroll} role="region" aria-label="Scrollable revision panels" tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const rail = event.currentTarget;
        if (event.key === "Home" || event.key === "End") { event.preventDefault(); rail.scrollTo({ left: event.key === "Home" ? 0 : rail.scrollWidth, behavior: "instant" }); }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); rail.scrollBy({ left: rail.clientWidth * (event.key === "ArrowLeft" ? -.8 : .8), behavior: "instant" }); }
      }}>
      <div className="revision-columns">{result.value.map((panel) => {
        const { source } = panel;
        const pane = source.revision.scenario[source.side];
        const provenance = source.revision.scenario.provenance[source.side];
        const attached = selection.revisionId === source.revision.id && (panel.number === 0 ? selection.target._tag === "Lines" && selection.target.side === "before" : selection.target._tag === "WholeExample" || selection.target.side === "after");
        return <article key={panel.id} ref={(node) => { if (node === null) columns.current.delete(panel.id); else columns.current.set(panel.id, node); }} className={`revision-column${attached ? " is-attached" : ""}`} aria-label={source.label}>
          <header className="revision-column-heading"><div><span className="revision-column-number">{panel.number === 0 ? "BASE" : String(panel.number).padStart(2, "0")}</span><h3>{source.label}</h3>{panel.number > 0 && source.revision.id === scenario.currentRevisionId ? <span className="revision-badge">Current</span> : null}{attached ? <span className="revision-badge">Attached</span> : null}</div>
            <p>{pane.label} <span>· {provenance._tag === "SourceInspected" ? "Source inspected" : provenance._tag === "Proposed" ? "Proposed" : "Unverified"}</span></p>
            <span className="revision-compared-with">{panel.previous === null ? "Original code" : `Changes from ${panel.previous.label}`}</span>
          </header>
          <CodeComparison panel={panel} questions={scenario.questions} selection={selection} themeType={themeType} disabled={disabled} onSelect={onSelect} onDiscuss={onDiscuss} onQuestion={onQuestion} onInvalidSelection={onInvalidSelection} />
          {panel.number > 0 ? <div className="revision-observations">{source.revision.scenario.observations.map((observation) => <p key={observation}>{observation}</p>)}</div> : null}
        </article>;
      })}</div>
    </div>
    <p className="revision-history-hint">Scroll horizontally to follow the changes. Removed lines attach to their original revision; questions never refer to invented line numbers.</p>
  </section>;
}
