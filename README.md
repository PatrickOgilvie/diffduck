# DiffDuck

<img src="assets/diffduck-logo.svg" width="76" alt="DiffDuck duck" />

Talk through the change.

DiffDuck is a Codex plugin for reviewing the **developer experience** of a change. It turns implementation changes or API proposals into concrete before-and-after userland examples, then puts a conversation beside each comparison.

Select a line range, ask why something changed, or explore an alternative. The question carries the exact example revision, selected text, both complete code panes, source evidence and that tab's preceding discussion. Answers return to the original example even when you switch tabs.

## Status

Version 0.2.0 is an initial discussion-workflow implementation. See [verification](docs/verification.md) for completed checks and the real-host release gate. A simulated development preview is not evidence of a working Codex-host message round trip.

The first live Codex test exposed a failed question handoff followed by a stuck pending question. The current source adds recovery for a lost preparation receipt; the original host failure still needs diagnosis. The published `v0.2.0-preview.1` archive does not include that recovery change.

## Workflow

1. Ask Codex: “Use DiffDuck to review these changes through before-and-after userland examples.”
2. Select lines on either side and use the inline actions, or open “Choose a line range” for keyboard input.
3. Ask a question or choose “Explore alternative.” Inspect the attachment before sending.
4. Keep drafting in another scenario while the question is pending. An unread marker points to its answer.
5. If an alternative is useful, choose “Use this example.” It creates a new after-example revision; the before-example and previous discussions remain unchanged.

There is no approval button. DiffDuck does not edit your repository.

## Install

Requires Node.js 22+ on the PATH available to Codex and a Codex desktop build with MCP Apps, app-to-task messages and app-only server-tool calls.

The repository and release archive include the bundled server and single-file UI. Runtime installation does not require Bun, node_modules, an API key, or a separately hosted service.

Clone this repository or extract the plugin archive. In Codex, ask it to install the local `diffduck` plugin directory into your personal marketplace using the plugin-creator workflow. Keep the plugin directory intact: `.codex-plugin/`, `.mcp.json`, `skills/`, `assets/` and `dist/` belong together.

Once the personal-marketplace entry exists, `codex plugin add diffduck@personal` installs it. Reload Codex after installation if the three model-facing DiffDuck tools are not visible. Restarting the server ends existing sessions.

The model runs in your existing signed-in Codex task, subject to that account's plan and limits. DiffDuck adds no model billing integration and never reads your Codex credentials. Claude Desktop is not a verified target for this release.

## Develop

```sh
bun install --frozen-lockfile
bun run build
bun test
bun run dev --host 127.0.0.1
```

`bun run package` rebuilds the plugin, collects third-party notices, and writes an allowlisted archive plus SHA-256 checksum into `release/`. It prints the isolated staging path so the bundled stdio test can also run with `DIFFDUCK_SERVER_CWD` set to that directory.

Open `http://127.0.0.1:5173/mcp-app.html` for the explicitly labeled demo. Its responses are simulated; no model is contacted. Demo response logic is excluded from the production bundle.

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
- No listening network server, analytics, API-key storage, filesystem editing tool or automatic execution of example code. The server reads its bundled HTML and uses stdio. Diagnostics contain event categories and elapsed time only.
- The parent Codex task retains its normal tools. The skill instructs it to remain in discussion mode; this is not a security sandbox for the model.

Author: [github.com/PatrickOgilvie](https://github.com/PatrickOgilvie). Third-party license texts are included in `THIRD_PARTY_NOTICES.txt`. No license for DiffDuck's own source has been selected yet.
