import { describe, expect, it } from "bun:test";
import { prepareQuestionSchema, respondSchema } from "../domain/commands.js";
import type { Result } from "../domain/discussion.js";
import { ReviewSessions, defaultSessionLimits } from "../service/review-sessions.js";
import { exampleReview, testUuid } from "../testing/fixtures.js";
import { buildRevisionPanels, resolveRevisionSelection, selectionInRevisionPanel } from "./revision-panels.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (result._tag === "Err") throw new Error(`Invalid fixture: ${JSON.stringify(result.error)}`);
  return result.value;
}

function history() {
  let id = 1;
  const sessions = new ReviewSessions({ newUuid: () => testUuid(id++), now: () => "2026-09-03T12:00:00.000Z", emit: () => {} }, defaultSessionLimits);
  let snapshot = unwrap(sessions.open(exampleReview()));
  for (const [index, code] of ['const result = compose(input);\n', 'const result = pipe(input, parse, validate);\n'].entries()) {
    const scenario = snapshot.scenarios[0];
    if (scenario === undefined) throw new Error("Missing scenario");
    const prepared = unwrap(sessions.prepare(prepareQuestionSchema.parse({
      sessionId: snapshot.sessionId, questionId: testUuid(100 + index), scenarioId: scenario.scenarioId,
      exampleRevisionId: scenario.currentRevisionId, expectedTranscriptVersion: scenario.transcriptVersion,
      intent: "explore-alternative", text: `Explore revision ${index + 2}`, target: { _tag: "WholeExample" }, replyToQuestionId: null,
    })));
    unwrap(sessions.respond(respondSchema.parse({ ...prepared.ref, response: {
      _tag: "Answered", text: "A different call site.", alternative: {
        basedOnRevisionId: scenario.currentRevisionId, after: { label: `Alternative ${index + 2}`, code }, observations: ["A more compact call site."],
      },
    } })));
    snapshot = unwrap(sessions.adopt({ sessionId: snapshot.sessionId, questionId: prepared.ref.questionId, expectedCurrentRevisionId: scenario.currentRevisionId }));
  }
  const scenario = snapshot.scenarios[0];
  if (scenario === undefined) throw new Error("Missing scenario");
  const panels = unwrap(buildRevisionPanels(scenario));
  const [baseline, first, second, third] = panels;
  if (baseline === undefined || first === undefined || second === undefined || third === undefined) throw new Error("Missing revision panels");
  return { sessions, snapshot, scenario, panels, baseline, first, second, third };
}

describe("revision trail", () => {
  it("keeps every column and compares each adopted after-example against its immediate predecessor", () => {
    const { panels, baseline, first, second, third } = history();
    expect(panels.map((panel) => panel.source.label)).toEqual(["Before", "Revision 1", "Revision 2", "Revision 3"]);
    expect(new Set(panels.map((panel) => panel.id)).size).toBe(4);
    expect(baseline.previous).toBeNull();
    expect(baseline.source.side).toBe("before");
    expect(first.previous).toEqual(baseline.source);
    expect(second.previous).toEqual(first.source);
    expect(third.previous).toEqual(second.source);
    expect(second.previous?.side).toBe("after");
    expect(third.previous?.revision.scenario.after.code).toBe("const result = compose(input);\n");
    expect(third.source.revision.scenario.before).toEqual(baseline.source.revision.scenario.before);
  });

  it("resolves original, added and removed lines to the exact saved source", () => {
    const { baseline, first, second } = history();
    expect(unwrap(resolveRevisionSelection(baseline, { start: 3, end: 3 }))).toEqual({ revisionId: first.source.revision.id, target: { _tag: "Lines", side: "before", startLine: 3, endLine: 3 } });
    expect(unwrap(resolveRevisionSelection(second, { side: "additions", start: 1, end: 1 }))).toEqual({ revisionId: second.source.revision.id, target: { _tag: "Lines", side: "after", startLine: 1, endLine: 1 } });
    const removed = unwrap(resolveRevisionSelection(second, { side: "deletions", start: 4, end: 3 }));
    expect(removed).toEqual({ revisionId: first.source.revision.id, target: { _tag: "Lines", side: "after", startLine: 3, endLine: 4 } });
    expect(selectionInRevisionPanel(first, removed)).toEqual({ side: "additions", start: 3, end: 4 });
    expect(selectionInRevisionPanel(second, removed)).toEqual({ side: "deletions", start: 3, end: 4 });
    expect(selectionInRevisionPanel(baseline, removed)).toBeNull();
    expect(unwrap(resolveRevisionSelection(second, null))).toEqual({ revisionId: second.source.revision.id, target: { _tag: "WholeExample" } });
  });

  it("rejects cross-version, fractional and out-of-source selections", () => {
    const { baseline, second } = history();
    for (const range of [
      { side: "deletions", endSide: "additions", start: 1, end: 1 },
      { side: "additions", start: 1, end: 2 },
      { side: "deletions", start: 0, end: 1 },
      { side: "deletions", start: 1.5, end: 2 },
    ] as const) expect(resolveRevisionSelection(second, range)).toMatchObject({ _tag: "Err", error: { _tag: "InvalidSelection" } });
    expect(resolveRevisionSelection(baseline, { side: "deletions", start: 1, end: 1 })._tag).toBe("Err");
  });

  it("refuses missing or out-of-order parents instead of inventing a comparison", () => {
    const { first, second, third } = history();
    for (const revisions of [[], [second.source.revision], [first.source.revision, third.source.revision], [first.source.revision, third.source.revision, second.source.revision], [first.source.revision, second.source.revision, { ...third.source.revision, id: first.source.revision.id }]]) {
      expect(buildRevisionPanels({ revisions })).toMatchObject({ _tag: "Err", error: { _tag: "InvalidRevisionHistory" } });
    }
  });

  it("sends predecessor lines through the real question seam without changing historical context", () => {
    const { sessions, snapshot, scenario, first, second } = history();
    const selection = unwrap(resolveRevisionSelection(second, { side: "deletions", start: 3, end: 4 }));
    const originalContext = scenario.questions[0]?.context;
    const prepared = unwrap(sessions.prepare(prepareQuestionSchema.parse({
      sessionId: snapshot.sessionId, questionId: testUuid(110), scenarioId: scenario.scenarioId,
      exampleRevisionId: selection.revisionId, expectedTranscriptVersion: scenario.transcriptVersion,
      intent: "ask", text: "Why were these calls removed?", target: selection.target, replyToQuestionId: null,
    })));
    const context = unwrap(sessions.getQuestion(prepared.ref));
    expect(context.example.id).toBe(first.source.revision.id);
    expect(context.question.target).toEqual({ _tag: "Lines", side: "after", startLine: 3, endLine: 4, selectedText: "const result = await Pipeline.from(input)\n  .through(parse)\n" });
    expect(context.history).toHaveLength(2);
    expect(prepared.snapshot.scenarios[0]?.questions[0]?.context).toEqual(originalContext);
  });
});
