import { memo, useCallback, useMemo } from "react";
import { MultiFileDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation, FileContents, FileDiffOptions, SelectedLineRange } from "@pierre/diffs";
import type { ExampleRevision, QuestionId, QuestionRecord, QuestionTarget } from "../domain/discussion.js";
import { captureTarget, questionTargetSchema } from "../domain/discussion.js";

type Annotation = { readonly _tag: "Selection" } | { readonly _tag: "Question"; readonly id: QuestionId; readonly text: string };
type Props = {
  readonly revision: ExampleRevision;
  readonly questions: readonly QuestionRecord[];
  readonly selection: QuestionTarget;
  readonly themeType: "light" | "dark";
  readonly disabled: boolean;
  readonly onSelect: (selection: QuestionTarget) => void;
  readonly onAsk: () => void;
  readonly onExplore: () => void;
  readonly onQuestion: (id: QuestionId) => void;
  readonly onInvalidSelection: () => void;
};

/** Render a read-only before/after surface with one-sided selection and historical discussion markers. */
export const CodeComparison = memo(function CodeComparison({ revision, questions, selection, themeType, disabled, onSelect, onAsk, onExplore, onQuestion, onInvalidSelection }: Props) {
  const scenario = revision.scenario;
  const oldFile = useMemo<FileContents>(() => ({ name: scenario.filename, lang: scenario.language, contents: scenario.before.code }), [scenario.filename, scenario.language, scenario.before.code]);
  const newFile = useMemo<FileContents>(() => ({ name: scenario.filename, lang: scenario.language, contents: scenario.after.code }), [scenario.filename, scenario.language, scenario.after.code]);
  const acceptRange = useCallback((range: SelectedLineRange | null) => {
    if (range === null) { onSelect({ _tag: "WholeExample" }); return; }
    const side = range.side ?? "additions";
    if ((range.endSide ?? side) !== side) { onInvalidSelection(); return; }
    onSelect({ _tag: "Lines", side: side === "deletions" ? "before" : "after", startLine: Math.min(range.start, range.end), endLine: Math.max(range.start, range.end) });
  }, [onSelect, onInvalidSelection]);
  const options = useMemo<FileDiffOptions<Annotation>>(() => ({
    diffStyle: "split", diffIndicators: "bars", lineDiffType: "word-alt", overflow: "wrap",
    preferredHighlighter: "shiki-js", theme: { dark: "pierre-dark", light: "pierre-light" }, themeType,
    stickyHeader: true, hunkSeparators: "line-info", enableLineSelection: !disabled, enableGutterUtility: false,
    lineHoverHighlight: "line", onLineSelected: acceptRange,
  }), [themeType, disabled, acceptRange]);
  const annotations = useMemo<DiffLineAnnotation<Annotation>[]>(() => {
    const result: DiffLineAnnotation<Annotation>[] = [];
    for (const question of questions) {
      const { target } = question.context.question;
      if (question.context.example.id !== revision.id || target._tag !== "Lines") continue;
      result.push({ side: target.side === "before" ? "deletions" : "additions", lineNumber: target.endLine,
        metadata: { _tag: "Question", id: question.context.question.id, text: question.context.question.text },
      });
    }
    if (selection._tag === "Lines" && !disabled) result.push({ side: selection.side === "before" ? "deletions" : "additions", lineNumber: selection.endLine, metadata: { _tag: "Selection" } });
    return result;
  }, [questions, revision.id, selection, disabled]);
  const selectedLines: SelectedLineRange | null = selection._tag === "Lines"
    ? { start: selection.startLine, end: selection.endLine, side: selection.side === "before" ? "deletions" : "additions" } : null;

  return <div className="code-comparison">
    <MultiFileDiff<Annotation> className="diffduck-diff" disableWorkerPool oldFile={oldFile} newFile={newFile}
      options={options} selectedLines={selectedLines} lineAnnotations={annotations}
      renderHeaderMetadata={() => <div className="diff-actions" aria-label="Discuss this example">
        <button type="button" disabled={disabled} onClick={onAsk}>Ask ↗</button>
        <button type="button" disabled={disabled} onClick={onExplore}>Explore alternative</button>
      </div>}
      renderAnnotation={({ metadata }) => metadata._tag === "Selection"
        ? <div className="selection-actions"><span>Selected code</span><button type="button" onClick={onAsk}>Ask about this ↗</button><button type="button" onClick={onExplore}>Explore alternative</button></div>
        : <button className="line-discussion" type="button" onClick={() => onQuestion(metadata.id)}><span aria-hidden="true">↳</span> {metadata.text}</button>}
    />
    <details className="keyboard-selection"><summary>Choose a line range</summary>
      <form key={revision.id} onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const parsed = questionTargetSchema.safeParse({ _tag: "Lines", side: fields.get("side"), startLine: Number(fields.get("start")), endLine: Number(fields.get("end")) });
        if (!parsed.success || captureTarget(parsed.data, { before: scenario.before.code, after: scenario.after.code })._tag === "Err") { onInvalidSelection(); return; }
        onSelect(parsed.data); onAsk();
      }}>
        <label>Side <select name="side" defaultValue="after" disabled={disabled}><option value="before">Before</option><option value="after">After</option></select></label>
        <label>From <input name="start" type="number" min="1" required defaultValue="1" disabled={disabled} /></label>
        <label>To <input name="end" type="number" min="1" required defaultValue="1" disabled={disabled} /></label>
        <button type="submit" disabled={disabled}>Attach lines</button>
      </form>
    </details>
  </div>;
});
