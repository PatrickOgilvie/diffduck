import { prepareQuestionSchema, type QuestionRef } from "../domain/commands.js";
import {
  questionIdSchema, type ExampleRevisionId, type QuestionId, type QuestionIntent,
  type QuestionRecord, type QuestionTarget, type ScenarioDiscussion, type SessionSnapshot,
} from "../domain/discussion.js";
import type { ScenarioId } from "../domain/review.js";
import type { ClientFailure, DiscussionPort } from "./diffduck-bridge.js";

/** Draft scope changes only through an explicit selection or revision action. */
export type QuestionDraft = {
  readonly questionId: QuestionId | null;
  readonly text: string;
  readonly intent: QuestionIntent;
  readonly revisionId: ExampleRevisionId;
  readonly target: QuestionTarget;
  readonly replyToQuestionId: QuestionId | null;
};
/** Presentation state belongs to its tab, not the currently running question. */
export type TabView = {
  readonly displayedRevisionId: ExampleRevisionId;
  readonly draft: QuestionDraft;
  readonly focusedQuestionId: QuestionId | null;
  readonly seenAnswerCount: number;
  readonly unreadAnswers: number;
  readonly message: string | null;
};
/** The UI's immutable external-store snapshot. */
export type DiscussionView = {
  readonly session: SessionSnapshot | null;
  readonly activeScenarioId: ScenarioId | null;
  readonly tabs: ReadonlyMap<ScenarioId, TabView>;
  readonly activity: "idle" | "working";
  readonly connection: "available" | "unavailable";
  readonly synchronization: "current" | "required";
  readonly message: string | null;
  readonly pollingPaused: boolean;
};
/** Browser/runtime seams allow deterministic cancellation and polling tests. */
export type ViewRuntime = {
  readonly newUuid: () => string;
  readonly nowMs: () => number;
  readonly schedule: (delayMs: number, callback: () => void) => () => void;
};

function blankDraft(revisionId: ExampleRevisionId): QuestionDraft {
  return { questionId: null, text: "", intent: "ask", revisionId, target: { _tag: "WholeExample" }, replyToQuestionId: null };
}
function reference(question: QuestionRecord): QuestionRef {
  return { sessionId: question.context.sessionId, questionId: question.context.question.id, contextId: question.context.id };
}
function answeredCount(scenario: ScenarioDiscussion): number {
  return scenario.questions.filter((question) => question.state._tag === "Completed").length;
}

