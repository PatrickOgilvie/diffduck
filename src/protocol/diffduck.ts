import { z } from "zod";
import {
  adoptAlternativeSchema, openReviewSchema, prepareQuestionSchema, questionRefSchema,
  readSessionSchema, recordDeliverySchema, respondSchema,
} from "../domain/commands.js";
import { questionContextSchema, sessionSnapshotSchema, sessionVersionSchema, type Result } from "../domain/discussion.js";

/** Stable protocol failures; messages never include arbitrary input or exception dumps. */
export const duckErrorSchema = z.strictObject({
  _tag: z.enum([
    "InvalidInput", "SessionUnavailable", "UnknownReference", "ContextMismatch", "SessionCapacityExceeded",
    "IdempotencyConflict", "QuestionInFlight", "TranscriptChanged", "InvalidSelection", "ContextTooLarge",
    "QuestionClosed", "InvalidResponse", "RevisionConflict", "AlternativeUnavailable",
  ]),
  message: z.string(),
}).readonly();
/** Protocol-level expected failure union, kept at the adapter boundary. */
export type DuckError = z.infer<typeof duckErrorSchema>;

/** A parsed preparation response from the authoritative server. */
export const preparedQuestionSchema = z.strictObject({
  disposition: z.enum(["created", "replayed"]), ref: questionRefSchema.readonly(),
  triggerMessage: z.string(), snapshot: sessionSnapshotSchema,
}).readonly();

/** Conditional reads return no code when the view is already current. */
export const sessionReadSchema = z.discriminatedUnion("_tag", [
  z.strictObject({ _tag: z.literal("Unchanged"), version: sessionVersionSchema }).readonly(),
  z.strictObject({ _tag: z.literal("Changed"), snapshot: sessionSnapshotSchema }).readonly(),
]);

/** Define a strict result envelope for one owned protocol boundary. @template T */
export function resultSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("Ok"), value }).readonly(),
    z.strictObject({ _tag: z.literal("Err"), error: duckErrorSchema }).readonly(),
  ]);
}

/** The complete tool contract, shared by registration and the UI adapter. */
export const toolContracts = {
  show_diffduck_review: { input: openReviewSchema, output: resultSchema(sessionSnapshotSchema) },
  prepare_diffduck_question: { input: prepareQuestionSchema, output: resultSchema(preparedQuestionSchema) },
  record_diffduck_delivery: { input: recordDeliverySchema, output: resultSchema(sessionSnapshotSchema) },
  get_diffduck_question: { input: questionRefSchema, output: resultSchema(questionContextSchema) },
  respond_in_diffduck: { input: respondSchema, output: resultSchema(z.strictObject({ ref: questionRefSchema }).readonly()) },
  read_diffduck_session: { input: readSessionSchema, output: resultSchema(sessionReadSchema) },
  cancel_diffduck_question: { input: questionRefSchema, output: resultSchema(sessionSnapshotSchema) },
  adopt_diffduck_alternative: { input: adoptAlternativeSchema, output: resultSchema(sessionSnapshotSchema) },
} as const;
/** Names of the supported tools; not arbitrary server calls. */
export type ToolName = keyof typeof toolContracts;
/** Tools the interactive app may invoke. */
export type AppToolName = Exclude<ToolName, "show_diffduck_review" | "get_diffduck_question" | "respond_in_diffduck">;
/** Parsed input for a specific tool. @template K */
export type ToolInput<K extends ToolName> = z.output<(typeof toolContracts)[K]["input"]>;
/** Parsed result for a specific tool. @template K */
export type ToolOutput<K extends ToolName> = z.output<(typeof toolContracts)[K]["output"]>;

/** Project only a typed result, never internal maps, runtime objects or causes. @template T */
export function projectToolResult<T>(result: Result<T, DuckError>):
  { readonly _tag: "Ok"; readonly value: T } | { readonly _tag: "Err"; readonly error: DuckError } {
  if (result._tag === "Err") return { _tag: "Err", error: { _tag: result.error._tag, message: result.error.message } };
  return { _tag: "Ok", value: result.value };
}
