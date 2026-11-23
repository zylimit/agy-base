# agy-base

cc-base 的 Antigravity（`agy` CLI / Antigravity App / IDE）发行版。cc-base 是一套给 Claude Code 用的产品开发框架——SiteMaster 人设、从需求到发布的全流程 Skill、主 Agent 只派单不编码的 Sub-Agent 模型、hook 闸门与三档位。本仓不另造第二套框架，直接保留 cc-base 原件为唯一真源，外包一层极薄的 `.agents/` 适配层：

```text
agy-base/
├── .claude/                   # cc-base 原件（CLAUDE.md / rules / skills / agents / hooks / scripts / tests …，零手改）
├── .agents/
│   ├── rules/
│   │   └── cc-base-claude.md  # always_on 规则，用 @[CLAUDE.md](../../.claude/CLAUDE.md) 原生内联主控规则
│   ├── skills.json            # 直接指向 .claude/skills（零复制，含 disable-model-invocation 原生生效）
│   ├── agents/                # 从 .claude/agents/*.md 生成：model: inherit + tools 白名单 + 正文补齐
│   ├── agents-models.json     # 可选：给某个角色钉模型写这里（如 {"code-reviewer":"pro"}），默认全 inherit
│   ├── hooks.json             # Antigravity 原生生命周期钩子，经 hook-adapter.mjs 桥接到真 .claude/hooks/*.mjs
│   ├── scripts/
│   │   ├── gen-agents.mjs     # 子代理生成器（幂等、清失源、保定制）
│   │   └── hook-adapter.mjs   # 协议双向翻译器（camelCase <-> snake_case、密钥读写拦截、子代理放行、Stop 熔断）
│   ├── tests/                 # 适配层自测（不装进目标项目）
│   ├── cc-base-files.txt      # 上次同步的 cc-base 清单（同步脚本写，据此删 cc-base 已没有的文件）
│   └── cc-base-version.txt    # 上次同步的 cc-base 提交与日期
├── GEMINI.md                  # Antigravity 宿主说明：只写宿主差异（不占 AGENTS.md，与 cursor-base 共存零冲突）
├── setup.sh / setup.ps1       # cc-base 原件的安装器
├── setup-agy.sh               # 装到目标项目：setup.sh + 铺 .agents/ 与 GEMINI.md
├── sync-from-cc-base.sh       # 从 cc-base HEAD 同步原件并重新生成 .agents/agents
├── docs/                      # cc-base 原件
├── progress.md                # 本仓的项目记忆
├── progress.archive.md        # 旧独立引擎时代（v2.2.0-legacy）的 progress 归档
└── README.md
```

## 要求

- Node.js 22 或更新（hook 与适配脚本都是 `.mjs`，单运行时）
- Git
- Antigravity CLI（`agy`）或 Antigravity App / IDE

## 装到一个项目

```sh
git clone https://github.com/zylimit/agy-base.git
cd agy-base
./setup-agy.sh /path/to/your-project
```

装完进项目目录启动 `agy`：
- `.claude/CLAUDE.md` 经 `.agents/rules/cc-base-claude.md` 自动内联生效；
- `.claude/skills/*` 经 `.agents/skills.json` 自动挂载（`release-builder` / `branch-finisher` 按 `disable-model-invocation: true` 仅限用户手动触发）；
- 8 个子代理经 `.agents/agents/*.md` 自动发现（可在 `invoke_subagent` 中直接派发）；
- 开场自动通过 `SessionStart` 注入「🔒 CC框架核心铁律」与当前档位。

**三端共存**：`.claude/` 原件零改动，且本仓用 `GEMINI.md` 不占 `AGENTS.md`，同一个目标项目可同时使用 Claude Code、Cursor（`cursor-base`）与 Antigravity（`agy-base`）互不冲突。

**拉框架更新或重装之后，退出 `agy` 重开一个新会话**，让新配置、技能、子代理与 hooks 生效。

### 可选：接通 CLI 状态栏

Antigravity CLI 支持自定义 `statusLine`（且 stdin JSON 字段与 Claude Code 兼容）。如需在底栏常驻显示 tier / 待审数 / 上下文占比，可在 `~/.gemini/antigravity-cli/settings.json` 加：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node .claude/scripts/statusline.mjs"
  }
}
```

## Antigravity 下跟 Claude Code 的差异

全在 [GEMINI.md](GEMINI.md)，装进目标项目后就在项目根。要点：
- Hook 经 `.agents/hooks.json` + `hook-adapter.mjs` 桥接到 `.claude/hooks/*.mjs`；
- `UserPromptExpansion` / `PreCompact` / `PostCompact` / `Notification` / `SubagentStop` 五个事件宿主没有；
- `PostToolUse` 同步且不能回注上下文，不接 `harness-async-verify.mjs`；
- 子代理默认 `model: inherit`，要钉模型写 `.agents/agents-models.json`；`feedback-observer` / `progress-recorder` 无原生 fork，派发时把上下文摘要写进 `Prompt`。

## 跟 cc-base 同步

```sh
./sync-from-cc-base.sh /path/to/cc-base
bash .claude/tests/cases/run-all.sh
bash .agents/tests/test-adapter.sh
git add -A && git commit
```

同步按 cc-base HEAD 清单覆盖原件，重写 `.agents/agents/` 与同步记录；不碰本仓的 `README.md`、`progress.md`、`progress.archive.md`、`.gitignore`、`GEMINI.md`、`.agents/` 和两个适配脚本。

## 旧版本

`v2.2.0-legacy` 之前的 `agy-base` 是一套脱离 `cc-base` 独立重写的脚手架（自定义 `arch-checker.js` / `dfx-validator.js` / 空壳 `hook-handlers.js`），2026-11-24 起停止维护并彻底淘汰，完整保留在 tag `v2.2.0-legacy`。
