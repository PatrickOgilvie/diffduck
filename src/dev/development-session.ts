import { openReviewSchema, type OpenReview, type QuestionRef } from "../domain/commands.js";
import { fail, ok, type Result } from "../domain/discussion.js";
import { ReviewSessions, defaultSessionLimits } from "../service/review-sessions.js";
import { DiscussionController, type ViewRuntime } from "../ui/discussion-controller.js";
import type { DiscussionPort } from "../ui/diffduck-bridge.js";

/** Development-only delivery controls; no mode contacts a model. */
export const replyModes = ["automatic", "manual", "reject-delivery"] as const;
/** How the local development host handles a submitted question. */
export type ReplyMode = typeof replyModes[number];
/** Invalid imports leave the current session untouched. */
export type ReviewImportFailure = { readonly _tag: "InvalidReview"; readonly message: string };

/** Parse the same opening payload accepted by show_diffduck_review, entirely locally. */
export function parseDevelopmentReview(text: string): Result<OpenReview, ReviewImportFailure> {
  if (new TextEncoder().encode(text).byteLength > defaultSessionLimits.maxSessionBytes) {
    return fail("InvalidReview", "Review JSON must be smaller than 8 MiB.");
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { return fail("InvalidReview", "Enter valid JSON. The current review has not changed."); }
  const parsed = openReviewSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : fail("InvalidReview", "Expected a show_diffduck_review payload with requestId and review. Check the scenarios, code panes and provenance. The current review has not changed.");
}

/** Stable session state survives component and stylesheet refreshes. */
export class DevelopmentSession {
  readonly controller: DiscussionController;
  private prepared: QuestionRef | null = null;
  private pending: QuestionRef | null = null;
  private cancelReply: (() => void) | null = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private state: { readonly replyMode: ReplyMode; readonly canReply: boolean; readonly message: string | null } = {
    replyMode: "automatic", canReply: false, message: null,
  };

  private constructor(private readonly sessions: ReviewSessions, private readonly runtime: ViewRuntime) {
    const cancelled = () => fail("Cancelled", "The development session was closed.");
    const port: DiscussionPort = {
      prepare: async (input, options) => {
        if (this.disposed || options.signal?.aborted) return cancelled();
        const result = sessions.prepare(input);
        if (result._tag === "Ok") this.prepared = result.value.ref;
        return result;
      },
      read: async (input, options) => this.disposed || options.signal?.aborted ? cancelled() : sessions.read(input),
      recordDelivery: async (input, options) => this.disposed || options.signal?.aborted ? cancelled() : sessions.recordDelivery(input),
      adopt: async (input, options) => this.disposed || options.signal?.aborted ? cancelled() : sessions.adopt(input),
      cancel: async (input, options) => {
        if (this.disposed || options.signal?.aborted) return cancelled();
        const result = sessions.cancel(input);
        if (result._tag === "Ok" && this.pending?.questionId === input.questionId) this.clearPending();
        return result;
      },
      send: async (_trigger, options) => {
        if (this.disposed || options.signal?.aborted || this.prepared === null) return { _tag: "Rejected", message: "No local question is ready to send." };
        if (this.state.replyMode === "reject-delivery") return { _tag: "Rejected", message: "Simulated delivery rejection. Change Replies to Automatic, edit the draft and send it as a new question." };
        this.pending = this.prepared;
        this.publish({ ...this.state, canReply: true, message: null });
        this.scheduleReply();
        return { _tag: "Accepted" };
      },
    };
    this.controller = new DiscussionController(port, runtime);
  }

  /** Open through the real session service; capacity failures are returned without replacing anything. */
  static open(input: OpenReview, runtime: ViewRuntime) {
    const sessions = new ReviewSessions({ newUuid: runtime.newUuid, now: () => new Date(runtime.nowMs()).toISOString(), emit: () => {} }, defaultSessionLimits);
    const opened = sessions.open(input);
    if (opened._tag === "Err") return opened;
    const local = new DevelopmentSession(sessions, runtime);
    local.controller.accept(opened.value);
    return ok(local);
  }

  /** Stable snapshot for development controls, separate from review state. */
  readonly getSnapshot = () => this.state;
  /** Subscribe without taking ownership of the session lifetime. */
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Pause or resume simulated replies without changing drafts or the selected example. */
  setReplyMode(replyMode: ReplyMode): void {
    if (this.disposed) return;
    this.publish({ ...this.state, replyMode });
    this.scheduleReply();
  }

  /** Complete the held question through the real answer/revision transition. */
  reply(outcome: "answer" | "cannot-answer" = "answer"): void {
    if (this.disposed || this.pending === null) return;
    const ref = this.pending;
    const context = this.sessions.getQuestion(ref);
    if (context._tag === "Err") { this.clearPending(context.error.message); return; }
    const result = this.sessions.respond({ ...ref, response: outcome === "cannot-answer" ? {
      _tag: "CannotAnswer", reason: "Simulated response: there is not enough source evidence to answer this question.",
    } : {
      _tag: "Answered",
      text: "Simulated reply: this discussion is attached to the exact example revision and selected lines you sent. The proposed call site makes the sequence explicit; the design question is whether that clarity earns the extra API surface. No model was contacted.",
      alternative: context.value.question.intent === "explore-alternative" ? {
        basedOnRevisionId: context.value.example.id,
        after: { label: "Simulated alternative", code: `${context.value.example.scenario.after.code}\n// Local UI preview: an alternative example, not a code recommendation.\n` },
        observations: ["Simulated alternative for exercising example adoption and revision history."],
      } : null,
    } });
    this.clearPending(result._tag === "Err" ? result.error.message : null);
    this.controller.checkAgain();
  }

  /** Abort simulated generation and controller polling when replaced or unloaded. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelReply?.(); this.cancelReply = null;
    this.pending = null; this.prepared = null;
    this.controller.dispose();
    this.listeners.clear();
  }

  /** Drain controller-owned operations during teardown and tests. */
  async settled(): Promise<void> { await this.controller.settled(); }

  private scheduleReply(): void {
    this.cancelReply?.(); this.cancelReply = null;
    if (this.pending !== null && this.state.replyMode === "automatic") {
      this.cancelReply = this.runtime.schedule(1_500, () => { this.cancelReply = null; this.reply(); });
    }
  }

  private clearPending(message: string | null = null): void {
    this.cancelReply?.(); this.cancelReply = null; this.pending = null;
    this.publish({ ...this.state, canReply: false, message });
  }

  private publish(state: typeof this.state): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
