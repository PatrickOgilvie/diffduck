import { z } from "zod";
import {
  contextIdSchema, questionIdSchema, questionIntentSchema, questionTargetSchema, requestIdSchema,
  responseSchema, revisionIdSchema, sessionIdSchema, sessionVersionSchema, transcriptVersionSchema,
} from "./discussion.js";
import { diffduckReviewSchema, scenarioIdSchema } from "./review.js";

/** Open a review exactly once for the same caller request identity. */
export const openReviewSchema = z.strictObject({ requestId: requestIdSchema, review: diffduckReviewSchema });
/** Parsed request for a new review session. */
export type OpenReview = z.infer<typeof openReviewSchema>;
/** Freeze the exact displayed revision and preceding visible discussion. */
export const prepareQuestionSchema = z.strictObject({
  sessionId: sessionIdSchema, questionId: questionIdSchema, scenarioId: scenarioIdSchema,
  exampleRevisionId: revisionIdSchema, expectedTranscriptVersion: transcriptVersionSchema,
  intent: questionIntentSchema,
  text: z.string().min(1).max(8_000).refine((text) => text.trim().length > 0, "Question cannot be blank"),
  target: questionTargetSchema, replyToQuestionId: questionIdSchema.nullable(),
});
/** A parsed question command; selected text is intentionally absent. */
export type PrepareQuestion = z.infer<typeof prepareQuestionSchema>;
/** Complete routing identity; no current-tab assumptions cross this seam. */
export const questionRefSchema = z.strictObject({ sessionId: sessionIdSchema, questionId: questionIdSchema, contextId: contextIdSchema });
/** Complete identity for one frozen question context. */
export type QuestionRef = z.infer<typeof questionRefSchema>;
/** Report the host receipt without claiming model completion. */
export const recordDeliverySchema = questionRefSchema.extend({ delivery: z.enum(["accepted", "rejected", "unconfirmed"]) });
/** Parsed delivery observation. */
export type RecordDelivery = z.infer<typeof recordDeliverySchema>;
/** Complete one question, without attaching a new UI resource. */
export const respondSchema = questionRefSchema.extend({ response: responseSchema });
/** Parsed response supplied by Codex. */
export type RespondToQuestion = z.infer<typeof respondSchema>;
/** Read only when the authoritative session version has changed. */
export const readSessionSchema = z.strictObject({ sessionId: sessionIdSchema, afterVersion: sessionVersionSchema.nullable() });
/** Parsed conditional snapshot read. */
export type ReadSession = z.infer<typeof readSessionSchema>;
/** Adopt a proposed after-example only against the expected current revision. */
export const adoptAlternativeSchema = z.strictObject({
  sessionId: sessionIdSchema, questionId: questionIdSchema, expectedCurrentRevisionId: revisionIdSchema,
});
/** Parsed example-only adoption command. */
export type AdoptAlternative = z.infer<typeof adoptAlternativeSchema>;
