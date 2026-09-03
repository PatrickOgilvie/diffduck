import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { appToolResultEnvelopeSchema, toolContracts } from "../protocol/diffduck.js";
import { exampleReview, testUuid } from "../testing/fixtures.js";

describe("built DiffDuck server", () => {
  it("serves a self-contained UI and completes a discussion over packaged stdio", async () => {
    const transport = new StdioClientTransport({
      command: "node", args: ["dist/server/main.js"],
      cwd: process.env.DIFFDUCK_SERVER_CWD ?? process.cwd(), stderr: "pipe",
    });
    const client = new Client({ name: "diffduck-release-test", version: "0.2.0" });
    const diagnostics: string[] = [];
    transport.stderr?.on("data", (chunk: Buffer) => diagnostics.push(chunk.toString()));
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(8);
      const missing = CallToolResultSchema.parse(await client.callTool({ name: "get_diffduck_question", arguments: {
        sessionId: testUuid(901), questionId: testUuid(902), contextId: testUuid(903),
      } }));
      expect(missing.isError).toBe(true);
      expect(missing.structuredContent).toBeUndefined();
      const failureText = missing.content[0];
      if (failureText?.type !== "text") throw new Error("Missing typed failure text");
      expect(toolContracts.get_diffduck_question.output.parse(JSON.parse(failureText.text))).toMatchObject({ _tag: "Err", error: { _tag: "SessionUnavailable" } });
      const openedResult = await client.callTool({ name: "show_diffduck_review", arguments: exampleReview() });
      expect(openedResult.content).toEqual([{ type: "text", text: JSON.stringify(openedResult.structuredContent) }]);
      const opened = toolContracts.show_diffduck_review.output.parse(openedResult.structuredContent);
      if (opened._tag !== "Ok") throw new Error("Opening failed");
      const scenario = opened.value.scenarios[0];
      if (scenario === undefined) throw new Error("Missing scenario");
      const preparedResult = await client.callTool({ name: "prepare_diffduck_question", arguments: {
        sessionId: opened.value.sessionId, questionId: testUuid(101), scenarioId: scenario.scenarioId,
        exampleRevisionId: scenario.currentRevisionId, expectedTranscriptVersion: scenario.transcriptVersion,
        intent: "ask", text: "Private test question", target: { _tag: "Lines", side: "before", startLine: 3, endLine: 4 }, replyToQuestionId: null,
      } });
      expect(preparedResult.content).toEqual([{ type: "text", text: JSON.stringify(preparedResult.structuredContent) }]);
      const prepared = toolContracts.prepare_diffduck_question.output.parse(JSON.parse(appToolResultEnvelopeSchema.parse(preparedResult.structuredContent).json));
      if (prepared._tag !== "Ok") throw new Error("Question failed");
      const context = toolContracts.get_diffduck_question.output.parse((await client.callTool({ name: "get_diffduck_question", arguments: prepared.value.ref })).structuredContent);
      expect(context._tag).toBe("Ok");
      const response = { ...prepared.value.ref, response: { _tag: "Answered", text: "The old API hides the operation order in positional arguments.", alternative: null } };
      expect((await client.callTool({ name: "respond_in_diffduck", arguments: response })).isError).not.toBe(true);
      expect((await client.callTool({ name: "respond_in_diffduck", arguments: response })).isError).not.toBe(true);
      const readResult = await client.callTool({ name: "read_diffduck_session", arguments: { sessionId: opened.value.sessionId, afterVersion: 0 } });
      const read = toolContracts.read_diffduck_session.output.parse(JSON.parse(appToolResultEnvelopeSchema.parse(readResult.structuredContent).json));
      if (read._tag !== "Ok" || read.value._tag !== "Changed") throw new Error("Read failed");
      expect(read.value.snapshot.scenarios[0]?.questions[0]?.state._tag).toBe("Completed");
      expect(read.value.snapshot.scenarios[1]?.questions).toHaveLength(0);
      const resource = (await client.readResource({ uri: "ui://diffduck/review.html" })).contents[0];
      expect(resource?.mimeType).toBe("text/html;profile=mcp-app");
      if (resource === undefined || !("text" in resource)) throw new Error("Missing UI");
      expect(resource.text).toContain("pierre-dark");
      expect(resource.text).toContain("Talk it through");
      expect(resource.text).toContain("Use this example");
      expect(resource.text).toContain("Revision trail");
      expect(resource.text).not.toContain("revision-picker");
      expect(resource.text).toContain("DD_RESPONSE_V1");
      expect(resource.text).toContain("diffduck.app-result.v1");
      expect(resource.text).not.toContain("Request changes");
      expect(resource.text).not.toContain("Demo response:");
      expect(resource.text).not.toContain("Simulated reply:");
      expect(resource.text).not.toContain("DiffDuck workbench");
      expect(resource.text).not.toContain("/@vite/client");
      expect(resource.text).not.toMatch(/<script[^>]+src=["']https?:/);
      expect(resource.text).not.toMatch(/\/(?:Users|home)\/[^/]+\//);
    } finally { await client.close(); }
    const log = diagnostics.join("");
    expect(log).not.toContain("Private test question");
    expect(log).not.toContain("createPipeline");
    expect(log).not.toContain("sessionId");
  });
});
