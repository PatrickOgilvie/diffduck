import { openReviewSchema } from "../domain/commands.js";

/** Deterministic UUIDs for real-seam tests; no random test ordering. */
export function testUuid(value: number): string { return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`; }

/** A compact two-scenario comparison with explicitly hypothetical evidence. */
export function exampleReview() {
  return openReviewSchema.parse({
    requestId: "pipeline-design",
    review: {
      title: "A smaller surface. A clearer intention.", mode: "discussion",
      summary: "Explore what a composable pipeline feels like at the call site.",
      repository: "popcomputer/pipeline", base: "Current API", head: "Proposal",
      scenarios: [
        {
          id: "compose-a-pipeline", title: "Compose a pipeline", language: "typescript", filename: "examples/pipeline.ts",
          description: "Make the order of operations visible without burying behavior in options.",
          before: { label: "Current API", code: 'import { createPipeline } from "@popcomputer/pipeline";\r\n\r\nconst pipeline = createPipeline(input, [parse, validate], { trace: true });\r\nconst result = await pipeline.run();\r\n' },
          after: { label: "Proposed API", code: 'import { Pipeline } from "@popcomputer/pipeline";\n\nconst result = await Pipeline.from(input)\n  .through(parse)\n  .through(validate)\n  .withTracing()\n  .run();\n' },
          observations: ["The order of operations is visible at the call site."],
          provenance: { before: { _tag: "Unverified", referenceLabel: "Illustrative baseline", reason: "A demonstration, not an inspected package." }, after: { _tag: "Proposed" } },
        },
        {
          id: "handle-a-failure", title: "Handle a failure", language: "typescript", filename: "examples/failure.ts",
          description: "Put expected failure in the return type.",
          before: { label: "Current API", code: "try {\n  render(await client.fetchUser(id));\n} catch (error) {\n  renderMissing(id);\n}\n" },
          after: { label: "Proposed API", code: "const user = await client.fetchUser(id);\n\nmatch(user, {\n  Found: ({ value }) => render(value),\n  NotFound: () => renderMissing(id),\n});\n" },
          observations: ["Expected errors become an explicit choice for the caller."],
          provenance: { before: { _tag: "Unverified", referenceLabel: "Illustrative baseline", reason: "A demonstration, not an inspected package." }, after: { _tag: "Proposed" } },
        },
      ],
    },
  });
}
