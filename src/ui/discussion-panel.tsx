import { useEffect, type RefObject } from "react";
import { captureTarget, type ExampleRevision, type QuestionContext, type QuestionTarget, type ScenarioDiscussion } from "../domain/discussion.js";
import { DiscussionController, type DiscussionView, type TabView } from "./discussion-controller.js";
import { usePreservedScroll } from "./use-preserved-scroll.js";

function scopeLabel(target: QuestionTarget): string {
  return target._tag === "WholeExample" ? "Whole example" : `${target.side === "before" ? "Before" : "After"} · lines ${target.startLine}–${target.endLine}`;
}

function ContextDetails({ context, revisionNumber }: { readonly context: QuestionContext; readonly revisionNumber: number }) {
  return <details className="context-details">
    <summary>{scopeLabel(context.question.target)} <span>· revision {revisionNumber}</span></summary>
    <div className="context-body">
      <p className="context-caption">Exact context attached when this question was sent.</p>
      {context.question.target._tag === "Lines" ? <pre><code>{context.question.target.selectedText}</code></pre> : null}
      <details><summary>Full before & after</summary>
        <p>{context.example.scenario.filename}</p>
        <h4>{context.example.scenario.before.label}</h4><pre><code>{context.example.scenario.before.code}</code></pre>
        <h4>{context.example.scenario.after.label}</h4><pre><code>{context.example.scenario.after.code}</code></pre>
      </details>
      <p className="context-caption">{context.review.repository} · {context.history.length} preceding {context.history.length === 1 ? "turn" : "turns"}</p>
      <details><summary>Source evidence & complete snapshot</summary><pre><code>{JSON.stringify(context, null, 2)}</code></pre></details>
    </div>
  </details>;
}

type Props = {
  readonly controller: DiscussionController;
  readonly state: DiscussionView;
  readonly scenario: ScenarioDiscussion;
  readonly tab: TabView;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly interactive: boolean;
};

