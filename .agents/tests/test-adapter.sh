#!/usr/bin/env bash
# risk: high
# test-adapter.sh — Antigravity 适配层自测：
#   1. gen-agents.mjs 的产出形状、tools 白名单、模型钉死与回落、失源清理与定制保留；
#   2. hook-adapter.mjs 的全事件翻译（SessionStart / PreInvocation 去重 / PreToolUse 密钥拦截、主vs子代理
#      no-direct-code-guard、dangerous-pkill-guard、publish force_ask、tdd-gate / PostToolUse 登记待审 /
#      Stop 子代理与 fullyIdle=false 放行、strict 拦停转 continue、executionNum>=3 熔断）；
#   3. setup-agy.sh 装到临时目录（含已有配置落 .framework-new、失源清理、dry-run、保留 Cursor string form）；
#   4. sync-from-cc-base.sh 的行为夹具与真 cc-base 幂等。
#
# 纪律：全程不写本仓（ROOT）：开头 cp -a 本仓（含 .git）到 mktemp 副本 $R，结尾核对 ROOT 的 git status --short 不变。
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1

echo "===== test-adapter (agy-base) ====="

if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: 无 node——gen-agents 与 hook-adapter 都跑不了，未执行 != 通过。" >&2
    exit 1
fi

PASS=0
FAIL=0
SKIP=0
TMPS=""
STATUS0=$(git status --short | LC_ALL=C sort | cksum)

cleanup() {
    # shellcheck disable=SC2086
    [ -n "$TMPS" ] && rm -rf $TMPS
}
trap cleanup EXIT

R=$(mktemp -d); TMPS="$TMPS $R"
cp -a "$ROOT/." "$R/" || { echo "cp -a 本仓到 $R 失败" >&2; exit 1; }
cd "$R" || exit 1
W=$(mktemp -d); TMPS="$TMPS $W"
MODELS="$R/.agents/agents-models.json"
gen() { CLAUDE_PROJECT_DIR="${1:-$R}" node "$R/.agents/scripts/gen-agents.mjs"; }
tsum() { (cd "$1" && find . -path ./.git -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 cksum | cksum); }

chk() {
    if [ "$1" -eq 0 ]; then
        PASS=$((PASS + 1)); echo "  [PASS] $2"
    else
        FAIL=$((FAIL + 1)); echo "  [FAIL] $2"
    fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}

has() { grep -qF -- "$2" "$1"; }
fmline() {
    awk -v k="$2" '
        /^---$/ { n++; next }
        n == 1 && index($0, k ": ") == 1 { print substr($0, length(k) + 3); exit }
        n >= 2 { exit }
    ' "$1"
}
fmblock() {
    awk '/^---$/ { n++; next } n == 1 { print } n >= 2 { exit }' "$1"
}

AG="$R/.agents/agents"

