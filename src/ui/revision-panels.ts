import type { SelectedLineRange } from "@pierre/diffs";
import { captureTarget, fail, ok, questionTargetSchema, type ExampleRevision, type ExampleRevisionId, type QuestionTarget, type Result, type ScenarioDiscussion } from "../domain/discussion.js";

/** A real source pane, never a synthesized revision with an existing identity. */
export type RevisionSource = { readonly revision: ExampleRevision; readonly side: "before" | "after"; readonly label: string };
/** One column in the chronological trail. Null predecessor means the original file, not a diff. */
export type RevisionPanel = { readonly id: string; readonly number: number; readonly source: RevisionSource; readonly previous: RevisionSource | null };
/** Exact saved source addressed by an interaction with a revision column. */
export type RevisionSelection = { readonly revisionId: ExampleRevisionId; readonly target: QuestionTarget };

/** Construct a linear trail from the service's guarded parent links; never guess a missing predecessor. */
export function buildRevisionPanels(scenario: Pick<ScenarioDiscussion, "revisions">): Result<readonly RevisionPanel[], { readonly _tag: "InvalidRevisionHistory"; readonly message: string }> {
  const first = scenario.revisions[0];
  if (first === undefined || first.parentRevisionId !== null) return fail("InvalidRevisionHistory", "The original example is missing from this revision history.");
  const baseline: RevisionSource = { revision: first, side: "before", label: "Before" };
  const panels: RevisionPanel[] = [{ id: `before-${first.id}`, number: 0, source: baseline, previous: null }];
  const seen = new Set<ExampleRevisionId>();
  let previous = baseline;
  for (const [index, revision] of scenario.revisions.entries()) {
    if (seen.has(revision.id) || index > 0 && revision.parentRevisionId !== previous.revision.id) return fail("InvalidRevisionHistory", "The revision history contains a repeated identity or a missing or out-of-order predecessor. Its comparison cannot be shown safely.");
    seen.add(revision.id);
    const source: RevisionSource = { revision, side: "after", label: `Revision ${index + 1}` };
    panels.push({ id: revision.id, number: index + 1, source, previous });
    previous = source;
  }
  return ok(panels);
}

/** Translate Diffs' old/new coordinates into actual saved revision coordinates, including deleted lines. */
export function resolveRevisionSelection(panel: RevisionPanel, range: SelectedLineRange | null): Result<RevisionSelection, { readonly _tag: "InvalidSelection"; readonly message: string }> {
  if (range === null) return ok({ revisionId: panel.source.revision.id, target: { _tag: "WholeExample" } });
  const side = range.side ?? "additions";
  if ((range.endSide ?? side) !== side) return fail("InvalidSelection", "Select lines from one version at a time. Removed lines belong to the preceding revision.");
  const source = side === "deletions" ? panel.previous : panel.source;
  if (source === null) return fail("InvalidSelection", "The original file has no previous revision.");
  const parsed = questionTargetSchema.safeParse({ _tag: "Lines", side: source.side, startLine: Math.min(range.start, range.end), endLine: Math.max(range.start, range.end) });
  if (!parsed.success) return fail("InvalidSelection", "Choose a valid line range in this revision.");
  const captured = captureTarget(parsed.data, { before: source.revision.scenario.before.code, after: source.revision.scenario.after.code });
  if (captured._tag === "Err") return captured;
  return ok({ revisionId: source.revision.id, target: parsed.data });
}

/** Locate a saved selection in this pair without treating a predecessor's after-pane as the original before-pane. */
export function selectionInRevisionPanel(panel: RevisionPanel, selection: RevisionSelection): SelectedLineRange | null {
  const target = selection.target;
  if (target._tag !== "Lines") return null;
  const matches = (source: RevisionSource) => source.revision.id === selection.revisionId && source.side === target.side;
  const side = matches(panel.source) ? "additions" : panel.previous !== null && matches(panel.previous) ? "deletions" : null;
  return side === null ? null : { side, start: target.startLine, end: target.endLine };
}
