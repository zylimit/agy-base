# Progress

agy-base 的项目记忆。本仓 = cc-base 原件 + Antigravity 适配层，cc-base 侧的决策不在这里重记，看 cc-base 的 progress.md；这里只记适配层与同步相关的事。v2.2.0-legacy（独立引擎时代）的记忆原样留在 progress.archive.md。

## Pinned（必守）

- `.claude/` 下的每个文件都是 cc-base 原件：不手改，要改回 cc-base 改完再同步。同步脚本按 cc-base **HEAD** 清单覆盖，手改必丢。
- Antigravity 不读 `.claude/settings.json`，因此本仓保持 `.claude/settings.json` 为 cc-base 原版 exec form（Claude Code 可共存；`setup-agy.sh` 装到已有 Cursor string form 的项目时由 `setup.sh` 自动保持原形态）。
- 本仓用根目录 `GEMINI.md`（不占 `AGENTS.md`），与 `cursor-base` 装入同一目标项目时零文件冲突。
- `.agents/agents/` 是生成物（`gen-agents.mjs`），`model: inherit` + Antigravity 规范内部工具名白名单；钉模型只写 `.agents/agents-models.json`。
- `.gitignore` 从 `/*` 起到 `# === Antigravity 适配层 ===` 之前与 cc-base 逐字相同，同步脚本核对，不同即退 1。
- 新增任何适配层控制之前先在本机 `agy` 里实测证明它会响；拦不住 / 证不出的闸不进家底。
- `.agents/tests/test-adapter.sh` 不碰所在仓的工作树：所有写操作均在 `mktemp` 副本里跑。

## Done

- 2026-11-24 **彻底淘汰旧版独立引擎并 100% 基于最新 cc-base 重建**：旧版打 tag `v2.2.0-legacy` 留档、旧 `progress.md` 归档至 `progress.archive.md`；同步基线 `cc-base 8e13f6c`（514 文件 + 8 生成子代理）；落地薄适配层（`GEMINI.md`、`.agents/rules/cc-base-claude.md`、`.agents/skills.json`、`.agents/hooks.json`、`.agents/scripts/gen-agents.mjs`、`.agents/scripts/hook-adapter.mjs`、`setup-agy.sh`、`sync-from-cc-base.sh`、`.agents/tests/test-adapter.sh`）。
- 2026-11-24 **验收通过**：`.agents/tests/test-adapter.sh` 34/34 PASS（0 FAIL / 0 SKIP）；`setup-agy.sh` 装到空项目后真机 `agy -p` 端到端验证通过：自动内联 `.claude/CLAUDE.md`（SiteMaster 中文 + 七字段派单）✓；`SessionStart` 注入 `tier: standard` + 「🔒 CC框架核心铁律」✓；`.agents/skills.json` 挂载 cc-base 技能且原生隐藏 `release-builder` / `branch-finisher` ✓；`read_file .env` 被 `agy-secret-guard` 拦截 ✓；主 Agent `write_file src/main.ts` 被 `no-direct-code-guard` 拦截 ✓；`implementer` 子代理拉起并成功写入 `src/sub.ts` + 跑通 `node --check`（exit 0）+ `PostToolUse` 登记进 `.claude/.needs-review` ✓。
- 2026-11-24 **补充跨仓软链技能说明**：实测指向 `workspaceDirs` 之外的 `.claude/skills/<名>` 软链默认被工作区边界跳过，启动带 `agy --add-dir <外部仓库>` 原生生效，已记入 `GEMINI.md`。
- 2026-11-25 **同步 `cc-base ce100eb` + 修复跨仓 `git commit` 误触发**：拉入 `readable-docs` 第四期（`page-shots.mjs`、`readable/structure.mjs`、`collect-feedback-docs.mjs` 等 521 文件），自动重生成 `.agents/agents/implementer.md`；`hook-adapter.mjs` 新增 `resolveGitCommitRoot` 识别 `cd <dir> && git commit` / `git -C <dir> commit`，避免误在当前会话仓库跑 `pre-commit-check` / `auto-push`（自测 35/35 PASS）。

## Decisions

