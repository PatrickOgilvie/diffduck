import { z } from "zod";
import { codePaneSchema, reviewHeaderSchema, scenarioIdSchema, scenarioSchema } from "./review.js";

/** A local result, with expected failures represented as values. @template T,E */
export type Result<T, E> = { readonly _tag: "Ok"; readonly value: T } | { readonly _tag: "Err"; readonly error: E };
/** Construct a successful result. @template T */
export function ok<T>(value: T): Result<T, never> { return { _tag: "Ok", value }; }
/** Construct a classified expected failure. @template K */
export function fail<K extends string>(tag: K, message: string): Result<never, { readonly _tag: K; readonly message: string }> {
  return { _tag: "Err", error: { _tag: tag, message } };
}

/** Unguessable server-local session handle. */
export const sessionIdSchema = z.uuid().brand<"SessionId">();
/** Stable caller identity for an idempotent review opening. */
export const requestIdSchema = z.string().min(1).max(100).brand<"RequestId">();
/** Immutable displayed example revision identity. */
export const revisionIdSchema = z.uuid().brand<"ExampleRevisionId">();
/** A caller-allocated logical question identity. */
export const questionIdSchema = z.uuid().brand<"QuestionId">();
/** Identity of one immutable question context. */
export const contextIdSchema = z.uuid().brand<"ContextId">();
/** A monotonic session snapshot version. */
export const sessionVersionSchema = z.number().int().nonnegative().safe().brand<"SessionVersion">();
/** A monotonic scenario transcript version. */
export const transcriptVersionSchema = z.number().int().nonnegative().safe().brand<"TranscriptVersion">();
/** An unguessable session identity. */
export type SessionId = z.infer<typeof sessionIdSchema>;
/** A revision identity. */
export type ExampleRevisionId = z.infer<typeof revisionIdSchema>;
/** A logical question identity. */
export type QuestionId = z.infer<typeof questionIdSchema>;
/** A context identity. */
export type ContextId = z.infer<typeof contextIdSchema>;
/** A monotonic snapshot version. */
export type SessionVersion = z.infer<typeof sessionVersionSchema>;
/** A monotonic scenario transcript version. */
export type TranscriptVersion = z.infer<typeof transcriptVersionSchema>;

const lineTargetSchema = z.strictObject({
  _tag: z.literal("Lines"), side: z.enum(["before", "after"]),
  startLine: z.number().int().positive().safe(), endLine: z.number().int().positive().safe(),
}).refine((target) => target.startLine <= target.endLine, "Line range must be ordered");

/** Source-line selection or an explicit whole-example question. */
export const questionTargetSchema = z.union([
  z.strictObject({ _tag: z.literal("WholeExample") }).readonly(), lineTargetSchema.readonly(),
]);
/** A validated, one-sided, inclusive source range. */
export type QuestionTarget = z.infer<typeof questionTargetSchema>;
/** Server-captured selection text rather than browser-supplied code. */
export const capturedTargetSchema = z.union([
  z.strictObject({ _tag: z.literal("WholeExample") }).readonly(),
  lineTargetSchema.safeExtend({ selectedText: z.string() }).readonly(),
]);
/** The exact source scope stored on a question. */
export type CapturedTarget = z.infer<typeof capturedTargetSchema>;

/** Derive exact newline-preserving text from the displayed canonical source. */
export function captureTarget(target: QuestionTarget, code: Readonly<{ before: string; after: string }>):
  Result<CapturedTarget, { readonly _tag: "InvalidSelection"; readonly message: string }> {
  if (target._tag === "WholeExample") return ok(target);
  const lines = code[target.side].match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if (target.endLine > lines.length) return fail("InvalidSelection", "The selected lines are not in this example revision.");
  return ok({ ...target, selectedText: lines.slice(target.startLine - 1, target.endLine).join("") });
}

/** Immutable version of a complete example. */
export const exampleRevisionSchema = z.strictObject({
  id: revisionIdSchema, parentRevisionId: revisionIdSchema.nullable(), scenario: scenarioSchema,
}).readonly();
/** An immutable revision with full before/after code and provenance. */
export type ExampleRevision = z.infer<typeof exampleRevisionSchema>;
/** Explicit intent never grants permission to change repository files. */
export const questionIntentSchema = z.enum(["ask", "explore-alternative"]);
/** The two supported discussion intents. */
export type QuestionIntent = z.infer<typeof questionIntentSchema>;
const questionText = z.string().min(1).max(8_000).refine((text) => text.trim().length > 0, "Question cannot be blank");

