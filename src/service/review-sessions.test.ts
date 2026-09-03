import { describe, expect, it } from "bun:test";
import { adoptAlternativeSchema, openReviewSchema, prepareQuestionSchema, respondSchema } from "../domain/commands.js";
import type { Result, SessionSnapshot } from "../domain/discussion.js";
import { exampleReview, testUuid } from "../testing/fixtures.js";
import { ReviewSessions, defaultSessionLimits } from "./review-sessions.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (result._tag === "Err") throw new Error(`Unexpected test failure: ${JSON.stringify(result.error)}`);
  return result.value;
}

function setup() {
  let id = 1;
  const sessions = new ReviewSessions({
    newUuid: () => testUuid(id++), now: () => "2026-09-03T12:00:00.000Z", emit: () => {},
  }, defaultSessionLimits);
  const snapshot = unwrap(sessions.open(exampleReview()));
  return { sessions, snapshot };
}

function question(snapshot: SessionSnapshot, scenarioIndex = 0, id = 100) {
  const scenario = snapshot.scenarios[scenarioIndex];
  if (scenario === undefined) throw new Error("Missing test scenario");
  return prepareQuestionSchema.parse({
    sessionId: snapshot.sessionId, questionId: testUuid(id), scenarioId: scenario.scenarioId,
    exampleRevisionId: scenario.currentRevisionId, expectedTranscriptVersion: scenario.transcriptVersion,
    intent: "ask", text: "Why this shape?", target: { _tag: "Lines", side: "after", startLine: 3, endLine: 4 },
    replyToQuestionId: null,
  });
}

