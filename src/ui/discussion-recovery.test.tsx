import { expect, it } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { App } from "@modelcontextprotocol/ext-apps";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { toolContracts } from "../protocol/diffduck.js";
import { createDiffDuckServer } from "../server/create-diffduck-server.js";
import { defaultSessionLimits, ReviewSessions } from "../service/review-sessions.js";
import { exampleReview, testUuid } from "../testing/fixtures.js";
import { DiffDuckBridge } from "./diffduck-bridge.js";
import { DiscussionController } from "./discussion-controller.js";
import { DiscussionPanel } from "./discussion-panel.js";

function renderDiscussion(controller: DiscussionController): string {
  const state = controller.getSnapshot();
  const scenario = state.session?.scenarios.find((item) => item.scenarioId === state.activeScenarioId);
  const tab = scenario === undefined ? undefined : state.tabs.get(scenario.scenarioId);
  if (scenario === undefined || tab === undefined) throw new Error("Missing discussion fixture");
  return renderToStaticMarkup(<DiscussionPanel controller={controller} state={state} scenario={scenario}
    tab={tab} composerRef={createRef<HTMLTextAreaElement>()} interactive />);
}

it("recovers a lost MCP receipt into actionable UI without losing A's context or B's draft", async () => {
  let id = 1;
  const sessions = new ReviewSessions({ newUuid: () => testUuid(id++), now: () => "2026-09-03T12:00:00.000Z", emit: () => {} }, defaultSessionLimits);
  const server = createDiffDuckServer(sessions, async () => "<!doctype html><title>DiffDuck</title>");
  const client = new Client({ name: "diffduck-recovery-test", version: "0.2.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sent: string[] = [];
  let losePreparationReceipt = true;
  let readsUnavailable = true;
  const host: Pick<App, "callServerTool" | "sendMessage"> = {
    callServerTool: async (input, options) => {
      if (input.name === "read_diffduck_session" && readsUnavailable) throw new Error("private host detail");
      const result = CallToolResultSchema.parse(await client.callTool(input, undefined, options));
      // The real tool has committed; lose only the response at the external host seam.
      if (input.name === "prepare_diffduck_question" && losePreparationReceipt) return { content: [] };
      return result;
    },
    sendMessage: async (input) => {
      for (const block of input.content) if (block.type === "text") sent.push(block.text);
      return {};
    },
  };
  const controller = new DiscussionController(new DiffDuckBridge(host), {
    newUuid: () => testUuid(id++), nowMs: () => 0, schedule: () => () => {},
  });
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    await client.listTools();
    const opening = toolContracts.show_diffduck_review.output.parse((await client.callTool({ name: "show_diffduck_review", arguments: exampleReview() })).structuredContent);
    if (opening._tag !== "Ok") throw new Error("Opening failed");
    const a = opening.value.scenarios[0]; const b = opening.value.scenarios[1];
    if (a === undefined || b === undefined) throw new Error("Missing fixture tabs");
    const original = a.revisions[0];
    if (original === undefined) throw new Error("Missing original example");
    controller.accept(opening.value);
    controller.editDraft("Why these steps?");
    controller.selectLines({ _tag: "Lines", side: "after", startLine: 3, endLine: 4 });
    controller.submit(); await controller.settled();
    const recovery = renderDiscussion(controller);
    expect(recovery).toContain('aria-label="Recover question"');
    expect(recovery).toContain("Check again");
    expect(recovery).toContain('type="submit" disabled=""');
    expect(recovery).toContain("Why these steps?");
    expect(recovery).not.toContain("private host detail");
    expect(sent).toHaveLength(0);

    controller.selectTab(b.scenarioId); controller.editDraft("Leave this B draft alone");
    readsUnavailable = false; losePreparationReceipt = false;
    controller.checkAgain(); await controller.settled();
    const recovered = controller.getSnapshot();
    const question = recovered.session?.scenarios[0]?.questions[0];
    if (question === undefined) throw new Error("Question was not recovered");
    expect(recovered.activeScenarioId).toBe(b.scenarioId);
    expect(recovered.tabs.get(b.scenarioId)?.draft.text).toBe("Leave this B draft alone");
    const ref = { sessionId: question.context.sessionId, questionId: question.context.question.id, contextId: question.context.id };
    const frozen = toolContracts.get_diffduck_question.output.parse((await client.callTool({ name: "get_diffduck_question", arguments: ref })).structuredContent);
    if (frozen._tag !== "Ok") throw new Error("Frozen context missing");
    expect(frozen.value).toEqual(question.context);
    expect(frozen.value.question.target).toMatchObject({ selectedText: "const result = await Pipeline.from(input)\n  .through(parse)\n" });
    expect(frozen.value.example).toEqual(original);

    controller.selectTab(a.scenarioId);
    const pending = renderDiscussion(controller);
    expect(pending).not.toContain('aria-label="Recover question"');
    expect(pending).toContain("Stop waiting");
    expect(pending).toContain("Retry anyway");
    controller.retryDelivery(ref.questionId); await controller.settled();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(JSON.stringify(ref));
    expect(controller.getSnapshot().session?.scenarios[0]?.questions).toHaveLength(1);

    controller.selectTab(b.scenarioId);
    const response = await client.callTool({ name: "respond_in_diffduck", arguments: { ...ref, response: { _tag: "Answered", text: "The execution order is explicit.", alternative: null } } });
    expect(response.isError).toBe(false);
    controller.checkAgain(); await controller.settled();
    const answered = controller.getSnapshot();
    expect(answered.activeScenarioId).toBe(b.scenarioId);
    expect(answered.tabs.get(b.scenarioId)?.draft.text).toBe("Leave this B draft alone");
    expect(answered.tabs.get(a.scenarioId)?.unreadAnswers).toBe(1);
    controller.selectTab(a.scenarioId);
    expect(renderDiscussion(controller)).toContain("The execution order is explicit.");
  } finally {
    controller.dispose(); await controller.settled(); await client.close(); await server.close();
  }
});
