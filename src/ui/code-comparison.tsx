import { memo, useCallback, useMemo } from "react";
import { File, MultiFileDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation, FileContents, FileDiffOptions, FileOptions, SelectedLineRange } from "@pierre/diffs";
import { z } from "zod";
import type { QuestionId, QuestionIntent, QuestionRecord } from "../domain/discussion.js";
import { resolveRevisionSelection, selectionInRevisionPanel, type RevisionPanel, type RevisionSelection } from "./revision-panels.js";

type Annotation = { readonly _tag: "Selection" } | { readonly _tag: "Question"; readonly id: QuestionId; readonly text: string };
type Props = {
  readonly panel: RevisionPanel;
  readonly questions: readonly QuestionRecord[];
  readonly selection: RevisionSelection;
  readonly themeType: "light" | "dark";
  readonly disabled: boolean;
  readonly onSelect: (selection: RevisionSelection) => void;
  readonly onDiscuss: (selection: RevisionSelection, intent: QuestionIntent) => void;
  readonly onQuestion: (id: QuestionId) => void;
  readonly onInvalidSelection: (message: string) => void;
};

const rangeFieldsSchema = z.strictObject({ side: z.enum(["additions", "deletions"]), start: z.coerce.number().int().positive().safe(), end: z.coerce.number().int().positive().safe() });

/** One baseline file or one inline diff against its predecessor, with source-correct discussion actions. */
export const CodeComparison = memo(function CodeComparison({ panel, questions, selection, themeType, disabled, onSelect, onDiscuss, onQuestion, onInvalidSelection }: Props) {
  const { source, previous } = panel;
  const newFile = useMemo<FileContents>(() => ({ name: source.revision.scenario.filename, lang: source.revision.scenario.language, contents: source.revision.scenario[source.side].code }), [source.revision.scenario, source.side]);
  const oldFile = useMemo<FileContents | null>(() => previous === null ? null : { name: previous.revision.scenario.filename, lang: previous.revision.scenario.language, contents: previous.revision.scenario[previous.side].code }, [previous]);
  const selectedLines = selectionInRevisionPanel(panel, selection);
  const acceptRange = useCallback((range: SelectedLineRange | null) => {
    if (disabled) return;
    const parsed = resolveRevisionSelection(panel, range);
    if (parsed._tag === "Err") onInvalidSelection(parsed.error.message); else onSelect(parsed.value);
  }, [disabled, panel, onSelect, onInvalidSelection]);
  const commonOptions = useMemo(() => ({
    overflow: "wrap", preferredHighlighter: "shiki-js", theme: { dark: "pierre-dark", light: "pierre-light" }, themeType,
    stickyHeader: false, enableLineSelection: !disabled, enableGutterUtility: false, lineHoverHighlight: "line", onLineSelected: acceptRange,
  } satisfies FileOptions<Annotation>), [themeType, disabled, acceptRange]);
  const diffOptions = useMemo<FileDiffOptions<Annotation>>(() => ({ ...commonOptions,
    diffStyle: "unified", diffIndicators: "bars", lineDiffType: "word-alt", hunkSeparators: "line-info", expandUnchanged: true,
  }), [commonOptions]);
  const annotations = useMemo<DiffLineAnnotation<Annotation>[]>(() => {
    const result: DiffLineAnnotation<Annotation>[] = [];
    for (const record of questions) {
      const question = record.context.question;
      const range = selectionInRevisionPanel(panel, { revisionId: question.exampleRevisionId, target: question.target });
      if (range !== null) result.push({ side: range.side ?? "additions", lineNumber: range.end, metadata: { _tag: "Question", id: question.id, text: question.text } });
    }
    const range = selectionInRevisionPanel(panel, selection);
    if (range !== null && !disabled) result.push({ side: range.side ?? "additions", lineNumber: range.end, metadata: { _tag: "Selection" } });
    return result;
  }, [panel, questions, selection, disabled]);
  const discuss = (intent: QuestionIntent) => onDiscuss(selectedLines === null ? { revisionId: source.revision.id, target: { _tag: "WholeExample" } } : selection, intent);
  const renderAnnotation = ({ metadata }: { readonly metadata: Annotation }) => metadata._tag === "Selection"
    ? <div className="selection-actions"><span>Selected code</span><button type="button" disabled={disabled} onClick={() => discuss("ask")}>Ask about this ↗</button><button type="button" disabled={disabled} onClick={() => discuss("explore-alternative")}>Explore alternative</button></div>
    : <button className="line-discussion" type="button" onClick={() => onQuestion(metadata.id)}><span aria-hidden="true">↳</span> {metadata.text}</button>;

  // Use the header slot: disabling headers in Diffs 1.3.6 skips its initial render when the custom element supplies an empty pre.
  const renderHeader = () => <div className="revision-file-heading"><span title={newFile.name}>{newFile.name}</span><div className="diff-actions" aria-label={"Discuss " + source.label}>
      <button type="button" disabled={disabled} onClick={() => discuss("ask")}>Ask ↗</button>
      <button type="button" disabled={disabled} onClick={() => discuss("explore-alternative")}>Explore alternative</button>
    </div></div>;
  return <div className="code-comparison">
    {previous === null ? <File<Annotation> className="diffduck-diff" disableWorkerPool file={newFile} options={commonOptions} selectedLines={selectedLines} lineAnnotations={annotations} renderCustomHeader={renderHeader} renderAnnotation={renderAnnotation} />
      : <MultiFileDiff<Annotation> className="diffduck-diff" disableWorkerPool oldFile={oldFile} newFile={newFile} options={diffOptions} selectedLines={selectedLines} lineAnnotations={annotations} renderCustomHeader={renderHeader} renderAnnotation={renderAnnotation} />}
    <details className="keyboard-selection"><summary>Choose a line range</summary>
      <form onSubmit={(event) => {
        event.preventDefault(); if (disabled) return;
        const fields = new FormData(event.currentTarget);
        const parsed = rangeFieldsSchema.safeParse({ side: fields.get("side"), start: fields.get("start"), end: fields.get("end") });
        if (!parsed.success || parsed.data.start > parsed.data.end) { onInvalidSelection("Choose a valid, ordered line range."); return; }
        const target = resolveRevisionSelection(panel, parsed.data);
        if (target._tag === "Err") onInvalidSelection(target.error.message); else onDiscuss(target.value, "ask");
      }}>
        <label>Version <select name="side" defaultValue="additions" disabled={disabled}><option value="additions">{source.label}</option>{previous !== null ? <option value="deletions">{previous.label} · previous</option> : null}</select></label>
        <label>From <input name="start" type="number" min="1" required defaultValue="1" disabled={disabled} /></label>
        <label>To <input name="end" type="number" min="1" required defaultValue="1" disabled={disabled} /></label>
        <button type="submit" disabled={disabled}>Attach lines</button>
      </form>
    </details>
  </div>;
});