- 2026-11-24 **用 `GEMINI.md` 而非 `AGENTS.md` 作为宿主说明，用 `.agents/rules/cc-base-claude.md` 内联 `.claude/CLAUDE.md`**。依据：Antigravity 原生读 `GEMINI.md` 且支持 `@[CLAUDE.md](../../.claude/CLAUDE.md)` 自动内联（独立占一个 24 KB 规则槽，不与宿主说明争预算）；Cursor 只读 `AGENTS.md` 不读 `GEMINI.md`，这样 Claude Code / Cursor / Antigravity 三端可零冲突共存于同一目标项目。适用范围：本仓与 `setup-agy.sh`。取代：旧版 `AGENTS.md` + `GEMINI.md` 中英双写。
- 2026-11-24 **`.agents/skills.json` 直接指向 `.claude/skills`，零复制**。依据：2026-11-24 `agy -p` 实测挂载全部 20 个模型可调技能，且原生遵守 `disable-model-invocation: true`（自动隐藏 `release-builder` 与 `branch-finisher`）。适用范围：`.agents/skills.json`。取代：旧版复制改写 18 个 skill（含多个 300B 空壳）。
- 2026-11-24 **子代理 `tools:` 使用 Antigravity 规范内部工具名，并按 `disallowedTools` 硬裁剪**。依据：2026-11-24 `agy -p` 实测：① 不写 `tools:` 时子代理仅拿到只读工具；② 写 `create_file` 报 tool not found、写 CLI 展示名 `write_file`/`edit_file` 触发已知挂起 bug；③ 写 `view_file` / `write_to_file` / `replace_file_content` / `run_command` 稳定映射为 CLI 的 `read_file` / `write_file` / `edit_file` / `run_command` + `manage_task`；④ 含 `Bash` 禁令的 3 个记录员直接去掉 `run_command`，且所有子代理不给 `start_subagent`/`invoke_subagent`，由运行时硬禁。适用范围：`.agents/scripts/gen-agents.mjs`。取代：无（旧版无 `.agents/agents/`）。
- 2026-11-24 **通过薄适配器 `hook-adapter.mjs` 桥接真 `.claude/hooks/*.mjs`，按 `lastUserInput` 区分主 Agent 与子代理**。依据：2026-11-24 `agy -p` 实测：Antigravity 全部 6 个事件均触发但 payload 无 `agent_id`，主 Agent 在工具/调用/停止事件中 `lastUserInput` 恒非空而子代理恒为 `""`；据此放行子代理的 `no-direct-code-guard` 与 `Stop`；`Stop` 同时校验 `fullyIdle !== false`、`terminationReason === 'NO_TOOL_CALL'` 与 `executionNum < 3`（实测 `continuationActive` 在当前 CLI 版本维持 `false`）；`PreToolUse` 就地补齐仓库级密钥读写拦截与发布命令 `force_ask`。适用范围：`.agents/hooks.json` 与 `.agents/scripts/hook-adapter.mjs`。取代：旧版 77 行空壳 `hook-handlers.js`。
- 2026-11-24 **不接入 `harness-async-verify.mjs`（同步阻塞限制）**。依据：Antigravity `hooks.md` 明确所有 hook 均同步阻塞且 `PostToolUse` 不支持回注上下文，接入 300s 校验会卡死每次文件编辑。适用范围：`.agents/hooks.json`。取代：无。

## 当前断点（2026-11-25）

`agy-base` 已对齐至 `cc-base ce100eb`（2026-11-25），静态与适配层自测全过并已推送远端。

## TODO

- [ ] #1 P3 交互模式（TUI）下确认 `SessionStart` 首次启动时 `lastUserInput` 与状态栏 `statusLine` 的实际显示效果。
- [ ] #2 P3 Windows（PowerShell）下的 `setup-agy.ps1`——按需补充，目前支持 Mac / Linux 与 Git Bash。

## In Progress

- 无。

## 明确不做（防过度工程）

- 不在本仓改 `.claude/` 原件（含 `settings.json`）。
- 不为 Antigravity 另写一套 skills / rules / feedback / 独立治理引擎。
- 不复活旧 `v2.2.0-legacy` 的任何空壳部件（`arch-checker.js`、`dfx-validator.js`、`mcp_config.json`、`hook-handlers.js`）。

## Notes

- 在本仓跑 `bash .claude/tests/cases/run-all.sh` 时，`test-readable-arch-pages.sh` 末尾一条用例 `git archive f79fc5c` 依赖 `cc-base` 本仓自己的历史提交号，在衍生发行仓（`agy-base` / `cursor-base`）里该提交不存在属上游预期差异；其余全部套件应 100% 通过。