describe("session-backed discussions", () => {
  it("enforces session count and byte capacity without retaining a failed opening", () => {
    let id = 1;
    const runtime = { newUuid: () => testUuid(id++), now: () => "2026-09-03T12:00:00.000Z", emit: () => {} };
    const sessions = new ReviewSessions(runtime, { ...defaultSessionLimits, maxSessions: 1, maxSessionBytes: 15_000 });
    const review = exampleReview();
    const large = openReviewSchema.parse({ ...review, review: { ...review.review, scenarios: review.review.scenarios.map((s) => ({ ...s, after: { ...s.after, code: "x".repeat(10_000) } })) } });
    expect(sessions.open(large)).toMatchObject({ _tag: "Err", error: { _tag: "SessionCapacityExceeded" } });
    const opened = unwrap(sessions.open(review));
    expect(unwrap(sessions.open(review)).sessionId).toBe(opened.sessionId);
    const next = openReviewSchema.parse({ ...review, requestId: "second-review" });
    expect(sessions.open(next)).toMatchObject({ _tag: "Err", error: { _tag: "SessionCapacityExceeded" } });
  });

  it("freezes nested context and rejects references from another session", () => {
    const { sessions, snapshot } = setup();
    const prepared = unwrap(sessions.prepare(question(snapshot)));
    const context = unwrap(sessions.getQuestion(prepared.ref));
    expect(Object.isFrozen(context.example.scenario.after)).toBe(true);
    expect(Object.isFrozen(context.history)).toBe(true);
    expect(Reflect.set(context.example.scenario.after, "code", "altered")).toBe(false);
    const other = unwrap(sessions.open(openReviewSchema.parse({ ...exampleReview(), requestId: "second" })));
    expect(sessions.getQuestion({ ...prepared.ref, sessionId: other.sessionId })).toMatchObject({ _tag: "Err", error: { _tag: "UnknownReference" } });
    expect(unwrap(sessions.getQuestion(prepared.ref))).toEqual(context);
  });
  it("normalizes display code before capturing immutable context and routes the answer", () => {
    const { sessions, snapshot } = setup();
    expect(snapshot.scenarios[0]?.revisions[0]?.scenario.before.code).not.toContain("\r");
    const prepared = unwrap(sessions.prepare(question(snapshot)));
    const context = unwrap(sessions.getQuestion(prepared.ref));
    expect(context.question.target).toEqual({
      _tag: "Lines", side: "after", startLine: 3, endLine: 4,
      selectedText: "const result = await Pipeline.from(input)\n  .through(parse)\n",
    });
    const reply = respondSchema.parse({ ...prepared.ref, response: { _tag: "Answered", text: "Order is explicit.", alternative: null } });
    unwrap(sessions.respond(reply));
    expect(unwrap(sessions.getQuestion(prepared.ref))).toEqual(context);
    const read = unwrap(sessions.read({ sessionId: snapshot.sessionId, afterVersion: null }));
    expect(read._tag).toBe("Changed");
    if (read._tag === "Changed") {
      expect(read.snapshot.scenarios[0]?.questions[0]?.state._tag).toBe("Completed");
      expect(read.snapshot.scenarios[1]?.questions).toHaveLength(0);
    }
  });

  it("replays identities and allows only one outstanding question", () => {
    const { sessions, snapshot } = setup();
    expect(unwrap(sessions.open(exampleReview())).sessionId).toBe(snapshot.sessionId);
    const input = question(snapshot);
    const first = unwrap(sessions.prepare(input));
    expect(unwrap(sessions.prepare(input)).disposition).toBe("replayed");
    expect(sessions.prepare({ ...input, text: "different" })).toMatchObject({ _tag: "Err", error: { _tag: "IdempotencyConflict" } });
    expect(sessions.prepare(question(first.snapshot, 1, 101))).toMatchObject({ _tag: "Err", error: { _tag: "QuestionInFlight" } });
  });

  it("preserves a reply that arrives before its delivery acknowledgement", () => {
    const { sessions, snapshot } = setup();
    const prepared = unwrap(sessions.prepare(question(snapshot)));
    const reply = respondSchema.parse({ ...prepared.ref, response: { _tag: "Answered", text: "Answer first.", alternative: null } });
    unwrap(sessions.respond(reply));
    const current = unwrap(sessions.recordDelivery({ ...prepared.ref, delivery: "accepted" }));
    expect(current.scenarios[0]?.questions[0]?.state._tag).toBe("Completed");
    expect(sessions.respond(reply)._tag).toBe("Ok");
    expect(sessions.respond({ ...reply, response: { _tag: "CannotAnswer", reason: "Different outcome" } })).toMatchObject({ _tag: "Err", error: { _tag: "IdempotencyConflict" } });
  });

  it("rejects late replies after cancellation and does not invent a fresh session", () => {
    const { sessions, snapshot } = setup();
    const prepared = unwrap(sessions.prepare(question(snapshot)));
    unwrap(sessions.cancel(prepared.ref));
    expect(sessions.respond(respondSchema.parse({ ...prepared.ref, response: { _tag: "CannotAnswer", reason: "late" } })))
      .toMatchObject({ _tag: "Err", error: { _tag: "QuestionClosed" } });
    const fresh = new ReviewSessions({ newUuid: () => testUuid(999), now: () => "2026-09-03T12:00:00.000Z", emit: () => {} }, defaultSessionLimits);
    expect(fresh.read({ sessionId: prepared.ref.sessionId, afterVersion: null })).toMatchObject({ _tag: "Err", error: { _tag: "SessionUnavailable" } });
    expect(sessions.getQuestion({ ...prepared.ref, contextId: respondSchema.parse({ ...prepared.ref, contextId: testUuid(999), response: { _tag: "CannotAnswer", reason: "x" } }).contextId }))
      .toMatchObject({ _tag: "Err", error: { _tag: "ContextMismatch" } });
  });

  it("includes only this scenario's preceding discussion and rejects unseen transcript state", () => {
    const { sessions, snapshot } = setup();
    const first = unwrap(sessions.prepare(question(snapshot)));
    unwrap(sessions.respond(respondSchema.parse({ ...first.ref, response: { _tag: "Answered", text: "A's answer", alternative: null } })));
    expect(sessions.prepare(question(snapshot, 0, 102))).toMatchObject({ _tag: "Err", error: { _tag: "TranscriptChanged" } });
    const current = unwrap(sessions.recordDelivery({ ...first.ref, delivery: "accepted" }));
    const followup = unwrap(sessions.prepare({ ...question(current, 0, 103), replyToQuestionId: first.ref.questionId }));
    const context = unwrap(sessions.getQuestion(followup.ref));
    expect(context.history).toHaveLength(1);
    expect(context.history[0]?.question.text).toBe("Why this shape?");
    const cancelled = unwrap(sessions.cancel(followup.ref));
    const b = unwrap(sessions.prepare(question(cancelled, 1, 104)));
    expect(unwrap(sessions.getQuestion(b.ref)).history).toHaveLength(0);
    expect(unwrap(sessions.getQuestion(first.ref)).history).toHaveLength(0);
  });

  it("uses alternatives as new after-only revisions and retains historical anchors", () => {
    const { sessions, snapshot } = setup();
    const input = prepareQuestionSchema.parse({ ...question(snapshot), intent: "explore-alternative" });
    const prepared = unwrap(sessions.prepare(input));
    const original = unwrap(sessions.getQuestion(prepared.ref));
    const reply = respondSchema.parse({ ...prepared.ref, response: {
      _tag: "Answered", text: "Try explicit composition.", alternative: {
        basedOnRevisionId: original.example.id, after: { label: "Alternative", code: "const result = compose(input);\r\n" }, observations: ["One operation."],
      },
    } });
    unwrap(sessions.respond(reply));
    // Retrying the identical command must survive canonical newline normalization.
    expect(sessions.respond(reply)._tag).toBe("Ok");
    const adopt = adoptAlternativeSchema.parse({ sessionId: snapshot.sessionId, questionId: prepared.ref.questionId, expectedCurrentRevisionId: original.example.id });
    const adopted = unwrap(sessions.adopt(adopt));
    const scenario = adopted.scenarios[0];
    if (scenario === undefined) throw new Error("Missing scenario");
    expect(scenario.revisions).toHaveLength(2);
    expect(scenario.revisions[1]?.scenario.before).toEqual(original.example.scenario.before);
    expect(scenario.revisions[1]?.scenario.after.code).toBe("const result = compose(input);\n");
    expect(scenario.revisions[1]?.scenario.provenance.after._tag).toBe("Proposed");
    expect(unwrap(sessions.adopt(adopt)).version).toBe(adopted.version);
    expect(unwrap(sessions.getQuestion(prepared.ref))).toEqual(original);

    const oldProposal = unwrap(sessions.prepare(prepareQuestionSchema.parse({
      ...question(adopted, 0, 105), exampleRevisionId: original.example.id, intent: "explore-alternative",
    })));
    unwrap(sessions.respond(respondSchema.parse({ ...reply, ...oldProposal.ref })));
    expect(sessions.adopt({ ...adopt, questionId: oldProposal.ref.questionId, expectedCurrentRevisionId: scenario.currentRevisionId }))
      .toMatchObject({ _tag: "Err", error: { _tag: "RevisionConflict" } });
  });

  it("rejects mismatched responses without closing the pending question", () => {
    const { sessions, snapshot } = setup();
    const prepared = unwrap(sessions.prepare(question(snapshot)));
    const example = unwrap(sessions.getQuestion(prepared.ref)).example;
    expect(sessions.respond(respondSchema.parse({ ...prepared.ref, response: { _tag: "Answered", text: "Not requested", alternative: {
      basedOnRevisionId: example.id, after: { label: "Other", code: "different()" }, observations: [],
    } } }))).toMatchObject({ _tag: "Err", error: { _tag: "InvalidResponse" } });
    const read = unwrap(sessions.read({ sessionId: snapshot.sessionId, afterVersion: null }));
    if (read._tag !== "Changed") throw new Error("Expected snapshot");
    expect(read.snapshot.scenarios[0]?.questions[0]?.state._tag).toBe("Pending");
  });

  it("rejects oversized context before reserving the outstanding-question slot", () => {
    let id = 200;
    const events: unknown[] = [];
    const sessions = new ReviewSessions({ newUuid: () => testUuid(id++), now: () => "2026-09-03T12:00:00.000Z", emit: (event) => { events.push(event); } },
      { ...defaultSessionLimits, maxContextBytes: 100 });
    const snapshot = unwrap(sessions.open(exampleReview()));
    expect(sessions.prepare(question(snapshot))).toMatchObject({ _tag: "Err", error: { _tag: "ContextTooLarge" } });
    const read = unwrap(sessions.read({ sessionId: snapshot.sessionId, afterVersion: null }));
    if (read._tag !== "Changed") throw new Error("Expected snapshot");
    expect(read.snapshot.scenarios[0]?.questions).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain("pipeline");
    expect(events).toEqual([{ event: "SessionOpened", elapsedMs: 0 }]);
  });
});
