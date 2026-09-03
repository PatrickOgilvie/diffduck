# Discussion architecture

The composition root creates one `ReviewSessions` owner and one MCP stdio server. React owns a `DiscussionController` per mounted surface, with an MCP Apps adapter at its external boundary.

```text
Select/compose → prepare question → frozen context + routing identity
                       ↓
                send host message
                       ↓
Codex task → get exact context → respond to the original question
                                      ↓
Mounted UI ← conditional session read ← stored terminal response
```

## Ownership

| Module | Owns |
| --- | --- |
| domain/review, domain/discussion | Parsed example, provenance, selection and conversation contracts |
| domain/commands, protocol/diffduck | Strict command/result boundaries and exported protocol |
| service/review-sessions | Immutable histories, guarded transitions, identities and capacity |
| server/create-diffduck-server | MCP registration, visibility and UI resource metadata |
| ui/diffduck-bridge, ui/diffduck-tool-result | Validated host tool results, safe response diagnostics and delivery classification |
| ui/discussion-controller | Per-tab drafts, selection, unread state, dispatch and bounded polling |
| ui/code-comparison, ui/discussion-panel | Read-only examples, annotations, transcript and composer |
| ui/revision-trail, ui/revision-panels | Horizontal chronological columns and translation of adjacent-diff coordinates into saved source identities |
| ui/review-surface | Shared review screen, independent of host setup and development controls |
| ui/app-lifetime | Setup/fullscreen/teardown promise ownership |
| dev/main, dev/development-session | Optional development-page lifetime, real in-memory service and simulated delivery/replies |
| dev/workbench-app | Local preview controls and strict review-JSON import |

## Fast visual development

`index.html` is a separate Vite development entry. It mounts `WorkbenchApp` around the same `ReviewSurface` that `DiffDuckApp` uses in Codex. The production build still has only `mcp-app.html` as its entry and does not import development code.

The development entrypoint owns its `DevelopmentSession` and `DiscussionController`, not a React effect. Component Fast Refresh can rerun effects and replace React implementations without disposing the session or losing its drafts. Each module exporting a UI component remains a React refresh boundary. CSS updates do not reload the document. Changes to the session/controller/entrypoint can trigger a full reload and intentionally begin a new local session.

The development adapter implements the existing `DiscussionPort`, backed by the real `ReviewSessions` service. Only message delivery and model answers are simulated. Replies use frozen question identities, not the active tab; cancellation, alternative adoption, revisions, capacity limits and per-tab state follow production behavior. Timers and controller operations are cancelled/drained on replacement or unload. Review JSON is parsed through the production opening schema before replacement; malformed or oversized input does not dispose the current review.

This adds no MCP network transport, public endpoint, credential reader or model SDK. Browser sessions and installed-plugin sessions are independent. The loopback Vite server is opt-in and is not packaged; real Codex-host handoff remains a separate integration check.

## Revision trail

The shared screen renders the original before-file followed by every retained after-revision in a horizontally scrolling rail. Each after-column uses Diffs' unified `MultiFileDiff` against its immediate predecessor; the baseline uses `File`. This composes single-column views, not an N-way aligned merge editor. Parent links must describe a complete chronological chain; missing or out-of-order predecessors produce an explicit error instead of a guessed comparison.

`revision-panels` translates Diffs coordinates into `{ revisionId, target }`. An addition in revision 2 belongs to revision 2's after-pane. A deletion in that column belongs to revision 1's after-pane, **not** revision 2's immutable original before-pane. The first comparison's deletions belong to the original before-pane. Mixed-side and out-of-source selections are rejected. Annotations use the inverse mapping, so a saved question can appear at both representations of its exact source. The controller attaches the revision and target atomically while preserving draft text and reply anchors; question preparation still derives selected text from the real saved source.

New adoptions reveal the appended column. Focusing a historical question reveals its source column; ordinary selection does not jump horizontally. Each scenario retains its own horizontal position. Code inputs and panel descriptions are memoized so typing in the composer does not reparse all comparisons. The Diffs custom-header slot hosts actions; disabling its header in 1.3.6 can leave an empty initial render, so that option is deliberately avoided.

## Invariants

Opening and preparing are idempotent by caller identity plus equal input. A replay never automatically sends another host message. Responses use session, question and context identities; identical retries succeed, conflicting responses fail. A delivery receipt cannot overwrite a completed or cancelled question.

The service derives selected text from normalized, stored code, not browser-supplied snippets. Ranges are one-sided, inclusive and one-based; a terminal newline is not a phantom line. A context contains full examples and nonrecursive preceding history plus any historical revisions needed to interpret it.

Preparing checks the scenario transcript version the user saw. Adoption checks both the current revision and the alternative's base. It retains the before-pane and all old revisions. Existing drafts are not silently re-anchored by adoption or historical viewing.

Only the opening tool renders a resource. Success results carry the same complete wire representation in `structuredContent` and one JSON text block. The three model-facing tools retain their domain-shaped results. The five app-only tools use `{ format: "diffduck.app-result.v1", json: "<serialized typed result>" }`, keeping nested values inside a string across the embedded host boundary. The published app-tool output schema describes that envelope; the receiving adapter parses the envelope, decodes its JSON and then applies the unchanged strict domain result schema.

Errors set `isError: true` and carry their wire representation in JSON text without `structuredContent`. This keeps model-tool failures out of their success-only structured output schemas. Neither missing fields nor invalid values are replaced with defaults, and malformed structured envelopes cannot fall back to a different text result.

The opening notification and subsequent tool calls share one strict decoder. It uses structured data when present, otherwise exactly one JSON text block; malformed structured data cannot be disguised by a valid text block. Invalid responses produce a bounded `DD_RESPONSE_V1` diagnostic with the operation, response source and allowlisted schema paths/codes only. Host-call failures produce `DD_REQUEST_V1`. Neither diagnostic includes code, question text, raw host errors, received values or unknown property names. No automatic question retry is introduced.

Session mutations commit synchronously after capacity validation. No persistence or silent pruning occurs. IDs are local capabilities, not user-account authentication. Tool visibility is host-enforced metadata, not a substitute for an authorization server if a network transport is added later.

## Integration constraints

The host must support MCP Apps text messages and app-only server calls. This implementation does not use MCP sampling, a public callback URL, notification subscriptions or a second model SDK. Replies are stored as completed messages, not token streams.

The controller owns cancellation for every host call, ignores stale/foreign snapshots, allows at most one polling call in flight, and supervises every promise. Visibility and unmount cancel reads/timers; dispatch uncertainty does not imply non-delivery.

Preparation can commit before its response is lost. The controller then requires reconciliation before permitting another submission, even if it has not yet seen a pending question. A fresh session read restores the stored question and its actions, or proves that preparation did not commit. Failed reads preserve this requirement, drafts and selection; bounded polling and explicit checking remain available. Reads started before the preparation are cancelled, so an older unchanged result cannot falsely resolve its outcome. Reconciliation never sends a host message.

See [MCP Apps UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui#separate-data-processing-from-ui-rendering) and [Diffs documentation](https://diffs.com/llms-full.txt). The real Codex-host round trip remains a separate release check.
