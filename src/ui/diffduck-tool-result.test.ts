import { describe, expect, it } from "bun:test";
import { encodeAppToolResult, toolContracts } from "../protocol/diffduck.js";
import { parseDiffDuckToolResult } from "./diffduck-tool-result.js";
import { ReviewSessions, defaultSessionLimits } from "../service/review-sessions.js";
import { exampleReview, testUuid } from "../testing/fixtures.js";

const contract = toolContracts.read_diffduck_session.output;
const payload = contract.parse({ _tag: "Ok", value: { _tag: "Unchanged", version: 2 } });
const envelope = encodeAppToolResult(payload);
const text = { type: "text", text: JSON.stringify(envelope) };
const decode = (response: unknown) => parseDiffDuckToolResult("read_diffduck_session", response, contract);

describe("DiffDuck result decoding", () => {
  it("accepts structured data and its exact JSON text representation", () => {
    expect(decode({ content: [text], structuredContent: envelope })).toEqual(payload);
    expect(decode({ content: [text] })).toEqual(payload);
  });
  it("preserves typed server failures through text-only responses", () => {
    const failure = contract.parse({ _tag: "Err", error: { _tag: "SessionUnavailable", message: "The session ended." } });
    expect(decode({ content: [{ type: "text", text: JSON.stringify(encodeAppToolResult(failure)) }], isError: true })).toEqual(failure);
  });
  it("does not use text to disguise malformed structured data", () => {
    const result = decode({ content: [text], structuredContent: { ...envelope, json: JSON.stringify({ _tag: "Ok", value: { _tag: "Unchanged", version: "private-value" } }) } });
    expect(result).toMatchObject({ _tag: "Err", error: { _tag: "InvalidHostResponse" } });
    if (result._tag !== "Err") throw new Error("Expected malformed response");
    expect(result.error.message).toContain("structured/contract-mismatch");
    expect(result.error.message).toContain("value.version:invalid_type");
    expect(result.error.message).not.toContain("private-value");
  });
  it("rejects ambiguous text, truncated JSON and inconsistent success flags", () => {
    for (const result of [decode({ content: [text, text] }), decode({ content: [{ type: "text", text: text.text.slice(0, -1) }] }), decode({ content: [text], isError: true })]) {
      expect(result).toMatchObject({ _tag: "Err", error: { _tag: "InvalidHostResponse" } });
    }
  });
  it("does not echo host rejection text or unknown property names", () => {
    const rejected = decode({ content: [{ type: "text", text: "private-host-rejection" }], isError: true });
    const unknown = decode({ content: [], structuredContent: { ...envelope, "private-property-name": "private-property-value" } });
    expect(rejected).toMatchObject({ _tag: "Err", error: { _tag: "InvalidInput" } });
    expect(unknown).toMatchObject({ _tag: "Err", error: { _tag: "InvalidHostResponse" } });
    expect(JSON.stringify([rejected, unknown])).not.toContain("private-");
  });
  it("identifies missing payloads and malformed envelopes without exposing values", () => {
    const missing = decode({ content: [] });
    const malformed = decode({ content: [{ type: "text", text: { "private-field": "private-value" } }] });
    if (missing._tag !== "Err" || malformed._tag !== "Err") throw new Error("Expected decoding failures");
    expect(missing.error.message).toContain("read_diffduck_session text/missing-or-ambiguous-payload");
    expect(malformed.error.message).toContain("read_diffduck_session envelope/invalid-shape");
    expect(JSON.stringify(malformed)).not.toContain("private-");
  });
  it("uses the opening contract for text-only initial results", () => {
    const failure = toolContracts.show_diffduck_review.output.parse({ _tag: "Err", error: { _tag: "SessionCapacityExceeded", message: "Open-session capacity reached." } });
    expect(parseDiffDuckToolResult("show_diffduck_review", { content: [{ type: "text", text: JSON.stringify(failure) }], isError: true }, toolContracts.show_diffduck_review.output)).toEqual(failure);
  });
  it("rejects invalid app envelopes and invalid nested JSON without trusting the text duplicate", () => {
    for (const structuredContent of [
      payload,
      { ...envelope, format: "unknown-format" },
      { ...envelope, json: null },
      { ...envelope, json: envelope.json.slice(0, -1) },
      { ...envelope, json: JSON.stringify({ _tag: "Ok", value: { _tag: "Unchanged" } }) },
    ]) {
      expect(decode({ content: [text], structuredContent })).toMatchObject({ _tag: "Err", error: { _tag: "InvalidHostResponse" } });
    }
  });
  it("preserves explicit nulls but never guesses a missing parent revision inside the encoded snapshot", () => {
    let id = 1;
    const sessions = new ReviewSessions({ newUuid: () => testUuid(id++), now: () => "2026-09-03T12:00:00.000Z", emit: () => {} }, defaultSessionLimits);
    const opened = sessions.open(exampleReview());
    if (opened._tag !== "Ok") throw new Error("Opening fixture failed");
    const expected = contract.parse({ _tag: "Ok", value: { _tag: "Changed", snapshot: opened.value } });
    const intact = encodeAppToolResult(expected);
    const content = [{ type: "text", text: JSON.stringify(intact) }];
    expect(decode({ content, structuredContent: intact })).toEqual(expected);
    const damaged = { ...intact, json: JSON.stringify(expected, (_key, value: unknown) => value === null ? undefined : value) };
    const result = decode({ content, structuredContent: damaged });
    expect(result).toMatchObject({ _tag: "Err", error: { _tag: "InvalidHostResponse" } });
    if (result._tag !== "Err") throw new Error("Expected malformed snapshot");
    expect(result.error.message).toContain("parentRevisionId:invalid_type");
    expect(result.error.message).not.toContain("createPipeline");
  });
});
