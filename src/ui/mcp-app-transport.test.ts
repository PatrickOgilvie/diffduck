import { describe, expect, it } from "bun:test";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { toolContracts } from "../protocol/diffduck.js";
import { createDiffDuckServer } from "../server/create-diffduck-server.js";
import { defaultSessionLimits, ReviewSessions } from "../service/review-sessions.js";
import { exampleReview, testUuid } from "../testing/fixtures.js";
import { DiffDuckBridge } from "./diffduck-bridge.js";
import { DiscussionController } from "./discussion-controller.js";
import { parseDiffDuckToolResult } from "./diffduck-tool-result.js";

describe("real MCP Apps transport", () => {
  it.each([
    ["structured", 0, false], ["text-only", 0, false], ["text-only", 1150, false],
    ["structured", 1250, true], ["text-only", 1250, true],
    ["structured-null-omitted", 0, false], ["structured-null-omitted", 1150, false],
  ] as const)("handles %s results with %i padding lines through the App SDK", async (mode, paddingLines, overLimit) => {
    let nextId = 1;
    const sessions = new ReviewSessions({ newUuid: () => testUuid(nextId++), now: () => "2026-09-03T12:00:00.000Z", emit: () => {} }, defaultSessionLimits);
    const server = createDiffDuckServer(sessions, async () => "<!doctype html><title>DiffDuck</title>");
    const client = new Client({ name: "diffduck-app-transport-test", version: "0.2.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const app = new App({ name: "DiffDuck", version: "0.2.0" }, {}, { autoResize: false });
    const host = new AppBridge(null, { name: "transport-test-host", version: "1" }, { serverTools: {}, message: { text: {} } });
    const [appTransport, hostTransport] = InMemoryTransport.createLinkedPair();
    const sent: string[] = [];
    host.oncalltool = async (input, options) => {
      const result = CallToolResultSchema.parse(await client.callTool(input, undefined, { signal: options.signal }));
      if (mode === "structured-null-omitted") {
        // Model the suspected lossy host hop. Do not alter text blocks or the
        // authoritative server: removing nulls there would weaken the test.
        const structuredContent: unknown = JSON.parse(JSON.stringify(result.structuredContent, (_key, value: unknown) => value === null ? undefined : value));
        return CallToolResultSchema.parse({ ...result, structuredContent });
      }
      // Exercise the documented text representation through the actual App SDK.
      return mode === "structured" ? result : { content: result.content, isError: result.isError ?? false };
    };
    host.onmessage = async (input) => {
      for (const block of input.content) if (block.type === "text") sent.push(block.text);
      return {};
    };
    const controller = new DiscussionController(new DiffDuckBridge(app), {
      newUuid: () => testUuid(nextId++), nowMs: () => 0, schedule: () => () => {},
    });
    try {
      await server.connect(serverTransport); await client.connect(clientTransport); await client.listTools();
      await host.connect(hostTransport); await app.connect(appTransport);
      const fixture = exampleReview();
      // JSON encodes each newline as two bytes: 1150 lines per pane leave the
      // complete context below 32 KiB; 1250 deliberately cross the boundary.
      const padding = "// boundary\n".repeat(paddingLines);
      const input = { ...fixture, review: { ...fixture.review, scenarios: fixture.review.scenarios.map((scenario, index) => index === 0 ? {
        ...scenario, before: { ...scenario.before, code: scenario.before.code + padding }, after: { ...scenario.after, code: scenario.after.code + padding },
      } : scenario) } };
      const openingResult = CallToolResultSchema.parse(await client.callTool({ name: "show_diffduck_review", arguments: input }));
      const opening = parseDiffDuckToolResult("show_diffduck_review", mode === "text-only" ? { content: openingResult.content } : openingResult, toolContracts.show_diffduck_review.output);
      if (opening._tag !== "Ok") throw new Error("Opening failed");
      const a = opening.value.scenarios[0]; const b = opening.value.scenarios[1];
      if (a === undefined || b === undefined) throw new Error("Missing fixture scenarios");
      const firstRead = await new DiffDuckBridge(app).read(toolContracts.read_diffduck_session.input.parse({ sessionId: opening.value.sessionId, afterVersion: null }), {});
      if (firstRead._tag === "Err") throw new Error(firstRead.error.message);
      expect(firstRead).toEqual({ _tag: "Ok", value: { _tag: "Changed", snapshot: opening.value } });
      controller.accept(opening.value);
      controller.editDraft("Why are the steps separate?");
      controller.selectLines({ _tag: "Lines", side: "after", startLine: 3, endLine: 4 });
      controller.submit(); await controller.settled();
      if (overLimit) {
        const failed = controller.getSnapshot();
        expect(failed.tabs.get(a.scenarioId)?.message).toContain("exceed the question-context limit");
        expect(failed.tabs.get(a.scenarioId)?.draft.text).toBe("Why are the steps separate?");
        expect(failed.session?.scenarios[0]?.questions).toHaveLength(0);
        expect(sent).toHaveLength(0);
        // A rejected preparation must not occupy the single-flight slot.
        controller.selectTab(b.scenarioId); controller.editDraft("What changed in error handling?");
        controller.submit(); await controller.settled();
        expect(controller.getSnapshot().tabs.get(b.scenarioId)?.message).toBeNull();
        expect(controller.getSnapshot().session?.scenarios[1]?.questions[0]?.state).toEqual({ _tag: "Pending", delivery: "accepted" });
        expect(sent).toHaveLength(1);
        return;
      }
      expect(controller.getSnapshot().tabs.get(a.scenarioId)?.message).toBeNull();
      expect(sent).toHaveLength(1);
      const question = controller.getSnapshot().session?.scenarios[0]?.questions[0];
      if (question === undefined) throw new Error("Question not prepared");
      expect(question.state).toEqual({ _tag: "Pending", delivery: "accepted" });
      const ref = { sessionId: question.context.sessionId, questionId: question.context.question.id, contextId: question.context.id };
      expect(sent[0]).toContain(JSON.stringify(ref));
      const context = toolContracts.get_diffduck_question.output.parse((await client.callTool({ name: "get_diffduck_question", arguments: ref })).structuredContent);
      if (context._tag !== "Ok") throw new Error("Context missing");
      expect(context.value).toEqual(question.context);
      expect(context.value.question.target).toMatchObject({ selectedText: "const result = await Pipeline.from(input)\n  .through(parse)\n" });
      const firstScenario = input.review.scenarios[0];
      if (firstScenario === undefined) throw new Error("Missing fixture scenario");
      expect(context.value.example.scenario.before.code).toBe(firstScenario.before.code.replace(/\r\n?/g, "\n"));
      expect(context.value.example.scenario.after.code).toBe(firstScenario.after.code);
      if (paddingLines > 0) {
        const bytes = new TextEncoder().encode(JSON.stringify(context.value)).length;
        expect(bytes).toBeGreaterThan(30_000);
        expect(bytes).toBeLessThanOrEqual(defaultSessionLimits.maxContextBytes);
      }
      controller.selectTab(b.scenarioId); controller.editDraft("Preserve this other draft");
      await client.callTool({ name: "respond_in_diffduck", arguments: { ...ref, response: { _tag: "Answered", text: "The order is explicit.", alternative: null } } });
      controller.checkAgain(); await controller.settled();
      const completed = controller.getSnapshot();
      expect(completed.session?.scenarios[0]?.questions[0]?.state).toMatchObject({ _tag: "Completed", response: { text: "The order is explicit.", alternative: null } });
      expect(completed.session?.scenarios[0]?.questions[0]?.adoptedRevisionId).toBeNull();
      expect(completed.activeScenarioId).toBe(b.scenarioId);
      expect(completed.tabs.get(b.scenarioId)?.draft.text).toBe("Preserve this other draft");
      expect(completed.tabs.get(a.scenarioId)?.unreadAnswers).toBe(1);
      expect(sent).toHaveLength(1);
      if (mode === "structured-null-omitted" && paddingLines === 0) {
        controller.selectTab(a.scenarioId); controller.replyTo(question.context.question.id);
        controller.setIntent("explore-alternative"); controller.editDraft("Show an alternative");
        controller.submit(); await controller.settled();
        const followUp = controller.getSnapshot().session?.scenarios[0]?.questions[1];
        if (followUp === undefined) throw new Error("Follow-up not prepared");
        expect(followUp.context.question.replyToQuestionId).toBe(question.context.question.id);
        expect(followUp.context.history[0]?.outcome).toMatchObject({ _tag: "Completed", response: { alternative: null } });
        await client.callTool({ name: "respond_in_diffduck", arguments: {
          sessionId: followUp.context.sessionId, questionId: followUp.context.question.id, contextId: followUp.context.id,
          response: { _tag: "Answered", text: "Here is another composition.", alternative: {
            basedOnRevisionId: a.currentRevisionId, after: { label: "Alternative", code: "const result = pipe(input, parse);\n" }, observations: [],
          } },
        } });
        controller.checkAgain(); await controller.settled();
        controller.adopt(followUp.context.question.id); await controller.settled();
        const revised = controller.getSnapshot().session?.scenarios[0];
        if (revised === undefined) throw new Error("Revised example missing");
        expect(revised.revisions[0]?.parentRevisionId).toBeNull();
        expect(revised.revisions[1]?.parentRevisionId).toBe(a.currentRevisionId);
        expect(revised.revisions[1]?.scenario.before).toEqual(a.revisions[0]?.scenario.before);
        expect(revised.questions[1]?.adoptedRevisionId).toBe(revised.currentRevisionId);
        controller.editDraft("What about error handling?"); controller.submit(); await controller.settled();
        const pending = controller.getSnapshot().session?.scenarios[0]?.questions[2];
        if (pending === undefined) throw new Error("Cancellation fixture not prepared");
        controller.stopWaiting(pending.context.question.id); await controller.settled();
        expect(controller.getSnapshot().session?.scenarios[0]?.questions[2]?.state).toEqual({ _tag: "Cancelled" });
        expect(controller.getSnapshot().tabs.get(b.scenarioId)?.draft.text).toBe("Preserve this other draft");
        expect(sent).toHaveLength(3);
      }
    } finally {
      controller.dispose(); await controller.settled();
      await app.close(); await host.close(); await client.close(); await server.close();
    }
  });
});
