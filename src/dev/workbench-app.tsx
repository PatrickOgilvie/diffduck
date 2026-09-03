import { useEffect, useState, useSyncExternalStore } from "react";
import type { OpenReview } from "../domain/commands.js";
import { exampleReview } from "../testing/fixtures.js";
import { ReviewSurface } from "../ui/review-surface.js";
import { parseDevelopmentReview, replyModes, type DevelopmentSession } from "./development-session.js";

/** Development chrome around the exact UI rendered by the plugin. */
export function WorkbenchApp({ session, replaceReview }: {
  readonly session: DevelopmentSession;
  readonly replaceReview: (review: OpenReview) => string | null;
}) {
  const controls = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [theme, setTheme] = useState<"light" | "dark">(() => window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const [readOnly, setReadOnly] = useState(false);
  const [reviewJson, setReviewJson] = useState(() => JSON.stringify(exampleReview(), null, 2));
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return <div className="workbench">
    <header className="workbench-toolbar" aria-label="Development controls">
      <div className="workbench-title"><strong>DiffDuck workbench</strong><span>Shared UI · local simulated replies · no model calls</span></div>
      <div className="workbench-controls">
        <label>Theme<select aria-label="Preview theme" value={theme} onChange={(event) => setTheme(event.target.value === "dark" ? "dark" : "light")}><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label>Replies<select aria-label="Simulated replies" value={controls.replyMode} onChange={(event) => { const mode = replyModes.find((value) => value === event.target.value); if (mode !== undefined) session.setReplyMode(mode); }}><option value="automatic">Automatic · 1.5s</option><option value="manual">Hold until I reply</option><option value="reject-delivery">Reject delivery</option></select></label>
        <button type="button" disabled={!controls.canReply} onClick={() => session.reply()}>Reply now</button>
        <button type="button" disabled={!controls.canReply} onClick={() => session.reply("cannot-answer")}>Cannot answer</button>
        <label className="workbench-checkbox"><input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />Read-only</label>
        <button type="button" onClick={() => setConfirmReset(true)}>Reset sample…</button>
      </div>
    </header>
    <details className="workbench-data"><summary>Review data & development tips</summary>
      <p>Edit <code>src/ui/review-surface.tsx</code>, <code>src/ui/discussion-panel.tsx</code>, <code>src/ui/code-comparison.tsx</code> or <code>src/ui/styles.css</code> and save. React and CSS updates keep the review session. Resize the browser to test responsive layouts.</p>
      <p>Paste a <code>show_diffduck_review</code> input to preview real examples. This stays in this page; code is never executed. Loading a review replaces this workbench’s discussion and drafts. Full reloads and session/controller edits also reset this local session.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseDevelopmentReview(reviewJson);
        setImportMessage(parsed._tag === "Err" ? parsed.error.message : replaceReview(parsed.value) ?? "Review loaded locally.");
      }}>
        <label htmlFor="review-json">Review JSON</label>
        <textarea id="review-json" value={reviewJson} onChange={(event) => setReviewJson(event.target.value)} rows={10} spellCheck={false} />
        <button type="submit">Replace with this review</button>
      </form>
      {importMessage !== null ? <p role="status">{importMessage}</p> : null}
    </details>
    {confirmReset ? <section className="workbench-reset" aria-label="Confirm sample reset"><p>Reset this local sample? Its questions and drafts will be cleared. Your installed plugin session is unaffected.</p><button type="button" onClick={() => { setImportMessage(replaceReview(exampleReview())); setConfirmReset(false); }}>Reset local sample</button><button type="button" onClick={() => setConfirmReset(false)}>Keep working</button></section> : null}
    {controls.message !== null ? <p className="surface-notice" role="status">{controls.message}</p> : null}
    <div className="workbench-preview"><ReviewSurface key={session.controller.getSnapshot().session?.sessionId} controller={session.controller} host={{ theme, fullscreen: false, canFullscreen: false, interactive: !readOnly, demo: true }} message={null} onFullscreen={() => {}} /></div>
    <p className="workbench-hint">Save → preview. No build, plugin reinstall or Codex restart needed for UI edits.</p>
  </div>;
}
