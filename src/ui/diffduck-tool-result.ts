import { z } from "zod";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { fail, type Result } from "../domain/discussion.js";
import { appToolResultEnvelopeSchema, isAppTool, type DuckError, type ToolName } from "../protocol/diffduck.js";

/** A malformed host response, with a bounded diagnostic that contains no payload values. */
export type ToolResponseFailure = { readonly _tag: "InvalidHostResponse"; readonly message: string };

// Only application-owned field names may appear in a diagnostic. Unknown keys,
// schema messages, received values, example code and question text are never included.
const diagnosticFields = new Set([
  "content", "structuredContent", "isError", "type", "_tag", "value", "error", "message", "format", "json",
  "disposition", "ref", "triggerMessage", "snapshot", "sessionId", "questionId", "contextId",
  "version", "review", "scenarios", "scenarioId", "currentRevisionId", "transcriptVersion",
  "revisions", "questions", "context", "state", "createdAt", "adoptedRevisionId", "id",
  "parentRevisionId", "scenario", "example", "history", "historicalExamples", "historyThroughVersion",
  "question", "exampleRevisionId", "intent", "text", "target", "replyToQuestionId", "side",
  "startLine", "endLine", "selectedText", "delivery", "response", "outcome", "alternative",
  "basedOnRevisionId", "before", "after", "label", "code", "observations", "reason",
  "title", "mode", "repository", "summary", "base", "head", "description", "filename",
  "language", "provenance", "referenceLabel", "paths", "revision", "oid", "headOid", "observedAt",
]);

function issueSummary(issues: readonly z.core.$ZodIssue[]): string {
  return issues.slice(0, 3).map((issue) => {
    const path = issue.path.slice(0, 10).map((part) => typeof part === "number" ? "[item]"
      : typeof part === "string" && diagnosticFields.has(part) ? part : "[field]").join(".");
    return `${path || "result"}:${issue.code}`;
  }).join(", ");
}

function invalidResponse(name: ToolName, source: "envelope" | "structured" | "text", reason: string, issues: readonly z.core.$ZodIssue[] = []): Result<never, ToolResponseFailure> {
  const details = issueSummary(issues);
  return fail("InvalidHostResponse", `DiffDuck could not read the reply. Your draft and existing discussion have been kept. Details: DD_RESPONSE_V1 ${name} ${source}/${reason}${details ? ` (${details})` : ""}.`);
}

/**
 * Decode the standard MCP representations into the same strict DiffDuck contract.
 * Structured data is authoritative when present; text is used only when it is absent.
 * App-only tools carry a versioned JSON envelope to preserve nested values at host hops.
 * No heuristic unwrapping, schema weakening, payload logging or automatic retry.
 * @template T
 */
export function parseDiffDuckToolResult<T>(name: ToolName, response: unknown, schema: z.ZodType<Result<T, DuckError>>): Result<T, DuckError | ToolResponseFailure> {
  const envelope = CallToolResultSchema.safeParse(response);
  if (!envelope.success) return invalidResponse(name, "envelope", "invalid-shape", envelope.error.issues);
  const result = envelope.data;
  const source = result.structuredContent === undefined ? "text" : "structured";
  let payload: unknown = result.structuredContent;
  if (source === "text") {
    const [block] = result.content;
    if (result.content.length !== 1 || block?.type !== "text") return invalidResponse(name, source, "missing-or-ambiguous-payload");
    try { payload = JSON.parse(block.text); }
    catch {
      // A plain-text host rejection is not a valid DiffDuck result. Never echo it.
      if (result.isError === true) return fail("InvalidInput", `The host rejected this DiffDuck command. Your draft has been kept. Details: DD_RESPONSE_V1 ${name} text/host-rejected.`);
      return invalidResponse(name, source, "invalid-json");
    }
  }
  if (isAppTool(name)) {
    const encoded = appToolResultEnvelopeSchema.safeParse(payload);
    if (!encoded.success) return invalidResponse(name, source, "app-envelope-mismatch", encoded.error.issues);
    try { payload = JSON.parse(encoded.data.json); }
    catch { return invalidResponse(name, source, "invalid-payload-json"); }
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return invalidResponse(name, source, "contract-mismatch", parsed.error.issues);
  if (result.isError === true && parsed.data._tag === "Ok") return invalidResponse(name, source, "inconsistent-success");
  return parsed.data;
}
