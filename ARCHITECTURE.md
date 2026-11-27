# ARCHITECTURE — agy-base v3.0.0 架构设计

## 1. 设计定位与核心不变量

`agy-base` 是面向 Antigravity（`agy` CLI / Antigravity App / IDE）的 **v3.0.0 纯软链（Zero-Copy Link）跨平台发行版**，与 Claude Code（`cc-base`）、Cursor（`cursor-base`）、CodeAgent（`cac-base-link`）同仓零冲突共存：

- **单一真相源**：上游 `cc-base`（`.claude/`）持有全部主控宪法 `CLAUDE.md`、按需细则 `rules/`、技能 `skills/*/SKILL.md`、角色定义 `agents/*.md` 与生命周期钩子 `hooks/*.mjs`。`agy-base` 仓库自身不再拷贝 500+ 个 `.claude/` 文件，彻底消灭手工同步漂移。
- **双保险零拷贝技能挂载**：同时通过 `.agents/skills`（POSIX 相对软链 `../.claude/skills` / Windows 免管理员 NTFS Junction）与 `.agents/skills.json`（`{"entries":[{"path":".claude/skills"}]}`）指向 `.claude/skills`，Antigravity 自动去重，即使团队克隆未建链也能开箱发现技能。
- **根目录零文件侵入**：`seeded: []`，原根级 `GEMINI.md` 宿主差异说明内聚迁入 `.agents/rules/cc-base-agy-host.md`（`trigger: always_on`，`< 6 KB`），绝不污染下游项目根目录。
- **零外部依赖与全平台一等公民**：仅使用 Node.js `>= 20.0.0` 内置模块；所有子进程调用显式 `shell: false, windowsHide: true`；`setup.ps1` 保持纯 7-bit ASCII 无 UTF-8 BOM。

## 2. 目录拓扑

```text
agy-base/
├── cc-base-contract.json              # 对上游 cc-base (.claude/) 的文件/目录/技能/角色/钩子能力契约
├── setup.ps1                          # 纯 7-bit ASCII 无 BOM PowerShell 薄壳 -> scripts/agy-base.mjs
├── setup.sh                           # POSIX sh 薄壳 -> scripts/agy-base.mjs
├── setup-agy.sh                       # 向后兼容薄壳 -> setup.sh
├── scripts/
│   ├── agy-base.mjs                   # 统一 CLI 与事务安装内核（install/upgrade/uninstall/doctor/manifest/pack-check/release）
│   └── lib/
│       ├── path-guard.mjs             # Windows 保留设备名/系统目录/尾随点空格/越界路径前置硬拦截
│       ├── link-manager.mjs           # .agents/skills -> .claude/skills (Junction/相对软链) 建链、自愈与防穿透拆链
│       ├── cc-dep.mjs                 # 三层解耦 cc-base 自动寻源联装 + --bundle-cc 离线合包引擎
│       ├── hooks-merge.mjs            # .agents/hooks.json 无损合并（保留用户非 cc-base-* 块，卸载仅剥离框架块）
│       └── manifest.mjs               # LF-SHA256 清单构建校验与开发者路径/密钥反泄漏扫描
└── .agents/                           # 注入下游目标项目的自包含适配层（零外部目录依赖）
    ├── .gitattributes                 # 强制 LF 行尾
    ├── .gitignore                     # 自动忽略生成的 skills 软链、agents/、.runtime/ 与备份文件
    ├── FRAMEWORK-MANIFEST.json        # 9 个受管文件的 LF-SHA256 清单（engine: "agy-base", seeded: []）
    ├── skills.json                    # 声明式指向 .claude/skills（双保险通道）
    ├── hooks.json                     # 5 组 cc-base-* 生命周期钩子块
    ├── rules/
    │   ├── cc-base-claude.md          # always_on：@[CLAUDE.md](../../.claude/CLAUDE.md) 原生内联主控宪法
    │   └── cc-base-agy-host.md        # always_on：Antigravity 宿主工具映射、缺失事件补位与运行边界说明
    └── scripts/
        ├── hook-adapter.mjs           # Antigravity <-> cc-base 双向协议桥接、自愈与安全地板
        ├── gen-agents.mjs             # 从 .claude/agents/*.md 生成规范内部工具名子代理并写 agents-gen.sha256
        ├── ps-floor.mjs               # Bash + PowerShell + CMD 双壳危险命令、密钥外传与安全 .env 命令识别
        └── doctor.mjs                 # 双模健康自检（源仓 Mode A / 下游项目 Mode B，智能 selfRoot 回退）
```

## 3. Hook 桥接与防护矩阵（`hook-adapter.mjs`）

