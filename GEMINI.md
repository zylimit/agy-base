# Antigravity Workspace Rules (GEMINI.md)

## 1. Safety & Security Guardrails
- **Unwaivable Boundaries**: Never log, commit, or expose secrets, passwords, or tokens. Stop and request explicit approval for destructive operations (`rm -rf`, process killing, modifying system configs).
- **Workspace Protection**: Do not modify, reformat, or delete unrelated user edits in the workspace.
- **Verification First**: Do not claim success without executing verification commands and providing actual receipt evidence.

## 2. Architecture & Code Quality
- **Module Hierarchy**: Respect module boundaries in `module-catalog.json`. Cross-layer circular dependencies are strictly forbidden.
- **5-D DFX Standards**: Every core component must align with Resilience, Security, Safety, Privacy, and Reliability standards.
- **Red-Locks-The-Bug**: Any bug fix must start with a failing test written by `tester` subagent, followed by code fix by `implementer` subagent.

## 3. Subagent Orchestration
- Main agent is the sole coordinator.
- Dispatch fresh subagent instances (`implementer`, `code-reviewer`, `tester`, `deployer`).
- Subagents must return standardized status envelopes (`Status`, `Changed`, `Verified`, `Evidence`).
