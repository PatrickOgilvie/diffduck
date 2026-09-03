import { describe, expect, it } from "bun:test";
import type { DiscussionPort, HostDelivery } from "./diffduck-bridge.js";
import { DiscussionController } from "./discussion-controller.js";
import { ReviewSessions, defaultSessionLimits } from "../service/review-sessions.js";
import { exampleReview, testUuid } from "../testing/fixtures.js";
import { openReviewSchema, respondSchema } from "../domain/commands.js";

function setup() {
  let id = 1;
  let now = 0;
  const sessions = new ReviewSessions({ newUuid: () => testUuid(id++), now: () => "2026-09-03T12:00:00.000Z", emit: () => {} }, defaultSessionLimits);
  const opened = sessions.open(exampleReview());
  if (opened._tag !== "Ok") throw new Error("Fixture failed");
  const sent: string[] = [];
  const pendingTimers = new Set<() => void>();
  const port: DiscussionPort = {
    prepare: async (input) => sessions.prepare(input), read: async (input) => sessions.read(input),
    recordDelivery: async (input) => sessions.recordDelivery(input), cancel: async (input) => sessions.cancel(input),
    adopt: async (input) => sessions.adopt(input),
    send: async (message): Promise<HostDelivery> => { sent.push(message); return { _tag: "Accepted" }; },
  };
  const controller = new DiscussionController(port, {
    newUuid: () => testUuid(id++), nowMs: () => now,
    schedule: (_delay, callback) => { pendingTimers.add(callback); return () => { pendingTimers.delete(callback); }; },
  });
  controller.accept(opened.value);
  return { controller, sessions, sent, port, pendingTimers, snapshot: opened.value, setTime: (value: number) => { now = value; } };
}

