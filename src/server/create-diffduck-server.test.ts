import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { toolContracts } from "../protocol/diffduck.js";
import { ReviewSessions, defaultSessionLimits } from "../service/review-sessions.js";
import { exampleReview, testUuid } from "../testing/fixtures.js";
import { createDiffDuckServer } from "./create-diffduck-server.js";

describe("DiffDuck MCP boundary", () => {
  it("round-trips a frozen question and reply without attaching another UI", async () => {
    let id = 1;
    const sessions = new ReviewSessions({ newUuid: () => testUuid(id++), now: () => "2026-09-03T12:00:00.000Z", emit: () => {} }, defaultSessionLimits);
    const server = createDiffDuckServer(sessions, async () => "<!doctype html><title>DiffDuck</title>");
    const client = new Client({ name: "diffduck-test", version: "0.2.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(8);
      for (const tool of listed.tools) {
        expect(tool.inputSchema.additionalProperties).toBe(false);
        if (tool.name === "show_diffduck_review") {
          expect(tool._meta?.["ui/resourceUri"]).toBe("ui://diffduck/review.html");
          expect(tool.annotations?.readOnlyHint).toBe(false);
        } else expect(tool._meta?.["ui/resourceUri"]).toBeUndefined();
      }
      expect(listed.tools.find((tool) => tool.name === "prepare_diffduck_question")?._meta?.ui).toEqual({ visibility: ["app"] });
      const openedResult = await client.callTool({ name: "show_diffduck_review", arguments: exampleReview() });
      expect(openedResult).toMatchObject({ isError: false });
      const opened = toolContracts.show_diffduck_review.output.parse(openedResult.structuredContent);
      if (opened._tag !== "Ok") throw new Error("Opening failed");
      const a = opened.value.scenarios[0];
      if (a === undefined) throw new Error("Missing scenario");
      const prepared = toolContracts.prepare_diffduck_question.output.parse((await client.callTool({ name: "prepare_diffduck_question", arguments: {
        sessionId: opened.value.sessionId, questionId: testUuid(100), scenarioId: a.scenarioId,
        exampleRevisionId: a.currentRevisionId, expectedTranscriptVersion: a.transcriptVersion,
        intent: "ask", text: "Is the call order clear?", target: { _tag: "Lines", side: "after", startLine: 3, endLine: 4 }, replyToQuestionId: null,
      } })).structuredContent);
      if (prepared._tag !== "Ok") throw new Error("Preparation failed");
      const contextResult = await client.callTool({ name: "get_diffduck_question", arguments: prepared.value.ref });
      const context = toolContracts.get_diffduck_question.output.parse(contextResult.structuredContent);
      if (context._tag !== "Ok") throw new Error("Context failed");
      expect(context.value.question.target).toMatchObject({ selectedText: "const result = await Pipeline.from(input)\n  .through(parse)\n" });
      expect(contextResult.content).toContainEqual({ type: "text", text: JSON.stringify(context) });
      expect((await client.callTool({ name: "respond_in_diffduck", arguments: { ...prepared.value.ref, response: { _tag: "Answered", text: "Yes, the steps read in order.", alternative: null } } })).isError).not.toBe(true);
      const read = toolContracts.read_diffduck_session.output.parse((await client.callTool({ name: "read_diffduck_session", arguments: { sessionId: opened.value.sessionId, afterVersion: opened.value.version } })).structuredContent);
      if (read._tag !== "Ok" || read.value._tag !== "Changed") throw new Error("Expected update");
      expect(read.value.snapshot.scenarios[0]?.questions[0]?.state._tag).toBe("Completed");
      expect(read.value.snapshot.scenarios[1]?.questions).toHaveLength(0);
      const invalid = await client.callTool({ name: "show_diffduck_review", arguments: { ...exampleReview(), secretExtra: "do not echo" } });
      expect(invalid.isError).toBe(true);
      const resource = await client.readResource({ uri: "ui://diffduck/review.html" });
      expect(resource.contents[0]?.mimeType).toBe("text/html;profile=mcp-app");
    } finally { await client.close(); await server.close(); }
  });
});