/** Own tab state, dispatch and bounded polling independently of React or the MCP SDK. */
export class DiscussionController {
  private state: DiscussionView = {
    session: null, activeScenarioId: null, tabs: new Map(), activity: "idle",
    connection: "available", synchronization: "current", message: null, pollingPaused: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private readonly tasks = new Set<Promise<void>>();
  private cancelTimer: (() => void) | undefined;
  private readAbort: AbortController | undefined;
  private readInFlight = false;
  private visible = true;
  private disposed = false;
  private pollStartedAt: number | null = null;

  /** Bind a host port and the browser-owned scheduling/identity seams. */
  constructor(private readonly port: DiscussionPort, private readonly runtime: ViewRuntime) {}

  /** Stable accessor for useSyncExternalStore. */
  readonly getSnapshot = (): DiscussionView => this.state;
  /** Subscribe to user-visible state changes; returns an owned cleanup callback. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Accept only newer snapshots of the original session and preserve all local draft state. */
  accept(session: SessionSnapshot): void {
    if (this.disposed) return;
    if (this.state.session !== null && (this.state.session.sessionId !== session.sessionId || session.version <= this.state.session.version)) return;
    const activeScenarioId = this.state.activeScenarioId ?? session.scenarios[0]?.scenarioId ?? null;
    const tabs = new Map(this.state.tabs);
    for (const scenario of session.scenarios) {
      const previous = tabs.get(scenario.scenarioId);
      const count = answeredCount(scenario);
      const seenAnswerCount = scenario.scenarioId === activeScenarioId ? count : previous?.seenAnswerCount ?? 0;
      tabs.set(scenario.scenarioId, {
        displayedRevisionId: previous?.displayedRevisionId ?? scenario.currentRevisionId,
        draft: previous?.draft ?? blankDraft(scenario.currentRevisionId),
        focusedQuestionId: previous?.focusedQuestionId ?? null,
        seenAnswerCount, unreadAnswers: Math.max(0, count - seenAnswerCount), message: previous?.message ?? null,
      });
    }
    this.publish({ ...this.state, session, activeScenarioId, tabs, connection: "available", synchronization: "current", message: null });
    this.scheduleRead();
  }

  /** Switch presentation only; outstanding questions retain their own routing identities. */
  selectTab(id: ScenarioId): void {
    const scenario = this.state.session?.scenarios.find((item) => item.scenarioId === id);
    const tab = this.state.tabs.get(id);
    if (scenario === undefined || tab === undefined) return;
    const tabs = new Map(this.state.tabs);
    tabs.set(id, { ...tab, seenAnswerCount: answeredCount(scenario), unreadAnswers: 0 });
    this.publish({ ...this.state, activeScenarioId: id, tabs });
  }

  /** Preserve the exact question text as entered, including meaningful whitespace. */
  editDraft(text: string): void { this.updateActive((tab) => ({ ...tab, message: null, draft: { ...tab.draft, text, questionId: null } })); }
  /** Choose explanation or example exploration, never repository application. */
  setIntent(intent: QuestionIntent): void { this.updateActive((tab) => ({ ...tab, draft: { ...tab.draft, intent, questionId: null } })); }
  /** An explicit code-selection action attaches the displayed revision to the draft. */
  selectLines(target: QuestionTarget): void {
    this.updateActive((tab) => ({ ...tab, message: null, draft: { ...tab.draft, target, revisionId: tab.displayedRevisionId, questionId: null } }));
  }
  /** Attach explicitly selected source in the revision trail, preserving the draft text and reply anchor. */
  attachRevision(id: ExampleRevisionId, target: QuestionTarget): void {
    if (!this.activeScenario()?.revisions.some((revision) => revision.id === id)) return;
    this.updateActive((tab) => ({ ...tab, displayedRevisionId: id, message: null,
      draft: { ...tab.draft, questionId: null, revisionId: id, target },
    }));
  }
  /** Show a historical revision without silently retargeting an already written draft. */
  selectRevision(id: ExampleRevisionId): void {
    const scenario = this.activeScenario();
    if (scenario === undefined || !scenario.revisions.some((revision) => revision.id === id)) return;
    this.updateActive((tab) => ({ ...tab, displayedRevisionId: id, draft: tab.draft.text.length === 0 ? blankDraft(id) : tab.draft }));
  }
  /** Explicitly attach the whole currently displayed example to the draft. */
  attachDisplayedExample(): void { this.selectLines({ _tag: "WholeExample" }); }
  /** Focus the question and display the exact historical example it discusses. */
  focusQuestion(id: QuestionId): void {
    const question = this.activeScenario()?.questions.find((item) => item.context.question.id === id);
    if (question === undefined) return;
    this.updateActive((tab) => ({ ...tab, focusedQuestionId: id, displayedRevisionId: question.context.example.id }));
  }
  /** Reply explicitly to a prior question, with its scope shown in the composer. */
  replyTo(id: QuestionId): void {
    const question = this.activeScenario()?.questions.find((item) => item.context.question.id === id);
    if (question === undefined) return;
    const captured = question.context.question.target;
    const target: QuestionTarget = captured._tag === "WholeExample" ? captured : {
      _tag: "Lines", side: captured.side, startLine: captured.startLine, endLine: captured.endLine,
    };
    this.updateActive((tab) => ({ ...tab, focusedQuestionId: id, displayedRevisionId: question.context.example.id,
      draft: { ...tab.draft, questionId: null, revisionId: question.context.example.id, target, replyToQuestionId: id },
    }));
  }

  /** Submit a captured draft through the supervised asynchronous lifecycle. */
  submit(): void {
    if (this.state.activity !== "idle" || this.state.connection !== "available" || this.state.synchronization !== "current" || this.pendingQuestion() !== undefined) return;
    const id = this.state.activeScenarioId;
    const scenario = this.activeScenario();
    const session = this.state.session;
    const tab = id === null ? undefined : this.state.tabs.get(id);
    if (id === null || scenario === undefined || session === null || tab === undefined || tab.draft.text.trim().length === 0) return;
    const draft = { ...tab.draft, questionId: tab.draft.questionId ?? questionIdSchema.parse(this.runtime.newUuid()) };
    const parsed = prepareQuestionSchema.safeParse({
      sessionId: session.sessionId, questionId: draft.questionId, scenarioId: id, exampleRevisionId: draft.revisionId,
      expectedTranscriptVersion: scenario.transcriptVersion, intent: draft.intent, text: draft.text,
      target: draft.target, replyToQuestionId: draft.replyToQuestionId,
    });
    if (!parsed.success) { this.tabMessage(id, "Keep questions under 8,000 characters and select a valid range."); return; }
    // A read started before this mutation cannot prove whether preparation committed.
    this.readAbort?.abort();
    this.updateTab(id, (current) => ({ ...current, draft, message: null }));
    this.publish({ ...this.state, activity: "working" });
    this.own(async () => {
      try {
        const prepared = await this.port.prepare(parsed.data, { signal: this.lifetime.signal });
        if (this.disposed) return;
        if (prepared._tag === "Err") {
          this.handleFailure(prepared.error, id);
          switch (prepared.error._tag) {
            case "HostUnavailable":
            case "InvalidHostResponse":
            case "InvalidInput": // A host rejection may follow a successful server mutation.
            case "TranscriptChanged":
            case "QuestionInFlight":
              this.publish({ ...this.state, synchronization: "required" });
              await this.refresh();
              break;
          }
          return;
        }
        this.accept(prepared.value.snapshot);
        if (prepared.value.disposition === "replayed") {
          this.tabMessage(id, "This question was already prepared. Check its delivery status before retrying.");
          return;
        }
        const delivery = await this.port.send(prepared.value.triggerMessage, { signal: this.lifetime.signal });
        if (this.disposed) return;
        const recorded = await this.port.recordDelivery({ ...prepared.value.ref,
          delivery: delivery._tag === "Accepted" ? "accepted" : delivery._tag === "Rejected" ? "rejected" : "unconfirmed",
        }, { signal: this.lifetime.signal });
        if (recorded._tag === "Ok") this.accept(recorded.value); else this.handleFailure(recorded.error, id);
        if (delivery._tag === "Rejected") this.tabMessage(id, delivery.message);
        else {
          this.updateTab(id, (current) => current.draft.questionId === draft.questionId
            ? { ...current, draft: blankDraft(current.displayedRevisionId), message: delivery._tag === "Unconfirmed" ? delivery.message : null }
            : current);
        }
      } finally {
        if (!this.disposed) { this.publish({ ...this.state, activity: "idle" }); this.scheduleRead(); }
      }
    });
  }

  /** Retry only when the user explicitly accepts possible duplicate host delivery. */
  retryDelivery(id: QuestionId): void {
    const pending = this.pendingQuestion();
    if (pending === undefined || pending.context.question.id !== id || pending.state._tag !== "Pending" || pending.state.delivery !== "unconfirmed" || this.state.activity !== "idle") return;
    const scenario = this.state.session?.scenarios.find((item) => item.scenarioId === pending.context.question.scenarioId);
    if (scenario === undefined) return;
    const context = pending.context;
    const target = context.question.target._tag === "WholeExample" ? context.question.target : {
      _tag: "Lines" as const, side: context.question.target.side, startLine: context.question.target.startLine, endLine: context.question.target.endLine,
    };
    this.publish({ ...this.state, activity: "working" });
    this.own(async () => {
      try {
        const prepared = await this.port.prepare({
          sessionId: context.sessionId, questionId: id, scenarioId: scenario.scenarioId, exampleRevisionId: context.example.id,
          expectedTranscriptVersion: context.historyThroughVersion, intent: context.question.intent, text: context.question.text,
          target, replyToQuestionId: context.question.replyToQuestionId,
        }, { signal: this.lifetime.signal });
        if (this.disposed) return;
        if (prepared._tag === "Err") { this.handleFailure(prepared.error, scenario.scenarioId); return; }
        this.accept(prepared.value.snapshot);
        // A reply may have arrived while preparing the explicit retry.
        const current = this.pendingQuestion();
        if (current?.context.question.id !== id) return;
        const delivery = await this.port.send(prepared.value.triggerMessage, { signal: this.lifetime.signal });
        if (this.disposed) return;
        const result = await this.port.recordDelivery({ ...prepared.value.ref,
          delivery: delivery._tag === "Accepted" ? "accepted" : delivery._tag === "Rejected" ? "rejected" : "unconfirmed",
        }, { signal: this.lifetime.signal });
        if (result._tag === "Ok") this.accept(result.value); else this.handleFailure(result.error, scenario.scenarioId);
      } finally { if (!this.disposed) this.publish({ ...this.state, activity: "idle" }); }
    });
  }

  /** Stop accepting this question's answer; Codex itself may still be running. */
  stopWaiting(id: QuestionId): void {
    const question = this.pendingQuestion();
    if (question === undefined || question.context.question.id !== id || this.state.activity !== "idle") return;
    this.action(question.context.question.scenarioId, async () => this.port.cancel(reference(question), { signal: this.lifetime.signal }));
  }
  /** Use an alternative in the example, never in the repository. */
  adopt(id: QuestionId): void {
    const scenario = this.activeScenario(); const session = this.state.session;
    if (scenario === undefined || session === null || this.state.activity !== "idle") return;
    this.action(scenario.scenarioId, async () => {
      const result = await this.port.adopt({ sessionId: session.sessionId, questionId: id, expectedCurrentRevisionId: scenario.currentRevisionId }, { signal: this.lifetime.signal });
      if (result._tag === "Ok") {
        this.accept(result.value);
        const adopted = result.value.scenarios.find((item) => item.scenarioId === scenario.scenarioId)?.questions.find((item) => item.context.question.id === id)?.adoptedRevisionId;
        if (adopted !== undefined && adopted !== null) this.updateTab(scenario.scenarioId, (tab) => ({ ...tab,
          displayedRevisionId: adopted, draft: tab.draft.text.length === 0 ? blankDraft(adopted) : tab.draft,
        }));
      }
      return result;
    });
  }

  /** Pause hidden-surface polling and refresh when the surface becomes visible again. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.cancelTimer?.(); this.cancelTimer = undefined;
    if (!visible) this.readAbort?.abort(); else this.checkAgain();
  }
  /** An explicit refresh renews the bounded automatic waiting period. */
  checkAgain(): void {
    this.pollStartedAt = this.runtime.nowMs();
    this.publish({ ...this.state, pollingPaused: false });
    this.own(async () => this.refresh());
  }
  /** Stop owned work and prevent all future notifications. Does not cancel stored questions. */
  dispose(): void {
    this.disposed = true; this.lifetime.abort(); this.readAbort?.abort(); this.cancelTimer?.(); this.cancelTimer = undefined;
    this.listeners.clear();
  }
  /** Drain supervised work during teardown or deterministic integration tests. */
  async settled(): Promise<void> { while (this.tasks.size > 0) await Promise.allSettled([...this.tasks]); }

  private action(id: ScenarioId, operation: () => Promise<Awaited<ReturnType<DiscussionPort["cancel"]>>>): void {
    this.publish({ ...this.state, activity: "working" });
    this.own(async () => {
      try { const result = await operation(); if (result._tag === "Ok") this.accept(result.value); else this.handleFailure(result.error, id); }
      finally { if (!this.disposed) this.publish({ ...this.state, activity: "idle" }); }
    });
  }
  private async refresh(): Promise<void> {
    const session = this.state.session;
    if (this.disposed || !this.visible || this.readInFlight || session === null || this.state.connection === "unavailable") return;
    this.cancelTimer?.(); this.cancelTimer = undefined;
    this.readInFlight = true; this.readAbort = new AbortController();
    try {
      const signal = AbortSignal.any([this.lifetime.signal, this.readAbort.signal]);
      const result = await this.port.read({ sessionId: session.sessionId, afterVersion: session.version }, { signal });
      if (this.disposed || signal.aborted) return;
      if (result._tag === "Err") this.handleFailure(result.error);
      else if (result.value._tag === "Changed") this.accept(result.value.snapshot);
      else this.publish({ ...this.state, synchronization: "current", message: null });
    } finally { this.readInFlight = false; this.readAbort = undefined; this.scheduleRead(); }
  }
  private scheduleRead(): void {
    this.cancelTimer?.(); this.cancelTimer = undefined;
    if (this.disposed || !this.visible || this.readInFlight || this.state.connection === "unavailable") return;
    if (this.pendingQuestion() === undefined && this.state.synchronization === "current") {
      this.pollStartedAt = null;
      if (this.state.pollingPaused) this.publish({ ...this.state, pollingPaused: false });
      return;
    }
    this.pollStartedAt ??= this.runtime.nowMs();
    const elapsed = this.runtime.nowMs() - this.pollStartedAt;
    if (elapsed >= 120_000) { this.publish({ ...this.state, pollingPaused: true }); return; }
    this.cancelTimer = this.runtime.schedule(elapsed < 30_000 ? 1_000 : 3_000, () => {
      this.cancelTimer = undefined; this.own(async () => this.refresh());
    });
  }
  private pendingQuestion(): QuestionRecord | undefined {
    return this.state.session?.scenarios.flatMap((scenario) => scenario.questions).find((question) => question.state._tag === "Pending");
  }
  private activeScenario(): ScenarioDiscussion | undefined {
    return this.state.session?.scenarios.find((scenario) => scenario.scenarioId === this.state.activeScenarioId);
  }
  private updateActive(change: (tab: TabView) => TabView): void {
    if (this.state.activeScenarioId !== null) this.updateTab(this.state.activeScenarioId, change);
  }
  private updateTab(id: ScenarioId, change: (tab: TabView) => TabView): void {
    const tab = this.state.tabs.get(id); if (tab === undefined) return;
    const tabs = new Map(this.state.tabs); tabs.set(id, change(tab)); this.publish({ ...this.state, tabs });
  }
  private tabMessage(id: ScenarioId, message: string): void { this.updateTab(id, (tab) => ({ ...tab, message })); }
  private handleFailure(error: ClientFailure, id?: ScenarioId): void {
    if (this.disposed || error._tag === "Cancelled") return;
    if (error._tag === "SessionUnavailable") {
      this.cancelTimer?.(); this.cancelTimer = undefined;
      this.publish({ ...this.state, connection: "unavailable", message: error.message });
    } else if (id !== undefined) this.tabMessage(id, error.message);
    else this.publish({ ...this.state, message: error.message });
  }
  private publish(state: DiscussionView): void {
    if (this.disposed) return;
    this.state = state; for (const listener of this.listeners) listener();
  }
  private own(operation: () => Promise<void>): void {
    if (this.disposed) return;
    const task = operation().catch(() => {
      if (!this.disposed) this.publish({ ...this.state, activity: "idle", message: "The operation could not finish. Existing discussion and drafts have been kept." });
    }).finally(() => { this.tasks.delete(task); });
    this.tasks.add(task);
  }
}