/** A scenario-scoped transcript, inspectable context and example-only actions. */
export function DiscussionPanel({ controller, state, scenario, tab, composerRef, interactive }: Props) {
  const transcriptScroll = usePreservedScroll(scenario.scenarioId);
  const pending = state.session?.scenarios.flatMap((item) => item.questions).find((question) => question.state._tag === "Pending");
  const draftRevision: ExampleRevision | undefined = scenario.revisions.find((revision) => revision.id === tab.draft.revisionId);
  const draftNumber = scenario.revisions.findIndex((revision) => revision.id === tab.draft.revisionId) + 1;
  const displayedNumber = scenario.revisions.findIndex((revision) => revision.id === tab.displayedRevisionId) + 1;
  const captured = draftRevision === undefined ? null : captureTarget(tab.draft.target, { before: draftRevision.scenario.before.code, after: draftRevision.scenario.after.code });
  const disabled = !interactive || state.connection === "unavailable";
  const sendingDisabled = disabled || state.activity !== "idle" || state.synchronization !== "current" || pending !== undefined || tab.draft.text.trim().length === 0;

  useEffect(() => {
    if (tab.focusedQuestionId !== null) {
      const element = document.getElementById(`question-${tab.focusedQuestionId}`);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  }, [tab.focusedQuestionId]);

  return <aside className="discussion-panel" aria-label="Scenario discussion">
    <header className="discussion-heading"><div><span className="eyebrow">The conversation</span><h2>Talk it through</h2></div><span className="message-count">{scenario.questions.length}</span></header>
    <div className="discussion-transcript" ref={transcriptScroll.ref} onScroll={transcriptScroll.onScroll} role="log" aria-label="Discussion messages" aria-live="polite" aria-relevant="additions text">
      {scenario.questions.length === 0 ? <div className="discussion-empty"><span className="empty-thread-symbol" aria-hidden="true">↳</span><h3>Start with a question.</h3><p>Select a few lines, or ask about the whole example. The before, after, and exact context come along.</p></div> : null}
      {scenario.questions.map((record) => {
        const context = record.context;
        const id = context.question.id;
        const revisionNumber = scenario.revisions.findIndex((revision) => revision.id === context.example.id) + 1;
        return <article key={id} id={`question-${id}`} tabIndex={-1} className={`discussion-turn${tab.focusedQuestionId === id ? " is-focused" : ""}`}>
          <div className="message-meta"><span className="avatar user-avatar">You</span><span>{context.question.intent === "ask" ? "Question" : "Explore an alternative"}</span></div>
          <p className="message-text user-message">{context.question.text}</p>
          <ContextDetails context={context} revisionNumber={revisionNumber} />
          {record.state._tag === "Pending" ? <div className="pending-answer">
            <p><span className="status-dot" />{record.state.delivery === "accepted" ? "Waiting for Codex…" : "Delivery not yet confirmed"}</p>
            {state.pollingPaused ? <p>No reply yet. Automatic checking is paused.</p> : null}
            <div className="small-actions"><button type="button" disabled={disabled} onClick={() => controller.checkAgain()}>Check again</button><button type="button" disabled={disabled || state.activity !== "idle"} onClick={() => controller.stopWaiting(id)}>Stop waiting</button></div>
            {record.state.delivery === "unconfirmed" ? <details className="retry-details"><summary>Retry delivery…</summary><p>Codex may already have received this. Retrying could start another response; only one answer will be stored.</p><button type="button" disabled={disabled || state.activity !== "idle"} onClick={() => controller.retryDelivery(id)}>Retry anyway</button></details> : null}
            <p className="microcopy">Stopping here does not stop the Codex task.</p>
          </div> : record.state._tag === "Completed" ? <div className="assistant-message">
            <div className="message-meta"><span className="avatar duck-avatar">↳</span><span>Codex</span></div>
            <p className="message-text">{record.state.response._tag === "Answered" ? record.state.response.text : record.state.response.reason}</p>
            {record.state.response._tag === "Answered" && record.state.response.alternative !== null ? <div className="alternative-card">
              <details><summary>Proposed alternative</summary><pre><code>{record.state.response.alternative.after.code}</code></pre>
                {record.state.response.alternative.observations.map((observation) => <p key={observation}>{observation}</p>)}
              </details>
              <button className="button secondary" type="button" disabled={disabled || state.activity !== "idle" || record.adoptedRevisionId !== null} onClick={() => controller.adopt(id)}>{record.adoptedRevisionId === null ? "Use this example" : "Example updated"}</button>
              <span className="microcopy">Example only · no repository changes</span>
            </div> : null}
            <button className="reply-button" type="button" disabled={disabled} onClick={() => { controller.replyTo(id); composerRef.current?.focus(); }}>Reply ↗</button>
          </div> : <p className="closed-message">{record.state._tag === "Cancelled" ? "Stopped waiting. Late replies will not be added." : "Codex did not accept this question. Your draft was kept."}</p>}
        </article>;
      })}
    </div>
    <form className="question-composer" onSubmit={(event) => { event.preventDefault(); controller.submit(); }}>
      {state.synchronization === "required" ? <section className="pending-answer" aria-label="Recover question">
        <p>DiffDuck could not confirm whether your question was saved. Nothing has been resent.</p>
        <p>{state.pollingPaused ? "Automatic checking is paused. Check again before sending another question." : "Checking the saved discussion before allowing another question…"}</p>
        <div className="small-actions"><button type="button" disabled={disabled || state.activity !== "idle"} onClick={() => controller.checkAgain()}>Check again</button></div>
      </section> : null}
      <details className="draft-context"><summary>{scopeLabel(tab.draft.target)} <span>· r{draftNumber}</span></summary>
        {captured?._tag === "Ok" && captured.value._tag === "Lines" ? <pre><code>{captured.value.selectedText}</code></pre> : <p>Both complete code panes and this tab's preceding discussion will be attached.</p>}
        {draftRevision !== undefined ? <details><summary>Inspect full example</summary><pre><code>{draftRevision.scenario.before.code}</code></pre><pre><code>{draftRevision.scenario.after.code}</code></pre></details> : null}
        <button type="button" disabled={disabled} onClick={() => controller.attachDisplayedExample()}>Attach whole revision {displayedNumber}</button>
      </details>
      {tab.draft.revisionId !== tab.displayedRevisionId ? <p className="draft-warning">Your draft still refers to revision {draftNumber}. <button type="button" disabled={disabled} onClick={() => controller.attachDisplayedExample()}>Attach revision {displayedNumber}</button></p> : null}
      <label className="sr-only" htmlFor={`draft-${scenario.scenarioId}`}>Question about this example</label>
      <textarea ref={composerRef} id={`draft-${scenario.scenarioId}`} rows={3} maxLength={8_000} disabled={disabled} value={tab.draft.text}
        placeholder="What feels better, worse, or still unresolved?" onChange={(event) => controller.editDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (!sendingDisabled) controller.submit(); } }} />
      <div className="composer-actions"><label className="sr-only" htmlFor={`intent-${scenario.scenarioId}`}>Question intent</label>
        <select id={`intent-${scenario.scenarioId}`} value={tab.draft.intent} disabled={disabled} onChange={(event) => controller.setIntent(event.target.value === "explore-alternative" ? "explore-alternative" : "ask")}>
          <option value="ask">Ask a question</option><option value="explore-alternative">Explore alternative</option>
        </select><button className="button primary" type="submit" disabled={sendingDisabled}>{state.activity === "working" ? "Sending…" : "Send ↗"}</button>
      </div>
      <div className="composer-status" role="status">{tab.message ?? (pending !== undefined && pending.context.question.scenarioId !== scenario.scenarioId ? "Another tab is waiting for Codex. Keep drafting here." : "Exact context attached · ⌘ / Ctrl + Enter to send")}</div>
    </form>
  </aside>;
}
