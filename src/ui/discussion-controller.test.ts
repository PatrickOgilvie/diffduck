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
