# DiffDuck

<img src="assets/diffduck-logo.svg" width="76" alt="DiffDuck duck" />

Talk through the change.

DiffDuck is a Codex plugin for reviewing the **developer experience** of a change. It turns implementation changes or API proposals into concrete before-and-after userland examples, then puts a conversation beside each comparison.

Select a line range, ask why something changed, or explore an alternative. The question carries the exact example revision, selected text, both complete code panes, source evidence and that tab's preceding discussion. Answers return to the original example even when you switch tabs.

## Status

Version 0.2.0 is an initial discussion-workflow implementation. See [verification](docs/verification.md) for completed checks and the real-host release gate. A simulated development preview is not evidence of a working Codex-host message round trip.

Live Codex testing exposed a failed question handoff and invalid-response messages, most recently at nullable parent revision IDs. Current source adds preparation recovery, safe error details and a JSON-string envelope for app-only replies. This preserves complete snapshots through a lossy host response hop while retaining strict validation. SDK regressions and an isolated Codex backend replay pass; the live embedded-panel round trip still needs verification. The published `v0.2.0-preview.1` archive does not include these fixes.

## Workflow

1. Run `$diffduck:review` in Codex, or ask: “Use DiffDuck to review these changes through before-and-after userland examples.”
2. Follow the horizontal revision trail: **Before → Revision 1 → Revision 2 → …**. Select lines in any column and use the inline actions, or open “Choose a line range” for keyboard input.
3. Ask a question or choose “Explore alternative.” Inspect the attachment before sending.
4. Keep drafting in another scenario while the question is pending. An unread marker points to its answer.
5. If an alternative is useful, choose “Use this example.” A new column appears to the right, showing changes from the preceding revision. The original code, earlier columns and discussions remain available.

Scroll horizontally, use the arrow buttons, or choose “Latest.” With the trail focused, Left/Right and Home/End navigate it. Each revision uses an inline diff against its predecessor, not a repeatedly compared original baseline. Removed lines attach to the saved revision they came from; added lines attach to the new revision. The conversation stays alongside the trail.

There is no approval button. DiffDuck does not edit your repository.

## Install

Requires Node.js 22+ on the PATH available to Codex and a Codex desktop build with MCP Apps, app-to-task messages and app-only server-tool calls.

The repository and release archive include the bundled server and single-file UI. Runtime installation does not require Bun, node_modules, an API key, or a separately hosted service.

Clone this repository or extract the plugin archive. In Codex, ask it to install the local `diffduck` plugin directory into your personal marketplace using the plugin-creator workflow. Keep the plugin directory intact: `.codex-plugin/`, `.mcp.json`, `skills/`, `assets/` and `dist/` belong together.

Once the personal-marketplace entry exists, `codex plugin add diffduck@personal` installs it. Start a new Codex task after installing or updating, then invoke `$diffduck:review` to open a fresh review. Restart Codex if the updated command or tools still do not appear. Existing review surfaces do not refresh to the new build; restarting the server ends existing sessions.

The model runs in your existing signed-in Codex task, subject to that account's plan and limits. DiffDuck adds no model billing integration and never reads your Codex credentials. Claude Desktop is not a verified target for this release.

## Develop

```sh
bun install --frozen-lockfile
bun run dev
```