describe("discussion controller", () => {
  it("attaches a panel's source atomically without losing draft text, reply anchors or another tab's draft", async () => {
    const { controller, sessions, snapshot } = setup();
    const a = snapshot.scenarios[0]; const b = snapshot.scenarios[1];
    if (a === undefined || b === undefined) throw new Error("Missing scenarios");
    try {
      controller.setIntent("explore-alternative"); controller.editDraft("Original question"); controller.submit(); await controller.settled();
      const question = controller.getSnapshot().session?.scenarios[0]?.questions[0];
      if (question === undefined) throw new Error("Missing question");
      const { context } = question;
      expect(sessions.respond(respondSchema.parse({ sessionId: snapshot.sessionId, questionId: context.question.id, contextId: context.id, response: {
        _tag: "Answered", text: "Try a smaller call site.", alternative: { basedOnRevisionId: a.currentRevisionId, after: { label: "Alternative", code: "compose(input);\n" }, observations: ["One call."] },
      } }))._tag).toBe("Ok");
      controller.checkAgain(); await controller.settled();
      controller.adopt(context.question.id); await controller.settled();
      const current = controller.getSnapshot().session?.scenarios[0]?.currentRevisionId;
      if (current === undefined) throw new Error("Missing current revision");
      controller.selectTab(b.scenarioId); controller.editDraft("B draft"); controller.selectTab(a.scenarioId);
      controller.replyTo(context.question.id); controller.editDraft("Keep my follow-up draft");
      const target = { _tag: "Lines", side: "after", startLine: 1, endLine: 1 } as const;
      controller.attachRevision(current, target);
      expect(controller.getSnapshot().tabs.get(a.scenarioId)).toMatchObject({ displayedRevisionId: current, draft: { revisionId: current, target, text: "Keep my follow-up draft", replyToQuestionId: context.question.id, questionId: null } });
      const attached = controller.getSnapshot();
      controller.attachRevision(b.currentRevisionId, target);
      expect(controller.getSnapshot()).toBe(attached);
      controller.submit(); await controller.settled();
      expect(controller.getSnapshot().session?.scenarios[0]?.questions[1]?.context.question).toMatchObject({ exampleRevisionId: current, replyToQuestionId: context.question.id, target: { ...target, selectedText: "compose(input);\n" } });
      expect(controller.getSnapshot().tabs.get(b.scenarioId)?.draft.text).toBe("B draft");
    } finally { controller.dispose(); await controller.settled(); }
  });

  it.each(["InvalidHostResponse", "HostUnavailable", "InvalidInput"] as const)("recovers committed preparation after %s without sending it", async (failure) => {
    const { controller, sessions, port, snapshot, sent } = setup();
    const a = snapshot.scenarios[0];
    if (a === undefined) throw new Error("Missing fixture scenario");
    port.prepare = async (input) => {
      const saved = sessions.prepare(input);
      if (saved._tag !== "Ok") return saved;
      return { _tag: "Err", error: { _tag: failure, message: "Preparation receipt lost" } };
    };
    controller.editDraft("Why this exact selection?");
    controller.selectLines({ _tag: "Lines", side: "after", startLine: 3, endLine: 4 });
    controller.submit(); await controller.settled();
    const state = controller.getSnapshot();
    const question = state.session?.scenarios[0]?.questions[0];
    expect(question?.state).toEqual({ _tag: "Pending", delivery: "unconfirmed" });
    expect(question?.context.example.id).toBe(a.currentRevisionId);
    expect(question?.context.question.target).toMatchObject({ _tag: "Lines", side: "after", startLine: 3, endLine: 4 });
    expect(state.tabs.get(a.scenarioId)?.draft.text).toBe("Why this exact selection?");
    expect(sent).toHaveLength(0);
    if (question === undefined) throw new Error("Missing recovered question");
    port.prepare = async (input) => sessions.prepare(input);
    controller.retryDelivery(question.context.question.id); await controller.settled();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(question.context.id);
    expect(controller.getSnapshot().session?.scenarios[0]?.questions).toHaveLength(1);
    expect(controller.getSnapshot().session?.scenarios[0]?.questions[0]?.state).toEqual({ _tag: "Pending", delivery: "accepted" });
    controller.dispose();
  });

  it("keeps drafts but prevents a second question until uncertain preparation is reconciled", async () => {
    const { controller, sessions, port, snapshot, sent, pendingTimers, setTime } = setup();
    const a = snapshot.scenarios[0]; const b = snapshot.scenarios[1];
    if (a === undefined || b === undefined) throw new Error("Missing fixture tabs");
    let prepares = 0;
    port.prepare = async (input) => {
      prepares++;
      const saved = sessions.prepare(input);
      if (saved._tag !== "Ok") return saved;
      return { _tag: "Err", error: { _tag: "HostUnavailable", message: "Receipt unavailable" } };
    };
    port.read = async () => ({ _tag: "Err", error: { _tag: "HostUnavailable", message: "Read unavailable" } });
    controller.editDraft("Original A question"); controller.submit(); await controller.settled();
    expect(controller.getSnapshot().synchronization).toBe("required");
    expect(pendingTimers.size).toBe(1);
    controller.selectTab(b.scenarioId); controller.editDraft("New draft in B");
    controller.submit(); await controller.settled();
    expect(prepares).toBe(1);
    expect(sent).toHaveLength(0);
    setTime(120_000);
    const next = pendingTimers.values().next().value;
    if (next === undefined) throw new Error("Missing recovery timer");
    pendingTimers.delete(next); next(); await controller.settled();
    expect(controller.getSnapshot().pollingPaused).toBe(true);
    expect(pendingTimers.size).toBe(0);
    port.read = async (input) => sessions.read(input);
    controller.checkAgain(); await controller.settled();
    const state = controller.getSnapshot();
    expect(state.synchronization).toBe("current");
    expect(state.activeScenarioId).toBe(b.scenarioId);
    expect(state.tabs.get(a.scenarioId)?.draft.text).toBe("Original A question");
    expect(state.tabs.get(b.scenarioId)?.draft.text).toBe("New draft in B");
    const question = state.session?.scenarios[0]?.questions[0];
    if (question === undefined) throw new Error("Missing recovered question");
    controller.stopWaiting(question.context.question.id); await controller.settled();
    expect(controller.getSnapshot().session?.scenarios[0]?.questions[0]?.state._tag).toBe("Cancelled");
    expect(sent).toHaveLength(0);
    controller.dispose();
  });

  it("allows explicit submission after a read proves the failed preparation did not commit", async () => {
    const { controller, sessions, port, sent } = setup();
    port.prepare = async () => ({ _tag: "Err", error: { _tag: "HostUnavailable", message: "Request did not arrive" } });
    controller.editDraft("Preserve this draft"); controller.submit(); await controller.settled();
    expect(controller.getSnapshot().synchronization).toBe("current");
    expect(controller.getSnapshot().session?.scenarios[0]?.questions).toHaveLength(0);
    expect(sent).toHaveLength(0);
    port.prepare = async (input) => sessions.prepare(input);
    controller.submit(); await controller.settled();
    expect(controller.getSnapshot().session?.scenarios[0]?.questions).toHaveLength(1);
    expect(sent).toHaveLength(1);
    controller.dispose();
  });

  it("does not use a read begun before preparation to clear its uncertainty", async () => {
    const { controller, sessions, port, sent, pendingTimers } = setup();
    let finishRead: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { finishRead = resolve; });
    port.read = async (input) => {
      const beforePreparation = sessions.read(input);
      await waiting;
      return beforePreparation;
    };
    controller.checkAgain();
    port.prepare = async (input) => {
      const saved = sessions.prepare(input);
      if (saved._tag !== "Ok") return saved;
      return { _tag: "Err", error: { _tag: "HostUnavailable", message: "Receipt lost" } };
    };
    controller.editDraft("Concurrent preparation"); controller.submit();
    if (finishRead === undefined) throw new Error("Missing read completion");
    finishRead(); await controller.settled();
    expect(controller.getSnapshot().synchronization).toBe("required");
    expect(controller.getSnapshot().session?.scenarios[0]?.questions).toHaveLength(0);
    port.read = async (input) => sessions.read(input);
    const next = pendingTimers.values().next().value;
    if (next === undefined) throw new Error("Missing reconciliation timer");
    pendingTimers.delete(next); next(); await controller.settled();
    expect(controller.getSnapshot().synchronization).toBe("current");
    expect(controller.getSnapshot().session?.scenarios[0]?.questions).toHaveLength(1);
    expect(sent).toHaveLength(0);
    controller.dispose();
  });

  it("pauses after the bounded wait and renews only on explicit checking", async () => {
    const { controller, pendingTimers, setTime, sent } = setup();
    controller.editDraft("Wait for an answer"); controller.submit(); await controller.settled();
    setTime(120_000);
    const next = pendingTimers.values().next().value;
    if (next === undefined) throw new Error("Missing scheduled read");
    pendingTimers.delete(next); next(); await controller.settled();
    expect(controller.getSnapshot().pollingPaused).toBe(true);
    expect(pendingTimers.size).toBe(0);
    controller.checkAgain(); await controller.settled();
    expect(controller.getSnapshot().pollingPaused).toBe(false);
    expect(pendingTimers.size).toBe(1);
    expect(sent).toHaveLength(1);
    controller.dispose();
  });

  it("ignores old and foreign snapshots and retains drafts after session loss", async () => {
    const { controller, sessions, port, snapshot } = setup();
    const scenario = snapshot.scenarios[0];
    if (scenario === undefined) throw new Error("Missing fixture scenario");
    controller.editDraft("Draft to preserve"); controller.submit(); await controller.settled();
    const version = controller.getSnapshot().session?.version;
    controller.accept(snapshot);
    expect(controller.getSnapshot().session?.version).toBe(version);
    const other = sessions.open(openReviewSchema.parse({ ...exampleReview(), requestId: "other" }));
    if (other._tag !== "Ok") throw new Error("Missing other session");
    controller.accept(other.value);
    expect(controller.getSnapshot().session?.sessionId).toBe(snapshot.sessionId);
    controller.editDraft("A new draft");
    port.read = async () => ({ _tag: "Err", error: { _tag: "SessionUnavailable", message: "Session ended" } });
    controller.checkAgain(); await controller.settled();
    expect(controller.getSnapshot().connection).toBe("unavailable");
    expect(controller.getSnapshot().tabs.get(scenario.scenarioId)?.draft.text).toBe("A new draft");
    controller.dispose();
  });
  it("routes A's answer while preserving B's draft and active tab", async () => {
    const { controller, sessions, snapshot, sent } = setup();
    const a = snapshot.scenarios[0]; const b = snapshot.scenarios[1];
    if (a === undefined || b === undefined) throw new Error("Missing fixture tabs");
    controller.editDraft("Why this shape?");
    controller.selectLines({ _tag: "Lines", side: "after", startLine: 3, endLine: 4 });
    controller.submit();
    await controller.settled();
    controller.selectTab(b.scenarioId);
    controller.editDraft("Keep this draft in B");
    const prepared = controller.getSnapshot().session?.scenarios[0]?.questions[0];
    if (prepared === undefined) throw new Error("Missing prepared question");
    const context = prepared.context;
    sessions.respond(respondSchema.parse({ sessionId: snapshot.sessionId, questionId: context.question.id, contextId: context.id,
      response: { _tag: "Answered", text: "The order is explicit.", alternative: null },
    }));
    controller.checkAgain();
    await controller.settled();
    const state = controller.getSnapshot();
    expect(state.activeScenarioId).toBe(b.scenarioId);
    expect(state.tabs.get(b.scenarioId)?.draft.text).toBe("Keep this draft in B");
    expect(state.tabs.get(a.scenarioId)?.unreadAnswers).toBe(1);
    expect(state.session?.scenarios[0]?.questions[0]?.state._tag).toBe("Completed");
    expect(sent).toHaveLength(1);
    controller.dispose();
  });

  it("never automatically resends uncertain delivery and cleans up polling", async () => {
    const { controller, port, sent, pendingTimers } = setup();
    port.send = async (message) => { sent.push(message); return { _tag: "Unconfirmed", message: "Uncertain" }; };
    controller.editDraft("Question"); controller.submit(); await controller.settled();
    controller.checkAgain(); await controller.settled();
    expect(sent).toHaveLength(1);
    expect(controller.getSnapshot().session?.scenarios[0]?.questions[0]?.state).toEqual({ _tag: "Pending", delivery: "unconfirmed" });
    controller.setVisible(false);
    expect(pendingTimers.size).toBe(0);
    controller.dispose();
    await controller.settled();
    expect(pendingTimers.size).toBe(0);
  });
});