/** A submitted question's exact text and immutable attachment. */
export const questionSnapshotSchema = z.strictObject({
  id: questionIdSchema, scenarioId: scenarioIdSchema, exampleRevisionId: revisionIdSchema,
  intent: questionIntentSchema, text: questionText, target: capturedTargetSchema,
  replyToQuestionId: questionIdSchema.nullable(),
}).readonly();
/** One immutable user question. */
export type QuestionSnapshot = z.infer<typeof questionSnapshotSchema>;
/** An after-only proposal based on the question's revision. */
export const alternativeSchema = z.strictObject({
  basedOnRevisionId: revisionIdSchema, after: codePaneSchema,
  observations: z.array(z.string().trim().min(1).max(500)).max(8).readonly(),
}).readonly();
/** A completed model answer or honest inability to answer. */
export const responseSchema = z.discriminatedUnion("_tag", [
  z.strictObject({
    _tag: z.literal("Answered"), text: z.string().min(1).max(24_000), alternative: alternativeSchema.nullable(),
  }).readonly(),
  z.strictObject({ _tag: z.literal("CannotAnswer"), reason: z.string().min(1).max(2_000) }).readonly(),
]);
/** A model response routed to one question. */
export type DuckResponse = z.infer<typeof responseSchema>;
/** Terminal states cannot be overwritten by a later delivery receipt. */
export const terminalStateSchema = z.discriminatedUnion("_tag", [
  z.strictObject({ _tag: z.literal("Completed"), response: responseSchema }).readonly(),
  z.strictObject({ _tag: z.literal("DeliveryRejected") }).readonly(),
  z.strictObject({ _tag: z.literal("Cancelled") }).readonly(),
]);
/** Delivery acknowledgement is distinct from an answer. */
export const questionStateSchema = z.union([
  z.strictObject({ _tag: z.literal("Pending"), delivery: z.enum(["unconfirmed", "accepted"]) }).readonly(),
  terminalStateSchema,
]);
/** State of one logical question. */
export type QuestionState = z.infer<typeof questionStateSchema>;
/** Nonrecursive transcript entry captured in subsequent question context. */
export const historicalTurnSchema = z.strictObject({ question: questionSnapshotSchema, outcome: terminalStateSchema }).readonly();

/** Exact, immutable, scenario-scoped context sent to Codex on request. */
export const questionContextSchema = z.strictObject({
  id: contextIdSchema, sessionId: sessionIdSchema, review: reviewHeaderSchema.readonly(),
  question: questionSnapshotSchema, example: exampleRevisionSchema,
  historyThroughVersion: transcriptVersionSchema,
  history: z.array(historicalTurnSchema).readonly(), historicalExamples: z.array(exampleRevisionSchema).readonly(),
}).readonly();
/** A question plus all examples and preceding turns needed to interpret it. */
export type QuestionContext = z.infer<typeof questionContextSchema>;
/** UI-visible question record; adoption never mutates the original answer. */
export const questionRecordSchema = z.strictObject({
  context: questionContextSchema, state: questionStateSchema,
  createdAt: z.iso.datetime(), adoptedRevisionId: revisionIdSchema.nullable(),
}).readonly();
/** One retained question and its current delivery/completion status. */
export type QuestionRecord = z.infer<typeof questionRecordSchema>;
/** A tab's authoritative discussion, including retained historical revisions. */
export const scenarioDiscussionSchema = z.strictObject({
  scenarioId: scenarioIdSchema, currentRevisionId: revisionIdSchema,
  transcriptVersion: transcriptVersionSchema,
  revisions: z.array(exampleRevisionSchema).min(1).readonly(), questions: z.array(questionRecordSchema).readonly(),
}).readonly();
/** Authoritative state for one scenario, without browser view state. */
export type ScenarioDiscussion = z.infer<typeof scenarioDiscussionSchema>;
/** Complete immutable view of an active session. */
export const sessionSnapshotSchema = z.strictObject({
  sessionId: sessionIdSchema, version: sessionVersionSchema,
  review: reviewHeaderSchema.readonly(), scenarios: z.array(scenarioDiscussionSchema).min(1).max(8).readonly(),
}).readonly();
/** Read-only session state crossing the server/UI boundary. */
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;
