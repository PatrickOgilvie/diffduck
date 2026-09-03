import { describe, expect, it } from "bun:test";
import { exampleReview, testUuid } from "../testing/fixtures.js";
import { DevelopmentSession, parseDevelopmentReview } from "./development-session.js";

function setup() {
  let id = 1;
  let now = 0;
  const timers = new Map<() => void, number>();
  const opened = DevelopmentSession.open(exampleReview(), {
    newUuid: () => testUuid(id++), nowMs: () => now,
    schedule: (delay, callback) => { timers.set(callback, now + delay); return () => { timers.delete(callback); }; },
  });
  if (opened._tag === "Err") throw new Error("Invalid test fixture");
  const session = opened.value;
  return {
    session, controller: session.controller, timers,
    advance: async (elapsed: number) => {
      now += elapsed;
      for (const [callback, due] of [...timers]) {
        if (due > now || !timers.has(callback)) continue;
        timers.delete(callback); callback();
        await session.settled();
      }
    },
  };
}

describe("development review input", () => {
  it("accepts the actual opening payload and rejects malformed or extra fields", () => {
    expect(parseDevelopmentReview(JSON.stringify(exampleReview()))).toEqual({ _tag: "Ok", value: exampleReview() });
    expect(parseDevelopmentReview("{")).toMatchObject({ _tag: "Err", error: { _tag: "InvalidReview" } });
    expect(parseDevelopmentReview(JSON.stringify({ ...exampleReview(), runCode: true }))._tag).toBe("Err");
    expect(parseDevelopmentReview(JSON.stringify({ requestId: "missing-review" }))._tag).toBe("Err");
    expect(parseDevelopmentReview(" ".repeat(8 * 1024 * 1024 + 1))).toMatchObject({ _tag: "Err", error: { message: "Review JSON must be smaller than 8 MiB." } });
  });
});

describe("development session through the production discussion controller", () => {
  it("holds a selected question in A, preserves B's draft, then routes an answer and adoption back to A", async () => {
    const { session, controller } = setup();
    try {
      const a = controller.getSnapshot().session?.scenarios[0];
      const b = controller.getSnapshot().session?.scenarios[1];
      if (a === undefined || b === undefined) throw new Error("Missing scenarios");
      session.setReplyMode("manual");
      controller.selectLines({ _tag: "Lines", side: "after", startLine: 3, endLine: 4 });
      controller.setIntent("explore-alternative"); controller.editDraft("Could we express this differently?");
      controller.submit(); await session.settled();
      expect(session.getSnapshot().canReply).toBe(true);
      const pending = controller.getSnapshot().session?.scenarios[0]?.questions[0];
      expect(pending?.state).toEqual({ _tag: "Pending", delivery: "accepted" });
      expect(pending?.context.question.target).toMatchObject({ _tag: "Lines", side: "after", startLine: 3, endLine: 4 });
      controller.selectTab(b.scenarioId); controller.editDraft("Keep this draft during design changes");
      session.reply(); await session.settled();
      const state = controller.getSnapshot();
      expect(state.activeScenarioId).toBe(b.scenarioId);
      expect(state.tabs.get(b.scenarioId)?.draft.text).toBe("Keep this draft during design changes");
      expect(state.tabs.get(a.scenarioId)?.unreadAnswers).toBe(1);
      const answered = state.session?.scenarios[0]?.questions[0];
      expect(answered?.state).toMatchObject({ _tag: "Completed", response: { _tag: "Answered", alternative: { basedOnRevisionId: a.currentRevisionId } } });
      expect(session.getSnapshot().canReply).toBe(false);
      if (answered === undefined) throw new Error("Missing answer");
      controller.selectTab(a.scenarioId); controller.adopt(answered.context.question.id); await session.settled();
      const revisions = controller.getSnapshot().session?.scenarios[0]?.revisions;
      expect(revisions).toHaveLength(2);
      expect(revisions?.[1]?.parentRevisionId).toBe(a.currentRevisionId);
      expect(revisions?.[1]?.scenario.before).toEqual(revisions?.[0]?.scenario.before);
      session.reply(); await session.settled();
      expect(controller.getSnapshot().session?.scenarios[0]?.questions).toHaveLength(1);
    } finally { session.dispose(); await session.settled(); }
  });

  it("switches automatic replies to held replies without losing the question", async () => {
    const { session, controller, advance } = setup();
    try {
      controller.editDraft("Hold this answer"); controller.submit(); await session.settled();
      session.setReplyMode("manual"); await advance(2_000);
      expect(controller.getSnapshot().session?.scenarios[0]?.questions[0]?.state._tag).toBe("Pending");
      session.setReplyMode("automatic"); await advance(1_500);
      expect(controller.getSnapshot().session?.scenarios[0]?.questions[0]?.state._tag).toBe("Completed");
      expect(session.getSnapshot().canReply).toBe(false);
    } finally { session.dispose(); await session.settled(); }
  });

  it("rejects delivery, retains the draft and allows a new edited submission", async () => {
    const { session, controller, advance } = setup();
    try {
      session.setReplyMode("reject-delivery");
      controller.editDraft("Keep my failed question"); controller.submit(); await session.settled();
      const state = controller.getSnapshot();
      expect(state.session?.scenarios[0]?.questions[0]?.state._tag).toBe("DeliveryRejected");
      expect(state.activeScenarioId === null ? undefined : state.tabs.get(state.activeScenarioId)?.draft.text).toBe("Keep my failed question");
      expect(session.getSnapshot().canReply).toBe(false);
      session.setReplyMode("automatic"); controller.editDraft("Keep my failed question (new attempt)");
      controller.submit(); await session.settled(); await advance(1_500);
      expect(controller.getSnapshot().session?.scenarios[0]?.questions[1]?.state._tag).toBe("Completed");
    } finally { session.dispose(); await session.settled(); }
  });

  it("simulates cannot-answer and keeps its reason in the real transcript", async () => {
    const { session, controller } = setup();
    try {
      session.setReplyMode("manual"); controller.editDraft("What can't we verify?"); controller.submit(); await session.settled();
      session.reply("cannot-answer"); await session.settled();
      expect(controller.getSnapshot().session?.scenarios[0]?.questions[0]?.state).toMatchObject({ _tag: "Completed", response: { _tag: "CannotAnswer", reason: expect.stringContaining("Simulated response:") } });
    } finally { session.dispose(); await session.settled(); }
  });

  it("stopping a question cancels its scheduled reply and releases the local reply controls", async () => {
    const { session, controller, advance, timers } = setup();
    try {
      controller.editDraft("Stop this question"); controller.submit(); await session.settled();
      const question = controller.getSnapshot().session?.scenarios[0]?.questions[0];
      if (question === undefined) throw new Error("Missing question");
      controller.stopWaiting(question.context.question.id); await session.settled(); await advance(2_000);
      expect(controller.getSnapshot().session?.scenarios[0]?.questions[0]?.state._tag).toBe("Cancelled");
      expect(session.getSnapshot().canReply).toBe(false);
      expect(timers.size).toBe(0);
    } finally { session.dispose(); await session.settled(); }
  });

  it("disposal stops both polling and generation, including a submission still settling", async () => {
    const { session, controller, timers, advance } = setup();
    controller.editDraft("Dispose while preparing"); controller.submit(); session.dispose(); await session.settled();
    expect(timers.size).toBe(0);
    const state = controller.getSnapshot();
    await advance(10_000); session.reply(); session.setReplyMode("manual");
    expect(controller.getSnapshot()).toBe(state);
    expect(timers.size).toBe(0);
  });
});
