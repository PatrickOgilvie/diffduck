# DiffDuck

DiffDuck helps developers discuss the user-facing effect of a code change through concrete usage examples.

## Language

**Review**:
A collection of related before-and-after comparisons for an existing change or a design proposal.
_Avoid_: Approval

**Scenario**:
One coherent developer-facing behavior under discussion, with its own example and conversation.
_Avoid_: File, agent

**Example revision**:
An immutable before-and-after pair showing how a scenario is expressed in userland code.
_Avoid_: Commit, repository version

**Question context**:
The exact example, code scope, evidence and preceding scenario discussion attached to a question when it is sent.
_Avoid_: Current context

**Alternative**:
A proposed replacement for the after-example, not a patch to the repository.
_Avoid_: Fix, approved change

**Adoption**:
The user's explicit choice to use an alternative as a new example revision.
_Avoid_: Approval, merge, apply to repository
