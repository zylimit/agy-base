#!/usr/bin/env bash
# setup-agy.sh — 把 cc-base 框架 + Antigravity 适配层装到 target 项目（Mac/Linux）。
# 用法：./setup-agy.sh <目标目录> [setup.sh 的其它参数]
# 流程：先跑本仓的 setup.sh <目标目录> <其它参数>（cc-base 原件的安装器，自动沿用目标已有的 hook 形态，
#   兼容 Claude Code 与 Cursor 共存），退出码非 0 原样退出；再把 .agents/agents/、.agents/scripts/、
#   .agents/rules/、.agents/skills.json、.agents/hooks.json、.agents/agents-models.json（有才拷）与
#   GEMINI.md 铺进目标。
# --dry-run 原样透传给 setup.sh，本脚本自己也不写任何文件，只打印会做什么。
# 取舍：.agents/agents/、.agents/scripts/、.agents/rules/ 是生成物与适配脚本，随装随覆盖；
#   skills.json、hooks.json、agents-models.json、GEMINI.md 是目标可能手改过的配置，已有且内容不同就
#   不覆盖，新版本落 <文件>.framework-new 供手工合并（同 setup.sh 的惯例）。
#   .agents/agents/ 另外会清掉目标里「带生成注释、源名等于自己文件名且本仓已无同名」的残留，手写与
#   复制改名定制的 agent 不动。.agents/tests/ 与 cc-base-*.txt 是本仓自己的，不装进目标。
set -u

die() {
  printf 'setup-agy: %s\n' "$1" >&2
  exit 1
}

usage_die() {
  printf 'setup-agy: %s\n' "$1" >&2
  printf '用法：setup-agy.sh <目标目录> [setup.sh 的其它参数，如 --dry-run --with-tests --with-harness]\n' >&2
  exit 2
}

[ $# -ge 1 ] || usage_die "缺目标目录"
case "$1" in
  -*) usage_die "第一个参数必须是目标目录，收到选项：$1" ;;
esac
target=$1
shift

HERE=$(cd "$(dirname "$0")" && pwd) || die "取不到脚本所在目录"
[ -x "$HERE/setup.sh" ] || die "$HERE/setup.sh 不存在或不可执行（先跑 sync-from-cc-base.sh 把 cc-base 原件同步进来）"

DRY_RUN=0
for a in "$@"; do
  [ "$a" = "--dry-run" ] && DRY_RUN=1
done

"$HERE/setup.sh" "$target" "$@"
rc=$?
[ "$rc" -eq 0 ] || exit "$rc"

for need in .agents/agents .agents/scripts .agents/rules .agents/skills.json .agents/hooks.json GEMINI.md; do
  [ -e "$HERE/$need" ] || die "本仓缺 $need，适配层不完整"
done

# put_config <相对路径>：目标没有就拷；有且相同跳过；有且不同落 .framework-new，不覆盖
put_config() {
  local rel=$1 src="$HERE/$1" dest="$target/$1"
  if [ ! -e "$dest" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      printf 'setup-agy: dry-run create %s\n' "$rel"
    else
      mkdir -p "$(dirname "$dest")" || die "无法创建 $(dirname "$dest")"
      cp -p "$src" "$dest" || die "无法写入 $dest"
      printf 'setup-agy: create %s\n' "$rel"
    fi
  elif cmp -s "$src" "$dest"; then
    printf 'setup-agy: skip %s（内容相同）\n' "$rel"
  else
    if [ "$DRY_RUN" = "1" ]; then
      printf 'setup-agy: dry-run conflict %s（真装会落 %s.framework-new）\n' "$rel" "$rel"
    else
      cp -p "$src" "$dest.framework-new" || die "无法写入 $dest.framework-new"
      printf 'setup-agy: 目标已有 %s 且内容不同，未覆盖；新版本在 %s.framework-new，手工合并\n' "$rel" "$rel" >&2
    fi
  fi
}

# put_tree <相对目录>：整目录覆盖式铺进目标
put_tree() {
  local rel=$1
  if [ "$DRY_RUN" = "1" ]; then
    printf 'setup-agy: dry-run update %s/\n' "$rel"
  else
    mkdir -p "$target/$rel" || die "无法创建 $target/$rel"
    cp -pR "$HERE/$rel/." "$target/$rel/" || die "无法铺 $target/$rel"
    printf 'setup-agy: update %s/\n' "$rel"
  fi
}

# prune_agents：目标 .agents/agents/ 里带生成注释、源名等于自己文件名且本仓已无同名生成物的删掉；手写与复制改名的不动
prune_agents() {
  local f base src
  for f in "$target"/.agents/agents/*.md; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    [ -e "$HERE/.agents/agents/$base" ] && continue
    src=$(sed -n 's/.*由 \.agents\/scripts\/gen-agents\.mjs 从 \.claude\/agents\/\(.*\)\.md 生成.*/\1/p' "$f" | head -n 1)
    [ "$src" = "${base%.md}" ] || continue
    if [ "$DRY_RUN" = "1" ]; then
      printf 'setup-agy: dry-run remove .agents/agents/%s（源头已删的生成物）\n' "$base"
    else
      rm -f -- "$f" || die "无法删除 $f"
      printf 'setup-agy: remove .agents/agents/%s（源头已删的生成物）\n' "$base"
    fi
  done
}

put_tree .agents/agents
prune_agents
put_tree .agents/scripts
put_tree .agents/rules
put_config .agents/skills.json
put_config .agents/hooks.json
[ -f "$HERE/.agents/agents-models.json" ] && put_config .agents/agents-models.json
put_config GEMINI.md

if [ "$DRY_RUN" = "1" ]; then
  printf 'setup-agy: dry-run 结束，%s 一个字节都没动\n' "$target"
else
  printf 'setup-agy: 装完在目标里启动 agy，应自动内联 CLAUDE.md、加载 cc-base 技能与子代理并看到核心铁律注入\n'
fi
