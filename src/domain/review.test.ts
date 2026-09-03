import { describe, expect, it } from "bun:test";
import { parseDiffDuckReview, normalizeCode } from "./review.js";
import { exampleReview } from "../testing/fixtures.js";

describe("review boundary", () => {
  it("parses complete reviews with provenance and rejects duplicate identities", () => {
    const review = exampleReview().review;
    expect(parseDiffDuckReview(review)._tag).toBe("Parsed");
    expect(parseDiffDuckReview({ ...review, scenarios: [...review.scenarios, review.scenarios[0]] })._tag).toBe("Invalid");
    expect(parseDiffDuckReview({ ...review, verdict: "approve" })._tag).toBe("Invalid");
    expect(parseDiffDuckReview({ ...review, scenarios: [] })._tag).toBe("Invalid");
  });
  it("requires honest provenance and preserves code whitespace", () => {
    const review = exampleReview().review;
    const scenario = review.scenarios[0];
    if (scenario === undefined) throw new Error("Fixture missing");
    expect(parseDiffDuckReview({ ...review, scenarios: [{ ...scenario, provenance: undefined }] })._tag).toBe("Invalid");
    expect(normalizeCode("  x\r\n\t\r y  ")).toBe("  x\n\t\n y  ");
    expect(normalizeCode(normalizeCode(scenario.before.code))).toBe(normalizeCode(scenario.before.code));
  });
});
