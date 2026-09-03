import { z } from "zod";

const shortText = z.string().trim().min(1).max(240);
const gitOid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const repositoryPath = z.string().min(1).max(500).refine(
  (path) => !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes(".."),
  "Use a repository-relative path without parent traversal",
);

/** Stable, descriptive identity for one scenario within a review. */
export const scenarioIdSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).brand<"ScenarioId">();
/** Identity of a scenario, not an example revision. */
export type ScenarioId = z.infer<typeof scenarioIdSchema>;

/** A read-only example pane. Code is never trimmed. */
export const codePaneSchema = z.strictObject({
  label: z.string().trim().min(1).max(80), code: z.string().min(1).max(120_000),
}).readonly();
/** An example's label and exact displayed code. */
export type CodePane = z.infer<typeof codePaneSchema>;

/** Model-reported source evidence; inspection does not imply compilation. */
export const provenanceSchema = z.discriminatedUnion("_tag", [
  z.strictObject({ _tag: z.literal("Proposed") }).readonly(),
  z.strictObject({
    _tag: z.literal("Unverified"), referenceLabel: shortText, reason: z.string().trim().min(1).max(1_200),
  }).readonly(),
  z.strictObject({
    _tag: z.literal("SourceInspected"),
    revision: z.discriminatedUnion("_tag", [
      z.strictObject({ _tag: z.literal("Commit"), oid: gitOid }).readonly(),
      z.strictObject({ _tag: z.literal("WorkingTree"), headOid: gitOid.nullable(), observedAt: z.iso.datetime() }).readonly(),
    ]),
    paths: z.array(repositoryPath).min(1).max(24).readonly(),
  }).readonly(),
]);

/** One consumer-facing comparison, with explicit evidence for both sides. */
export const scenarioSchema = z.strictObject({
  id: scenarioIdSchema, title: shortText,
  description: z.string().trim().min(1).max(1_200),
  language: z.enum(["typescript", "tsx", "javascript", "jsx", "json", "text"]),
  filename: z.string().trim().min(1).max(240), before: codePaneSchema, after: codePaneSchema,
  observations: z.array(z.string().trim().min(1).max(500)).max(8).readonly(),
  question: z.string().trim().min(1).max(500).optional(),
  provenance: z.strictObject({ before: provenanceSchema, after: provenanceSchema }).readonly(),
}).readonly();

/** Frozen review-level context shared by all scenario discussions. */
export const reviewHeaderSchema = z.strictObject({
  title: shortText, mode: z.enum(["review", "discussion"]),
  summary: z.string().trim().min(1).max(1_200), repository: z.string().trim().min(1).max(500),
  base: z.string().trim().min(1).max(160).optional(), head: z.string().trim().min(1).max(160).optional(),
});

/** Strict review input; duplicate scenario identities are not meaningful. */
export const diffduckReviewSchema = reviewHeaderSchema.extend({
  scenarios: z.array(scenarioSchema).min(1).max(8).readonly(),
}).refine((review) => new Set(review.scenarios.map((scenario) => scenario.id)).size === review.scenarios.length, {
  message: "Scenario IDs must be unique", path: ["scenarios"],
});

/** A validated complete review. */
export type DiffDuckReview = z.infer<typeof diffduckReviewSchema>;
/** One validated userland comparison. */
export type DiffDuckScenario = z.infer<typeof scenarioSchema>;
/** Review metadata without its scenario collection. */
export type ReviewHeader = Readonly<z.infer<typeof reviewHeaderSchema>>;

/** Normalize newline representation before the code is ever displayed. */
export function normalizeCode(code: string): string { return code.replace(/\r\n?/g, "\n"); }

/** Parse unknown review data without exposing raw input in diagnostics. */
export function parseDiffDuckReview(input: unknown):
  | { readonly _tag: "Parsed"; readonly value: DiffDuckReview }
  | { readonly _tag: "Invalid"; readonly message: string } {
  const result = diffduckReviewSchema.safeParse(input);
  if (result.success) return { _tag: "Parsed", value: result.data };
  return { _tag: "Invalid", message: result.error.issues.slice(0, 4).map((issue) =>
    `${issue.path.join(".") || "review"}: ${issue.code}`,
  ).join("; ") };
}
