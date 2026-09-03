import { describe, expect, it } from "bun:test";
import { captureTarget, questionTargetSchema } from "./discussion.js";

describe("exact question targets", () => {
  it("captures source lines including their original line endings", () => {
    const target = questionTargetSchema.parse({ _tag: "Lines", side: "before", startLine: 2, endLine: 3 });
    if (target._tag !== "Lines") throw new Error("Expected line fixture");
    expect(captureTarget(target, { before: "one\ntwo\n🦆 three\n", after: "different" })).toEqual({
      _tag: "Ok", value: { ...target, selectedText: "two\n🦆 three\n" },
    });
  });

  it("never treats a final newline as an additional source line", () => {
    const target = questionTargetSchema.parse({ _tag: "Lines", side: "after", startLine: 2, endLine: 2 });
    expect(captureTarget(target, { before: "unused", after: "one\n" })._tag).toBe("Err");
  });

  it("rejects reversed, fractional and cross-side ranges", () => {
    for (const input of [
      { _tag: "Lines", side: "before", startLine: 3, endLine: 1 },
      { _tag: "Lines", side: "before", startLine: 1.5, endLine: 2 },
      { _tag: "Lines", side: "before", endSide: "after", startLine: 1, endLine: 2 },
    ]) expect(questionTargetSchema.safeParse(input).success).toBe(false);
  });

  it("captures an explicit whole-example target without inferring a selection", () => {
    expect(captureTarget({ _tag: "WholeExample" }, { before: "a", after: "b" })).toEqual({
      _tag: "Ok", value: { _tag: "WholeExample" },
    });
  });
});
