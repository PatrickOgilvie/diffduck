import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { toolContracts } from "../protocol/diffduck.js";
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
      const opened = toolContracts.show_diffduck_review.output.parse((await client.callTool({ name: "show_diffduck_review", arguments: exampleReview() })).structuredContent);
      if (opened._tag !== "Ok") throw new Error("Opening failed");
      const scenario = opened.value.scenarios[0];
      if (scenario === undefined) throw new Error("Missing scenario");
      const prepared = toolContracts.prepare_diffduck_question.output.parse((await client.callTool({ name: "prepare_diffduck_question", arguments: {
        sessionId: opened.value.sessionId, questionId: testUuid(101), scenarioId: scenario.scenarioId,
        exampleRevisionId: scenario.currentRevisionId, expectedTranscriptVersion: scenario.transcriptVersion,
        intent: "ask", text: "Private test question", target: { _tag: "Lines", side: "before", startLine: 3, endLine: 4 }, replyToQuestionId: null,
      } })).structuredContent);
      if (prepared._tag !== "Ok") throw new Error("Question failed");
      const context = toolContracts.get_diffduck_question.output.parse((await client.callTool({ name: "get_diffduck_question", arguments: prepared.value.ref })).structuredContent);
      expect(context._tag).toBe("Ok");
      const response = { ...prepared.value.ref, response: { _tag: "Answered", text: "The old API hides the operation order in positional arguments.", alternative: null } };
      expect((await client.callTool({ name: "respond_in_diffduck", arguments: response })).isError).not.toBe(true);
      expect((await client.callTool({ name: "respond_in_diffduck", arguments: response })).isError).not.toBe(true);
      const read = toolContracts.read_diffduck_session.output.parse((await client.callTool({ name: "read_diffduck_session", arguments: { sessionId: opened.value.sessionId, afterVersion: 0 } })).structuredContent);
      if (read._tag !== "Ok" || read.value._tag !== "Changed") throw new Error("Read failed");
      expect(read.value.snapshot.scenarios[0]?.questions[0]?.state._tag).toBe("Completed");
      expect(read.value.snapshot.scenarios[1]?.questions).toHaveLength(0);
      const resource = (await client.readResource({ uri: "ui://diffduck/review.html" })).contents[0];
      expect(resource?.mimeType).toBe("text/html;profile=mcp-app");
      if (resource === undefined || !("text" in resource)) throw new Error("Missing UI");
      expect(resource.text).toContain("pierre-dark");
      expect(resource.text).toContain("Talk it through");
      expect(resource.text).toContain("Use this example");
      expect(resource.text).not.toContain("Request changes");
      expect(resource.text).not.toContain("Demo response:");
      expect(resource.text).not.toMatch(/<script[^>]+src=["']https?:/);
      expect(resource.text).not.toMatch(/\/(?:Users|home)\/[^/]+\//);
    } finally { await client.close(); }
    const log = diagnostics.join("");
    expect(log).not.toContain("Private test question");
    expect(log).not.toContain("createPipeline");
    expect(log).not.toContain("sessionId");
  });
});
