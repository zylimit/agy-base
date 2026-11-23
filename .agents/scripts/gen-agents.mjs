#!/usr/bin/env node
// gen-agents.mjs — 从 .claude/agents/*.md 生成 .agents/agents/<同名>.md（Antigravity 自定义子代理）。
// 用法：node .agents/scripts/gen-agents.mjs        从哪里跑都行，项目根取 $CLAUDE_PROJECT_DIR，没有就按脚本位置推。
//   没有 .claude/agents/ 时退 1。覆盖写、幂等：同样的输入两次产出逐字节相同。
//
// 由来（2026-11-24 本机 agy CLI 实测）：
//   1. Antigravity 从 .agents/agents/<name>.md 发现自定义子代理，不读 .claude/agents/。
//   2. 缺省 tools: 为空时子代理只有只读工具（read_file/send_message/search_web 等），拿不到 write_file/run_command；
//      且 tools: 必须写 Antigravity 规范内部名（view_file / write_to_file / replace_file_content / run_command），
//      写错工具名会导致子代理启动报 tool not found 或挂起。
//   3. disallowedTools 含 Bash 的角色（progress-recorder / feedback-observer / domain-recorder）直接从 tools:
//      拿掉 run_command，由运行时硬禁；所有生成子代理都不给 invoke_subagent，硬禁二次嵌套。
//   4. cc-base 的 model: sonnet / opus 在 Antigravity 里不合法，默认一律 model: inherit 跟主 Agent 走；
//      要钉某个角色的模型写 .agents/agents-models.json（形如 {"code-reviewer":"pro"}，支持 inherit/flash/pro）。
//   5. skills: 与 memory: 写进正文开头（Antigravity 不会按 cc-base 形态预载 .claude/skills/<name>/SKILL.md）。
//   6. 失源清理：生成前只删「带本脚本生成注释、且注释里的源名等于本文件名、但 .claude/agents/ 里已无同名源」的
//      生成物；没带注释的手写文件、复制生成物改名定制的文件（注释里源名不是自己）不动。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.CLAUDE_PROJECT_DIR
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, '.claude', 'agents');
const DST = path.join(ROOT, '.agents', 'agents');
const MODELS = path.join(ROOT, '.agents', 'agents-models.json');

function die(msg) {
  process.stderr.write(`gen-agents: ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(SRC) || !fs.statSync(SRC).isDirectory()) {
  die(`没有 ${SRC}——先跑 sync-from-cc-base.sh，或确认在 cc-base 原件所在的项目里`);
}

let pinned = {};
if (fs.existsSync(MODELS)) {
  try {
    pinned = JSON.parse(fs.readFileSync(MODELS, 'utf8'));
  } catch (e) {
    die(`${MODELS} 不是合法 JSON：${e.message}`);
  }
  if (!pinned || typeof pinned !== 'object' || Array.isArray(pinned)) {
    die(`${MODELS} 顶层必须是对象，形如 {"code-reviewer":"pro"}`);
  }
}

// 拆 frontmatter：返回 { fm: {key: value}, body }。不以 --- 开头或没有收尾 --- 返回 null。
function parse(file, text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const fm = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) {
      process.stderr.write(`gen-agents: ${file} frontmatter 里认不出的行，已丢弃：${line}\n`);
      continue;
    }
    fm[m[1]] = m[2].trim();
  }
  return { fm, body: lines.slice(end + 1).join('\n') };
}

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.md')).sort();
if (files.length === 0) die(`${SRC} 下没有 .md`);

fs.mkdirSync(DST, { recursive: true });
const MARK = '由 .agents/scripts/gen-agents.mjs';
const MARK_RE = MARK.replace(/\./g, '\\.');
for (const g of fs.readdirSync(DST).filter((x) => x.endsWith('.md')).sort()) {
  if (files.includes(g)) continue;
  const m = new RegExp(`${MARK_RE} 从 \\.claude/agents/(.+?)\\.md 生成`).exec(fs.readFileSync(path.join(DST, g), 'utf8'));
  if (!m || m[1] !== g.replace(/\.md$/, '')) continue;
  fs.rmSync(path.join(DST, g));
  process.stdout.write(`gen-agents: 源头已删，清掉生成物 ${path.relative(ROOT, path.join(DST, g))}\n`);
}

let bad = 0;
for (const f of files) {
  const p = parse(f, fs.readFileSync(path.join(SRC, f), 'utf8'));
  if (!p || !p.fm.name || !p.fm.description) {
    process.stderr.write(`gen-agents: ${f} 认不出 frontmatter（要有 --- 包着的 name 与 description），跳过\n`);
    bad++;
    continue;
  }
  const { fm, body } = p;
  const name = fm.name;
  const model = typeof pinned[name] === 'string' && pinned[name] ? pinned[name] : 'inherit';

  const disallowed = fm.disallowedTools
    ? fm.disallowedTools.split(',').map((x) => x.trim()).filter(Boolean)
    : [];
  const disallowedSet = new Set(disallowed);

  // Antigravity 规范内部工具名（2026-11-24 agy CLI 实测）：
  //   view_file -> read_file；write_to_file -> write_file；replace_file_content -> edit_file；
  //   run_command -> run_command + manage_task。不给 start_subagent/invoke_subagent，硬禁嵌套。
  const tools = ['view_file', 'write_to_file', 'replace_file_content'];
  if (!disallowedSet.has('Bash')) tools.push('run_command');

  const pre = [];
  if (fm.skills) {
    const paths = fm.skills.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => `\`.claude/skills/${s}/SKILL.md\``).join('、');
    pre.push(`开工前先完整读 ${paths}（Antigravity 不会像 Claude Code 那样把 cc-base 的 skills: 预载给子代理），再按下文行事。`);
  }
  if (disallowed.length) {
    let noSub = false;
    for (const t of disallowed) {
      if (t === 'Task' || t === 'Agent') {
        if (!noSub) pre.push('不要再派子代理。');
        noSub = true;
      } else {
        pre.push(t === 'Bash' ? '不要用 run_command（Bash）工具。' : `不要用 ${t} 工具。`);
      }
    }
  }
  if (fm.memory === 'project') {
    pre.push(`你的持久记忆在 \`.claude/agent-memory/${name}/MEMORY.md\`，先读它，改动也写回那里。`);
  }

  const desc = /:\s/.test(fm.description) || /^["'[\]{}&*!|>%@`#?-]/.test(fm.description)
    ? JSON.stringify(fm.description)
    : fm.description;

  const out = [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    'subagent: true',
    'mainAgent: false',
    `model: ${model}`,
    'tools:',
    ...tools.map((t) => `  - ${t}`),
    '---',
    '',
    `<!-- ${MARK} 从 .claude/agents/${f} 生成，别手改；要钉模型写 .agents/agents-models.json -->`,
    '',
    ...(pre.length ? [pre.join('\n'), ''] : []),
    body.replace(/^\n+/, ''),
  ].join('\n');
  fs.writeFileSync(path.join(DST, f), out.endsWith('\n') ? out : `${out}\n`);
}

if (bad > 0) die(`${bad} 个 agent 文件认不出，其余已生成`);
process.stdout.write(`gen-agents: 生成 ${files.length} 个到 ${path.relative(ROOT, DST)}/\n`);