| Antigravity 事件 | Matcher | 桥接与增强行为 |
|---|---|---|
| `SessionStart` | `*` | ① 检查 `.agents/.runtime/install.marker` 中断残留；② **毫秒级自愈**：自动补建/修复 `.agents/skills` 软链/Junction，比对 `.agents/.runtime/agents-gen.sha256` 联合指纹按需重跑 `gen-agents.mjs`；③ 转调 `check-evolution`、`session-rules-banner` 与 `recap-on-dirty`（外层未跟踪父 `.git` 时注入 `GIT_CEILING_DIRECTORIES` 并改发边界提示） |
| `PreInvocation` | `*` | 子代理（`lastUserInput === ""`）直接放行；主 Agent 输入含 `/release-builder` 时前置检查 `.claude/.needs-review`，未清零则经 `injectSteps` 注入醒目阻断警告（补位缺失的 `UserPromptExpansion`）；普通输入按 `(conversationId, sha256)` 去重转调 `detect-feedback-signal` |
| `PreToolUse` | `run_command` | ① **双壳安全地板（F-05）**：先跑 `ps-floor.mjs` 的 `checkDangerousCommand` 与 `checkSecretExfil`（命中直接 `decision: "deny"`）；② **F-05.1**：`isSafePowerShellEnvCommand` 命中单条安全 `Test-Path .env` / `Copy-Item .env.example .env` 时跳过 POSIX 专用 `secret-exfil-guard` 防误杀；③ 拦截向未 `git init` 外层父仓 `git commit`；④ 自动补齐 `<root>/node_modules/.bin` PATH 并依序跑 `secret-exfil-guard` / `dangerous-pkill-guard` / `pre-commit-check`（支持 `resolveGitCommitRoot`）/ `kill-dev-ports`；⑤ `gh release` / `npm publish` / `docker push` 返回 `force_ask` |
| `PreToolUse` | `read_file\|view_file` | 就地硬拦 `.env`、私钥与凭据路径读取（对齐 `cc-base` `permissions.deny`） |
| `PreToolUse` | `write_file\|edit_file\|write_to_file\|replace_file_content` | 硬拦敏感凭据写入 → 归一化为相对 `root` 的 POSIX 路径（F-04）→ 放行 `.agents/**` → 子代理注入 `agent_id` 后转调 `no-direct-code-guard` |
| `PreToolUse` | `invoke_subagent` | 转换 `TypeName` / `Prompt` / `Role` 为 `Agent` payload 转调 `tdd-gate` |
| `PostToolUse` | `run_command` | 非外层未跟踪父 `.git` 时按 `resolveGitCommitRoot` 转调 `auto-push` |
| `PostToolUse` | `write_file\|edit_file\|write_to_file\|replace_file_content` | 归一相对路径；`.agents/**` 自身豁免 `mark-review-needed` 防污染 `.needs-review`（F-08），其余依次转调 `mark-review-needed` 与 `record-authorship` |
| `Stop` | `*` | 仅主 Agent 且 `fullyIdle !== false`、`terminationReason === "NO_TOOL_CALL"`、`executionNum < 3` 时调用 `stop-gate` 与 `three-file-sync-gate`；`strict` 档 `block` 转 `decision: "continue"`，`standard`/`fast` 档仅记账提醒 |

## 4. 三层解耦联装与八大安装可靠性保障

1. **三层解耦 `cc-base` 自动寻源联装（`cc-dep.mjs`）**：
   - **Tier 1（复用/同升）**：目标已有满足 `cc-base-contract.json` 的 `.claude/` 时直接复用；传 `--with-cc` 或 `--cc-base <dir>` 时同步升级 `.claude/`。
   - **Tier 2（一步联装）**：目标缺 `.claude/` 时按 `--cc-base <dir>` → `.bundled-cc-base/` → `CC_BASE_DIR` → `../cc-base` 自动寻源并调用上游 `setup.ps1` / `setup.sh`。
   - **Tier 3（延迟自愈）**：传 `--no-auto-cc`（或 `AGY_NO_AUTO_CC=1`）或当前环境暂无源时干净铺设 `.agents/` 桥接壳（exit 0），后续由 `SessionStart` 自动自愈。
2. **单包离线制品（`release <ver> --bundle-cc <dir>`）**：自动剥离上游私有记忆/运行态后将干净 `.claude/` 与安装脚本打入 `.bundled-cc-base/`，支持内网离线环境一键双装并通过全量反泄漏扫描。
3. **防符号链接穿透（F-01）**：锁前与建链前均以 `safeLstat` + `unlinkSymlinkOrJunctionSafe` 检测并拦截 `parent-is-symlink` 与 `same-realpath-as-target`，严禁对任何链接做递归删除。
4. **旧版 v2.x 无损平滑迁移**：自动识别旧版框架生成的根级 `GEMINI.md` 归档至 `.agents/.runtime/migrated-v2-<ts>/GEMINI.md`（用户手写 `GEMINI.md` 绝不触碰），并清理 `.agents/cc-base-*.txt`。
5. **三路冲突保护**：用户改过的受管文件绝不静默覆盖，新版旁落 `<file>.agy-new`。
6. **`hooks.json` 块级无损合并**：保留用户自定义非 `cc-base-*` 钩子块，卸载时仅剥离 `cc-base-*` 块。
7. **孤儿锁与目录锁自动回收（F-08）**：10 分钟陈旧锁超时、已死 PID 与残留目录锁自动接管。
8. **安全卸载零伤 `.claude/`（F-09）**：校验 `engine === "agy-base"`，仅摘除 `.agents/skills` 链接、带生成注释的 `.agents/agents/*.md` 与未改受管文件，`.claude/` 一字节不动。
