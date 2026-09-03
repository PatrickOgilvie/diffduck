# Frozen questions in the originating Codex task

DiffDuck uses immutable question contexts and an explicit fetch/respond tool loop in the originating Codex task, instead of a separate model client or one agent per tab. This preserves the existing subscription workflow and exact historical anchors, at the cost of shared model context, one outstanding question per session, and a dependency on the host delivering app-originated messages and permitting data-tool polling.

Alternatives create after-only example revisions; adoption never edits repository files. Session histories are intentionally ephemeral for this version, so a restarted server reports an unavailable session rather than recreating a misleading partial conversation.