echo "--- gen-agents：产出形状与 tools 白名单"
gen >/dev/null 2>&1
rc=$?
chk "$rc" "gen-agents 退 0" "rc=0" "rc=$rc"
n=$(find "$AG" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
chk "$([ "$n" = "8" ] && echo 0 || echo 1)" "产出 8 个文件" "8" "$n"

bad_model=""; bad_sub=""; bad_main=""; bad_key=""
for f in "$AG"/*.md; do
    [ "$(fmline "$f" model)" = "inherit" ] || bad_model="$bad_model $(basename "$f")"
    [ "$(fmline "$f" subagent)" = "true" ] || bad_sub="$bad_sub $(basename "$f")"
    [ "$(fmline "$f" mainAgent)" = "false" ] || bad_main="$bad_main $(basename "$f")"
    for k in skills color memory disallowedTools maxTurns; do
        [ -n "$(fmline "$f" "$k")" ] && bad_key="$bad_key $(basename "$f"):$k"
    done
done
chk "$([ -z "$bad_model" ] && echo 0 || echo 1)" "每个文件 frontmatter 含 model: inherit" "无例外" "例外：${bad_model:-无}"
chk "$([ -z "$bad_sub" ] && [ -z "$bad_main" ] && echo 0 || echo 1)" "每个文件含 subagent: true 且 mainAgent: false" "无例外" "sub:${bad_sub:-无} main:${bad_main:-无}"
chk "$([ -z "$bad_key" ] && echo 0 || echo 1)" "frontmatter 不含 skills / color / memory / disallowedTools / maxTurns" "无" "${bad_key:-无}"

# tools 白名单检查：无 Bash 禁令的角色有 run_command，有 Bash 禁令的 3 个角色无 run_command，全部无 subagent
bad_tools=""
for a in implementer code-reviewer tester deployer evolution-runner; do
    tb=$(fmblock "$AG/$a.md" | awk '/^tools:/{on=1;next} on && /^  - /{print} on && !/^  - /{exit}')
    printf '%s\n' "$tb" | grep -qx '  - view_file' \
        && printf '%s\n' "$tb" | grep -qx '  - write_to_file' \
        && printf '%s\n' "$tb" | grep -qx '  - replace_file_content' \
        && printf '%s\n' "$tb" | grep -qx '  - run_command' \
        && ! printf '%s\n' "$tb" | grep -q 'subagent' \
        || bad_tools="$bad_tools $a"
done
chk "$([ -z "$bad_tools" ] && echo 0 || echo 1)" "可跑命令的 5 个角色 tools 含 view_file/write_to_file/replace_file_content/run_command 且无 subagent" "无例外" "例外：${bad_tools:-无}"

bad_nobash=""
for a in domain-recorder feedback-observer progress-recorder; do
    tb=$(fmblock "$AG/$a.md" | awk '/^tools:/{on=1;next} on && /^  - /{print} on && !/^  - /{exit}')
    printf '%s\n' "$tb" | grep -qx '  - view_file' \
        && printf '%s\n' "$tb" | grep -qx '  - write_to_file' \
        && printf '%s\n' "$tb" | grep -qx '  - replace_file_content' \
        && ! printf '%s\n' "$tb" | grep -q 'run_command' \
        || bad_nobash="$bad_nobash $a"
done
chk "$([ -z "$bad_nobash" ] && echo 0 || echo 1)" "disallowedTools 含 Bash 的 3 个角色 tools 不含 run_command（运行时硬禁）" "无例外" "例外：${bad_nobash:-无}"

bad_head=""; bad_cmt=""
for f in "$AG"/*.md; do
    [ "$(head -n 1 "$f")" = "---" ] || bad_head="$bad_head $(basename "$f")"
    cl=$(grep -n -m1 -F '<!-- 由 .agents/scripts/gen-agents.mjs' "$f" | cut -d: -f1)
    fe=$(awk '/^---$/ { n++; if (n == 2) { print NR; exit } }' "$f")
    { [ -n "$cl" ] && [ -n "$fe" ] && [ "$cl" -gt "$fe" ]; } || bad_cmt="$bad_cmt $(basename "$f")"
done
chk "$([ -z "$bad_head" ] && [ -z "$bad_cmt" ] && echo 0 || echo 1)" "首行是 --- 且生成注释在 frontmatter 之后" "无例外" "head:${bad_head:-无} cmt:${bad_cmt:-无}"

echo "--- gen-agents：正文逐字一致、开头三句、失源清理、钉模型"
fbody() { awk '/^---$/ && n < 2 { n++; next } n >= 2 { if (!st && $0 == "") next; st = 1; print }' "$1"; }
bad_body=""; bad_pre=""
for f in "$AG"/*.md; do
    b=$(basename "$f"); src="$R/.claude/agents/$b"
    fbody "$src" >"$W/src.body"; fbody "$f" >"$W/gen.body"
    nl=$(wc -l <"$W/src.body" | tr -d ' '); total=$(wc -l <"$W/gen.body" | tr -d ' ')
    tail -n "$nl" "$W/gen.body" >"$W/gen.tail"
    cmp -s "$W/src.body" "$W/gen.tail" || bad_body="$bad_body $b"
    if head -n "$((total - nl))" "$W/gen.body" | grep -v '^$' | tail -n +2 \
        | grep -qvE '^(开工前先完整读 |不要再派子代理。$|不要用 .+工具。$|你的持久记忆在 )'; then bad_pre="$bad_pre $b"; fi
done
chk "$([ -z "$bad_body" ] && [ -z "$bad_pre" ] && echo 0 || echo 1)" "正文与源文件逐字一致，前置句仅含约定句式" "无例外" "body:${bad_body:-无} pre:${bad_pre:-无}"

F=$(mktemp -d); TMPS="$TMPS $F"
mkdir -p "$F/.claude/agents" "$F/.agents/agents"
for nm in gone stay; do
    printf -- '---\nname: %s\ndescription: d-%s\ndisallowedTools: Agent\n---\n\n正文 %s\n' "$nm" "$nm" "$nm" >"$F/.claude/agents/$nm.md"
done
printf '手写的\n' >"$F/.agents/agents/keep.md"
gen "$F" >/dev/null 2>&1
cp "$F/.agents/agents/stay.md" "$F/.agents/agents/my-stay.md"
rm -f "$F/.claude/agents/gone.md"
gen "$F" >/dev/null 2>&1; rc=$?
chk "$([ "$rc" -eq 0 ] && [ ! -e "$F/.agents/agents/gone.md" ] && [ -f "$F/.agents/agents/keep.md" ] && [ -f "$F/.agents/agents/my-stay.md" ] && echo 0 || echo 1)" "删源后清失源 gone.md，手写 keep.md 与复制改名 my-stay.md 保留" "gone 无、keep/my-stay 有" "rc=$rc gone=$([ -e "$F/.agents/agents/gone.md" ] && echo 有 || echo 无) keep=$([ -f "$F/.agents/agents/keep.md" ] && echo 有 || echo 无) my-stay=$([ -f "$F/.agents/agents/my-stay.md" ] && echo 有 || echo 无)"

printf '{"code-reviewer":"pro"}\n' >"$MODELS"
gen >/dev/null 2>&1
g1=$(fmline "$AG/code-reviewer.md" model); g2=$(fmline "$AG/tester.md" model)
chk "$([ "$g1" = "pro" ] && [ "$g2" = "inherit" ] && echo 0 || echo 1)" "agents-models.json 钉死 code-reviewer=pro，其余仍 inherit" "pro / inherit" "$g1 / $g2"
printf '{坏JSON' >"$MODELS"
gen >/dev/null 2>&1; rc=$?
chk "$([ "$rc" -eq 1 ] && echo 0 || echo 1)" "损坏的 agents-models.json 退 1 不静默回落" "rc=1" "rc=$rc"
rm -f "$MODELS"
gen >/dev/null 2>&1

echo "--- hook-adapter：全事件协议翻译与闸门验证"
HP=$(mktemp -d); TMPS="$TMPS $HP"
"$R/setup-agy.sh" "$HP" >/dev/null 2>&1
git -C "$HP" init -q && git -C "$HP" -c user.name=t -c user.email=t@t commit --allow-empty -q -m init
ADAPTER="$HP/.agents/scripts/hook-adapter.mjs"
run_ad() {
    local mode=$1 payload=$2
    printf '%s' "$payload" | (cd "$HP/.agents" && node "$ADAPTER" "$mode" 2>/dev/null)
}

# 1. SessionStart 注入核心铁律横幅
out=$(run_ad SessionStart "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"hi\"}")
chk "$(printf '%s' "$out" | grep -q 'injectSteps' && printf '%s' "$out" | grep -q 'CC框架核心铁律' && echo 0 || echo 1)" "SessionStart 返回 injectSteps 并含 CC框架核心铁律" "含 injectSteps 与横幅" "${out:0:120}"

# 2. PreInvocation 修正信号触发 + 同轮去重 + 子代理静默
out1=$(run_ad PreInvocation "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"conversationId\":\"c1\",\"lastUserInput\":\"不对，你搞错了\"}")
out2=$(run_ad PreInvocation "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"conversationId\":\"c1\",\"lastUserInput\":\"不对，你搞错了\"}")
out3=$(run_ad PreInvocation "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"conversationId\":\"sub1\",\"lastUserInput\":\"\"}")
chk "$(printf '%s' "$out1" | grep -q 'feedback-observer' && [ "$out2" = "{}" ] && [ "$out3" = "{}" ] && echo 0 || echo 1)" "PreInvocation 首次命中注入、同轮二次去重、子代理(空 lastUserInput)静默" "首次注入 / 二次 {} / 子代理 {}" "1:${out1:0:40} 2:$out2 3:$out3"

# 3. PreToolUse(read_file) 密钥拦截 + .env.example 放行
out_env=$(run_ad PreToolUse "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"u\",\"toolCall\":{\"name\":\"read_file\",\"args\":{\"Path\":\"$HP/.env\"}}}")
out_ex=$(run_ad PreToolUse "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"u\",\"toolCall\":{\"name\":\"read_file\",\"args\":{\"Path\":\"$HP/.env.example\"}}}")
chk "$(printf '%s' "$out_env" | grep -q '"decision":"deny"' && printf '%s' "$out_ex" | grep -q '"decision":"allow"' && echo 0 || echo 1)" "PreToolUse(read_file) 拦截 .env、放行 .env.example" "deny / allow" "$out_env | $out_ex"

# 4. PreToolUse(write_file) 主 Agent 写 src/ 被拦，子代理(空 lastUserInput) 放行
out_main=$(run_ad PreToolUse "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"conversationId\":\"main1\",\"lastUserInput\":\"write code\",\"toolCall\":{\"name\":\"write_file\",\"args\":{\"Path\":\"$HP/src/app.ts\"}}}")
out_sub=$(run_ad PreToolUse "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"conversationId\":\"sub1\",\"lastUserInput\":\"\",\"toolCall\":{\"name\":\"write_file\",\"args\":{\"Path\":\"$HP/src/app.ts\"}}}")
chk "$(printf '%s' "$out_main" | grep -q '"decision":"deny"' && printf '%s' "$out_sub" | grep -q '"decision":"allow"' && echo 0 || echo 1)" "no-direct-code-guard 拦主 Agent 写 src/、放行子代理写 src/" "主 deny / 子 allow" "主:$out_main | 子:$out_sub"

# 5. PreToolUse(run_command) dangerous-pkill-guard 拦 + npm publish force_ask + 安全命令 allow
out_pk=$(run_ad PreToolUse "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"u\",\"toolCall\":{\"name\":\"run_command\",\"args\":{\"CommandLine\":\"pkill -f node\"}}}")
out_pub=$(run_ad PreToolUse "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"u\",\"toolCall\":{\"name\":\"run_command\",\"args\":{\"CommandLine\":\"npm publish --access public\"}}}")
out_ok=$(run_ad PreToolUse "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"u\",\"toolCall\":{\"name\":\"run_command\",\"args\":{\"CommandLine\":\"git status\"}}}")
chk "$(printf '%s' "$out_pk" | grep -q '"decision":"deny"' && printf '%s' "$out_pub" | grep -q '"decision":"force_ask"' && printf '%s' "$out_ok" | grep -q '"decision":"allow"' && echo 0 || echo 1)" "PreToolUse(run_command) pkill -f=deny / npm publish=force_ask / git status=allow" "deny / force_ask / allow" "$out_pk | $out_pub | $out_ok"

# 6. PostToolUse(write_file) 登记 .claude/.needs-review 并返回 {}
out_post=$(run_ad PostToolUse "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"\",\"toolCall\":{\"name\":\"write_file\",\"args\":{\"Path\":\"$HP/src/app.ts\"}}}")
chk "$([ "$out_post" = "{}" ] && grep -qxF 'src/app.ts' "$HP/.claude/.needs-review" 2>/dev/null && echo 0 || echo 1)" "PostToolUse(write_file) 返回 {} 并把 src/app.ts 记入 .claude/.needs-review" "{} 且登记 src/app.ts" "out=$out_post file=$(cat "$HP/.claude/.needs-review" 2>/dev/null | tr '\n' ',')"

# 7. Stop：子代理放行、fullyIdle=false 放行、strict 档有待审转 continue、executionNum>=3 熔断放行
(cd "$HP" && CLAUDE_PROJECT_DIR="$HP" node "$HP/.claude/harness/harness.mjs" tier set strict --reason "test" >/dev/null 2>&1)
out_s_sub=$(run_ad Stop "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"\",\"fullyIdle\":true,\"terminationReason\":\"NO_TOOL_CALL\",\"executionNum\":0}")
out_s_busy=$(run_ad Stop "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"u\",\"fullyIdle\":false,\"terminationReason\":\"NO_TOOL_CALL\",\"executionNum\":0}")
out_s_blk=$(run_ad Stop "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"u\",\"fullyIdle\":true,\"terminationReason\":\"NO_TOOL_CALL\",\"executionNum\":0}")
out_s_cap=$(run_ad Stop "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"u\",\"fullyIdle\":true,\"terminationReason\":\"NO_TOOL_CALL\",\"executionNum\":3}")
chk "$(printf '%s' "$out_s_sub" | grep -q '"decision":"allow"' && printf '%s' "$out_s_busy" | grep -q '"decision":"allow"' && printf '%s' "$out_s_blk" | grep -q '"decision":"continue"' && printf '%s' "$out_s_cap" | grep -q '"decision":"allow"' && echo 0 || echo 1)" "Stop 子代理=allow / fullyIdle=false=allow / strict 待审=continue / exec>=3 熔断=allow" "allow / allow / continue / allow" "sub:$out_s_sub | busy:$out_s_busy | blk:${out_s_blk:0:60} | cap:$out_s_cap"

# 8. PreToolUse(invoke_subagent) tdd-gate 在 strict 档无 .red-verified 时拦截 bug 修复派单
out_tdd=$(run_ad PreToolUse "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"fix bug\",\"toolCall\":{\"name\":\"invoke_subagent\",\"args\":{\"TypeName\":\"implementer\",\"Role\":\"Bug Fix\",\"Prompt\":\"修复线上解析器 bug\"}}}")
chk "$(printf '%s' "$out_tdd" | grep -q '"decision":"deny"' && echo 0 || echo 1)" "PreToolUse(invoke_subagent) strict 档未验红派 implementer 修 bug 被 tdd-gate 拦截" "deny" "$out_tdd"

# 9. PreToolUse(run_command) 跨仓 git commit 不误跑当前 workspace 的 pre-commit-check
printf 'function broken( {\n' >"$HP/bad.js"
git -C "$HP" add bad.js
OTHER_REPO=$(mktemp -d); TMPS="$TMPS $OTHER_REPO"
git -C "$OTHER_REPO" init -q
out_same=$(run_ad PreToolUse "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"u\",\"toolCall\":{\"name\":\"run_command\",\"args\":{\"CommandLine\":\"git commit -m x\"}}}")
out_cd=$(run_ad PreToolUse "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"u\",\"toolCall\":{\"name\":\"run_command\",\"args\":{\"CommandLine\":\"cd $OTHER_REPO && git commit -m x\"}}}")
out_gitc=$(run_ad PreToolUse "{\"cwd\":\"$HP\",\"workspacePaths\":[\"$HP\"],\"lastUserInput\":\"u\",\"toolCall\":{\"name\":\"run_command\",\"args\":{\"CommandLine\":\"git -C $OTHER_REPO commit -m x\"}}}")
chk "$(printf '%s' "$out_same" | grep -q '"decision":"deny"' && printf '%s' "$out_cd" | grep -q '"decision":"allow"' && printf '%s' "$out_gitc" | grep -q '"decision":"allow"' && echo 0 || echo 1)" "跨仓 cd / git -C 提交不误跑当前仓的 pre-commit-check（本仓坏语法仍 deny）" "本仓 deny / 跨仓 cd allow / git -C allow" "same:${out_same:0:40} cd:$out_cd gitC:$out_gitc"

echo "--- setup-agy：装到临时目录、保留冲突、清理失源、三端共存、dry-run"
T=$(mktemp -d); TMPS="$TMPS $T"
"$R/setup-agy.sh" "$T" >"$T.out1" 2>&1; rc=$?; TMPS="$TMPS $T.out1"
chk "$rc" "setup-agy 首次安装退 0" "rc=0" "rc=$rc（尾：$(tail -2 "$T.out1" | tr '\n' ' ')）"
n=$(find "$T/.agents/agents" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
chk "$([ "$n" = "8" ] && [ -f "$T/GEMINI.md" ] && [ -f "$T/.agents/skills.json" ] && [ -f "$T/.agents/hooks.json" ] && [ -f "$T/.agents/rules/cc-base-claude.md" ] && [ -f "$T/.agents/scripts/hook-adapter.mjs" ] && [ ! -e "$T/.agents/tests" ] && echo 0 || echo 1)" "目标含 8 个 agent、GEMINI.md、skills.json、hooks.json、cc-base-claude.md、hook-adapter.mjs，且不含 .agents/tests" "全部齐全且无 tests" "agents=$n tests=$([ -e "$T/.agents/tests" ] && echo 有 || echo 无)"

printf '<!-- 由 .agents/scripts/gen-agents.mjs 从 .claude/agents/old-gen.md 生成 -->\n' >"$T/.agents/agents/old-gen.md"
printf '手写\n' >"$T/.agents/agents/hand.md"
cp "$T/.agents/agents/code-reviewer.md" "$T/.agents/agents/my-reviewer.md"
printf 'x' >>"$T/GEMINI.md"
before=$(cksum <"$T/GEMINI.md")
"$R/setup-agy.sh" "$T" >"$T.out2" 2>&1; rc=$?; TMPS="$TMPS $T.out2"
after=$(cksum <"$T/GEMINI.md")
chk "$([ "$rc" -eq 0 ] && [ "$before" = "$after" ] && [ -f "$T/GEMINI.md.framework-new" ] && cmp -s "$T/GEMINI.md.framework-new" "$R/GEMINI.md" && echo 0 || echo 1)" "改过的 GEMINI.md 不被覆盖，新版本落 GEMINI.md.framework-new" "未覆盖且生成 .framework-new" "rc=$rc same=$([ "$before" = "$after" ] && echo 是 || echo 否)"
chk "$([ ! -e "$T/.agents/agents/old-gen.md" ] && [ -f "$T/.agents/agents/hand.md" ] && [ -f "$T/.agents/agents/my-reviewer.md" ] && echo 0 || echo 1)" "重装清失源 old-gen.md，手写 hand.md 与复制改名 my-reviewer.md 保留" "old-gen 无、hand/my-reviewer 有" "old=$([ -e "$T/.agents/agents/old-gen.md" ] && echo 有 || echo 无) hand=$([ -f "$T/.agents/agents/hand.md" ] && echo 有 || echo 无) my=$([ -f "$T/.agents/agents/my-reviewer.md" ] && echo 有 || echo 无)"

# 三端共存：目标已是 Cursor string form + AGENTS.md，装 setup-agy 后保持 string form 且不动 AGENTS.md
node "$T/.claude/scripts/hook-form.mjs" --to string --file "$T/.claude/settings.json" >/dev/null 2>&1
printf 'cursor agents md\n' >"$T/AGENTS.md"
"$R/setup-agy.sh" "$T" >/dev/null 2>&1
form_after=$(node "$T/.claude/scripts/hook-form.mjs" --check --file "$T/.claude/settings.json" 2>&1)
chk "$([ "$form_after" = "string" ] && [ "$(cat "$T/AGENTS.md")" = "cursor agents md" ] && echo 0 || echo 1)" "与 cursor-base 共存：保留目标 string form 且不碰 AGENTS.md" "string 且 AGENTS.md 原样" "form=$form_after"

D=$(mktemp -d); TMPS="$TMPS $D"
"$R/setup-agy.sh" "$D/proj" --dry-run >"$D.out" 2>&1; rc=$?; TMPS="$TMPS $D.out"
chk "$([ "$rc" -eq 0 ] && [ ! -e "$D/proj" ] && echo 0 || echo 1)" "--dry-run 退 0 且不创建目标目录" "rc=0 且无 proj/" "rc=$rc proj=$([ -e "$D/proj" ] && echo 有 || echo 无)"

echo "--- sync-from-cc-base：行为（假 cc-base 夹具）"
FC=$(mktemp -d); TMPS="$TMPS $FC"
mkdir -p "$FC/.claude/agents" "$FC/.claude/scripts"
echo "# fake cc-base" >"$FC/.claude/CLAUDE.md"
printf -- '---\nname: one\ndescription: d1\ndisallowedTools: Bash, Task\n---\n\n正文一行\n' >"$FC/.claude/agents/one.md"
cat >"$FC/.claude/settings.json" <<'JSON'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/demo.mjs"]
          }
        ]
      }
    ]
  }
}
JSON
{ echo '# fake cc-base .gitignore'; echo; awk '/^# === Antigravity 适配层 ===/ { exit } /^\/\*$/ { on = 1 } on' "$R/.gitignore"; } >"$FC/.gitignore"
echo "fake readme" >"$FC/README.md"
git -C "$FC" init -q && git -C "$FC" add -A -f && git -C "$FC" -c user.name=t -c user.email=t@t commit -q -m init
fc_ok=$?
chk "$fc_ok" "假 cc-base 夹具建好并提交" "rc=0" "rc=$fc_ok"

if [ "$fc_ok" -eq 0 ]; then
    T1=$(mktemp -d); TMPS="$TMPS $T1"; cp -a "$R/." "$T1/"
    sed -i 's|^!/setup.sh$|!/setup.shx|' "$T1/.gitignore"
    before=$(tsum "$T1")
    "$T1/sync-from-cc-base.sh" "$FC" >/dev/null 2>&1; rc=$?
    after=$(tsum "$T1")
    chk "$([ "$rc" -eq 1 ] && [ "$before" = "$after" ] && echo 0 || echo 1)" ".gitignore 白名单改一字后 sync 退 1 且一个文件没动" "rc=1 且校验和不变" "rc=$rc"

    T2=$(mktemp -d); TMPS="$TMPS $T2"; cp -a "$R/." "$T2/"
    old_has=$(grep -cxF 'setup.sh' "$T2/.agents/cc-base-files.txt")
    "$T2/sync-from-cc-base.sh" "$FC" >"$W/s2.out" 2>&1; rc=$?
    chk "$([ "$rc" -eq 0 ] && [ "$old_has" = "1" ] && [ ! -e "$T2/setup.sh" ] && cmp -s "$T2/README.md" "$R/README.md" && [ -f "$T2/.agents/agents/one.md" ] && echo 0 || echo 1)" "干净假 cc-base 同步：退 0、删旧 setup.sh、保留自有 README.md、生成 one.md" "全满足" "rc=$rc old_has=$old_has setup=$([ -e "$T2/setup.sh" ] && echo 在 || echo 删) one=$([ -f "$T2/.agents/agents/one.md" ] && echo 在 || echo 无)"

    echo "untracked" >"$FC/.claude/untracked.md"
    echo "未提交的改动" >>"$FC/.claude/agents/one.md"
    T3=$(mktemp -d); TMPS="$TMPS $T3"; cp -a "$R/." "$T3/"
    before=$(tsum "$T3")
    "$T3/sync-from-cc-base.sh" "$FC" >/dev/null 2>&1; rc=$?
    after=$(tsum "$T3")
    chk "$([ "$rc" -eq 1 ] && [ "$before" = "$after" ] && echo 0 || echo 1)" "假 cc-base 脏且无 --allow-dirty：退 1 且目标不动" "rc=1 且未动" "rc=$rc"

    T4=$(mktemp -d); TMPS="$TMPS $T4"; cp -a "$R/." "$T4/"
    "$T4/sync-from-cc-base.sh" --allow-dirty "$FC" >/dev/null 2>&1; rc=$?
    git -C "$FC" show HEAD:.claude/agents/one.md >"$W/one.head"
    chk "$([ "$rc" -eq 0 ] && [ ! -e "$T4/.claude/untracked.md" ] && cmp -s "$T4/.claude/agents/one.md" "$W/one.head" && echo 0 || echo 1)" "--allow-dirty 只取 HEAD，不拷未跟踪与未提交改动" "rc=0 且等于 HEAD" "rc=$rc"
fi

echo "--- sync-from-cc-base：幂等（真 cc-base，在本仓副本里跑）"
CC=${CC_BASE_DIR:-$ROOT/../cc-base}
if [ ! -f "$CC/.claude/CLAUDE.md" ] || [ ! -e "$CC/.git" ]; then
    SKIP=$((SKIP + 1)); echo "  [SKIP] sync 幂等：没有 cc-base 仓（$CC）。未执行 != 通过"
else
    OPT=""
    [ -n "$(git -C "$CC" status --porcelain)" ] && OPT="--allow-dirty" && echo "  (cc-base 工作树不干净，用 --allow-dirty)"
    T5=$(mktemp -d); TMPS="$TMPS $T5"; cp -a "$R/." "$T5/"
    # shellcheck disable=SC2086
    "$T5/sync-from-cc-base.sh" $OPT "$CC" >/dev/null 2>&1; rc1=$?
    s1=$(git -C "$T5" status --short | LC_ALL=C sort | cksum); cp "$T5/.agents/cc-base-version.txt" "$W/v1"
    # shellcheck disable=SC2086
    "$T5/sync-from-cc-base.sh" $OPT "$CC" >/dev/null 2>&1; rc2=$?
    s2=$(git -C "$T5" status --short | LC_ALL=C sort | cksum)
    chk "$((rc1 + rc2))" "两次 sync 都退 0" "rc=0 / rc=0" "rc=$rc1 / rc=$rc2"
    chk "$([ "$s1" = "$s2" ] && cmp -s "$W/v1" "$T5/.agents/cc-base-version.txt" && echo 0 || echo 1)" "两次 sync 幂等（git status 与 cc-base-version.txt 逐字节一致）" "相同" "$s1 / $s2"
fi

echo "--- 本仓只读"
STATUS1=$(git -C "$ROOT" status --short | LC_ALL=C sort | cksum)
chk "$([ "$STATUS0" = "$STATUS1" ] && echo 0 || echo 1)" "测试跑完后本仓 git status --short 与开场相同" "两次 cksum 相同" "$STATUS0 / $STATUS1"

echo "===== test-adapter：PASS=$PASS FAIL=$FAIL SKIP=$SKIP ====="
[ "$SKIP" -gt 0 ] && echo "注意：有 $SKIP 项 SKIP，未执行 != 通过。" >&2
[ "$FAIL" -eq 0 ]