Open [the local workbench](http://127.0.0.1:5173/). No build, installed plugin, Codex restart or API key is required. The server binds to loopback only and fails if port 5173 is already occupied (`bun run dev --port 5174` selects another port).

The browser and plugin render **the same React components and styles**. Save an edit to `src/ui/review-surface.tsx`, `src/ui/revision-trail.tsx`, `src/ui/discussion-panel.tsx`, `src/ui/code-comparison.tsx` or `src/ui/styles.css` to see it immediately. The development session is owned outside React, so component/CSS refreshes preserve drafts, selected examples and discussion history. Structural edits to controller/session/entrypoint modules can reload the page; full reloads clear local state. Nothing is persisted to browser storage.

The workbench includes light/dark and read-only previews, automatic or held simulated replies, delivery rejection, cannot-answer replies, alternative adoption, and an explicit sample reset. Use “Review data & development tips” to paste a `show_diffduck_review` input and load your own examples. Invalid JSON leaves the current review intact; a successful replacement clears the old local discussion. Resize the browser to test responsive layouts. After a simulated rejection, edit the retained draft to submit a new question.

This is a **visual development workbench**, not a browser connection to the installed MCP session or a live Codex chat. It exercises the real session service and discussion controller locally, with explicitly simulated replies. No model is contacted and no example code is executed. Live host transport and subscription-backed answers still run in the installed plugin. `mcp-app.html` is now the host-only entry; use `/` for development. Workbench code is excluded from the production build.

For continuous type checking, run `bun run dev:check` in another terminal. Vite refreshes quickly without waiting for TypeScript. Before packaging or sharing a change:

```sh
bun run build
bun test
```

`bun run package` rebuilds the plugin, collects third-party notices, and writes an allowlisted archive plus SHA-256 checksum into `release/`. It prints the isolated staging path so the bundled stdio test can also run with `DIFFDUCK_SERVER_CWD` set to that directory. Plugin installation is only needed when testing the packaged Codex host integration, not for each UI edit.

`dist/` is checked in so the plugin can run directly from a clone. Rebuild before committing source changes. Source maps, node_modules and local logs are excluded from distribution.

## Architecture

Read [the glossary](CONTEXT.md), [architecture](docs/architecture.md), and [decision](docs/adr/0001-question-context-and-host-loop.md).

The read-only comparison uses [@pierre/diffs](https://diffs.com/). It uses line selection and annotations; it does not enable Diffs' code editor. The custom gutter button is deferred after a pointer-hit-testing failure in the current host; inline actions and the keyboard range picker provide the same discussion workflow.

The eight-tool protocol has three model-visible tools: `show_diffduck_review`, `get_diffduck_question`, and `respond_in_diffduck`. Five app-only tools prepare questions, record delivery, read session updates, stop waiting, and adopt example alternatives. Only the opening tool is associated with a UI resource.

## Limits and privacy

- Session history lives in the local plugin process's memory. Restarting or reinstalling loses it. Browser drafts live only in the mounted surface; reloading that surface loses them.
- Questions and model-visible context are sent into the originating Codex task and follow the host's normal conversation handling. “Session-only” does not mean that Codex deletes task messages or tool results.
- Tabs have separate application histories but share one model task. They are not privacy or agent-isolation boundaries.
- One outstanding question per session; up to 8 sessions per process. Each session is capped at 8 MiB of serialized retained data; each frozen question context is capped at 32 KiB. Oversized input is rejected, never silently truncated.
- Polling runs every second initially, slows to every three seconds after 30 seconds, pauses while hidden, and stops after two minutes. “Check again” starts a fresh waiting period. It does not resubmit the question.
- An uncertain message is never automatically resent. Explicit retry warns that Codex may already have received it. “Stop waiting” rejects late answers locally; it does not stop Codex.
- If preparation may have saved a question but its receipt is lost, DiffDuck checks the saved discussion. Until that check succeeds, new submissions stay disabled while drafts remain editable. “Check again” can recover the pending question and its retry/stop controls; it never sends the question itself.
- The installed plugin has no listening network server, analytics, API-key storage, filesystem editing tool or automatic execution of example code. It reads its bundled HTML and uses stdio. The optional development workbench starts a loopback-only Vite server serving this repository; stop it when finished. Server diagnostics contain event categories and elapsed time only. UI response diagnostics contain the operation, response source and allowlisted schema paths/codes, never payload values or raw host errors.
- The parent Codex task retains its normal tools. The skill instructs it to remain in discussion mode; this is not a security sandbox for the model.

Author: [github.com/PatrickOgilvie](https://github.com/PatrickOgilvie). Third-party license texts are included in `THIRD_PARTY_NOTICES.txt`. No license for DiffDuck's own source has been selected yet.
