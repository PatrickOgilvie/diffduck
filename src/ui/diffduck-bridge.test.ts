import { describe, expect, it } from "bun:test";
import type { App } from "@modelcontextprotocol/ext-apps";
import { DiffDuckBridge } from "./diffduck-bridge.js";
import { readSessionSchema } from "../domain/commands.js";
import { testUuid } from "../testing/fixtures.js";
import { sessionVersionSchema } from "../domain/discussion.js";
import { encodeAppToolResult } from "../protocol/diffduck.js";

const unchanged = { _tag: "Unchanged" as const, version: sessionVersionSchema.parse(0) };

function host() {
  let calls = 0;
  const app: Pick<App, "callServerTool" | "sendMessage"> = {
    callServerTool: async () => { calls++; return { content: [], structuredContent: encodeAppToolResult({ _tag: "Ok", value: unchanged }) }; },
    sendMessage: async () => ({}),
  };
  return { app, calls: () => calls, bridge: new DiffDuckBridge(app) };
}
const read = readSessionSchema.parse({ sessionId: testUuid(1), afterVersion: 0 });

describe("MCP Apps adapter", () => {
  it("parses tool output and distinguishes host receipt from an answer", async () => {
    const { bridge } = host();
    expect(await bridge.read(read, {})).toEqual({ _tag: "Ok", value: unchanged });
    expect(await bridge.send("trigger", {})).toEqual({ _tag: "Accepted" });
  });
  it("keeps rejected, malformed and uncertain deliveries distinct", async () => {
    const { app, bridge } = host();
    app.sendMessage = async () => ({ isError: true });
    expect((await bridge.send("trigger", {}))._tag).toBe("Rejected");
    app.sendMessage = async () => { throw new Error("sensitive host error"); };
    const failure = await bridge.send("trigger", {});
    expect(failure._tag).toBe("Unconfirmed");
    expect(JSON.stringify(failure)).not.toContain("sensitive");
  });
  it("rejects malformed or inconsistent tool data without trusting the host", async () => {
    const { app, bridge } = host();
    app.callServerTool = async () => ({ content: [], structuredContent: encodeAppToolResult({ _tag: "Ok", value: { ...unchanged, extra: true } }) });
    expect(await bridge.read(read, {})).toMatchObject({ _tag: "Err", error: { _tag: "InvalidHostResponse" } });
    app.callServerTool = async () => ({ content: [], isError: true, structuredContent: encodeAppToolResult({ _tag: "Ok", value: unchanged }) });
    expect(await bridge.read(read, {})).toMatchObject({ _tag: "Err", error: { _tag: "InvalidHostResponse" } });
    app.callServerTool = async () => { throw new Error("private exception"); };
    expect(await bridge.read(read, {})).toMatchObject({ _tag: "Err", error: { _tag: "HostUnavailable" } });
  });
  it("does not begin cancelled calls", async () => {
    const { bridge, calls } = host();
    const controller = new AbortController(); controller.abort();
    expect(await bridge.read(read, { signal: controller.signal })).toMatchObject({ _tag: "Err", error: { _tag: "Cancelled" } });
    expect(calls()).toBe(0);
  });
});
