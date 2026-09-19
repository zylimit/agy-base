# Antigravity Workspace Rules (GEMINI.md)

## 1. Safety & Security Guardrails
- **Unwaivable Boundaries**: Never log, commit, or expose secrets, passwords, or tokens. Stop and request explicit approval for destructive operations (`rm -rf`, process killing, modifying system configs).
- **Workspace Protection**: Do not modify, reformat, or delete unrelated user edits in the workspace.
- **Verification First**: Do not claim success without executing verification commands and providing actual receipt evidence.

## 2. Architecture & Code Quality
- **Module Hierarchy**: Respect module boundaries in `.agents/harness/module-catalog.json`. Cross-layer circular dependencies are strictly forbidden.
- **5-D DFX Standards**: Every core component must align with Resilience, Security, Safety, Privacy, and Reliability standards (FMEA & STRIDE driven).
- **Red-Locks-The-Bug**: Any bug fix must start with a failing test written by `tester` subagent, followed by code fix by `implementer` subagent.
- **Design Truth Order**: When coding UI, adhere strictly to `demo/index.html` > `DESIGN.md (Google YAML Tokens)` > `Design-Brief.md` > `Product-Spec.md`.
- **Four-State Fact Separation**: Distinguish `[确认]` (Fact), `[推断]` (Inference), `[默认]` (Low-risk default), and `[待定]` (Open question).

## 3. Subagent Orchestration
- Main agent is the sole coordinator.
- Dispatch fresh subagent instances (`implementer`, `code-reviewer`, `tester`, `deployer`).
- Subagents must return standardized status envelopes (`Status`, `Changed`, `Verified`, `Evidence`).
- Correction Propagation: Propagate any user requirement correction to downstream architecture, plans, and tests.

## 4. Lean Engineering (Five Anti-Over Disciplines)
- **Avoid Over-engineering**: Adhere to YAGNI. No imaginary abstractions, no unnecessary wrappers or factories.
- **Avoid Over-testing**: Reject 100% vanity coverage. Tier tests by P0/P1/P2 risk; eliminate mirror-image tests with independent oracles.
- **Avoid Over-reviewing**: Single-round multi-lens review with capped iterations (`reviewRounds <= 2`). Blocker must be fixed, non-blocker suggestions must never halt approval.
- **Avoid Over-defending**: Fail-Visible. Never swallow exceptions with empty catches; validate rigorously at external boundaries, trust internal contracts.
- **Avoid Over-trusting**: Zero blind trust in self-reported completions. Exact diff hash binding, fresh exit 0 outputs, and smoke probes required.
