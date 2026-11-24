#!/usr/bin/env node
// hook-adapter.mjs — Antigravity Lifecycle Hooks <-> cc-base .claude/hooks/*.mjs 双向协议适配器。
//
// 职责：不重写任何一条 cc-base 闸门逻辑，只做五件宿主翻译工作：
//   1. 解析项目根（CLAUDE_PROJECT_DIR -> workspacePaths[0] -> ev.cwd -> 脚本位置上溯两级）并注入给子进程；
//   2. Antigravity camelCase payload -> cc-base snake_case payload（含工具名与参数字段映射）；
//   3. 子代理识别：实测 Antigravity 在 PreInvocation / PreToolUse / PostToolUse / Stop 上主 Agent 恒带非空
//      lastUserInput，子代理恒为空串 ""——据此为子代理注入 agent_id（放行 no-direct-code-guard 并记进
//      record-authorship），并在子代理的 Stop / PreInvocation 上直接放行；
//   4. 补齐 Antigravity 缺少的仓库级权限红线：read_file / write_file / edit_file 拦密钥与凭据路径（对齐
//      cc-base settings.json permissions.deny），run_command 对 gh release / npm publish / docker push
//      返回 force_ask（对齐 permissions.ask）；
//   5. cc-base 输出（exit 2 + stderr / additionalContext / decision:block）-> Antigravity JSON 契约
//      （decision:allow|deny|force_ask / injectSteps / decision:continue）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isatty } from 'node:tty';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STDIN_WAIT_MAX_MS = 3000;
const STDIN_RETRY_MS = 5;
const PROMPT_CACHE_TTL_MS = 24 * 3600 * 1000;
const PROMPT_CACHE_MAX = 50;
const STOP_MAX_EXECUTIONS = 3;

function toPosix(p) {
  return String(p || '').replace(/\\/g, '/');
}

function readStdinRaw() {
  if (isatty(0)) return '';
  const chunks = [];
  const buf = Buffer.alloc(64 * 1024);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let waited = 0;
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      const again = e && (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK');
      if (again && waited < STDIN_WAIT_MAX_MS) {
        Atomics.wait(sleeper, 0, 0, STDIN_RETRY_MS);
        waited += STDIN_RETRY_MS;
        continue;
      }
      break;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function readStdinJson() {
  const raw = readStdinRaw();
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (_e) {
    return {};
  }
}

function emit(obj) {
  fs.writeSync(1, JSON.stringify(obj) + '\n');
}

function say(text) {
  fs.writeSync(2, String(text) + '\n');
}

function resolveProjectRoot(ev) {
  const candidates = [
    process.env.CLAUDE_PROJECT_DIR,
    Array.isArray(ev.workspacePaths) ? ev.workspacePaths[0] : '',
    ev.cwd,
    path.resolve(SCRIPT_DIR, '..', '..'),
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && fs.existsSync(c)) {
      return path.resolve(c);
    }
  }
  return path.resolve(SCRIPT_DIR, '..', '..');
}

function isSubagentEvent(ev) {
  return !(typeof ev.lastUserInput === 'string' && ev.lastUserInput.trim() !== '');
}

function parseJsonLines(stdout) {
  const out = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object') out.push(v);
    } catch (_e) { /* 非 JSON 行忽略 */ }
  }
  return out;
}

function extractContext(objs) {
  const msgs = [];
  for (const o of objs) {
    if (o.hookSpecificOutput && typeof o.hookSpecificOutput.additionalContext === 'string' && o.hookSpecificOutput.additionalContext.trim()) {
      msgs.push(o.hookSpecificOutput.additionalContext.trim());
    } else if (typeof o.additionalContext === 'string' && o.additionalContext.trim()) {
      msgs.push(o.additionalContext.trim());
    }
  }
  return msgs;
}

function runClaudeHook(root, hookName, payload, timeoutMs = 10000) {
  const hookFile = path.join(root, '.claude', 'hooks', `${hookName}.mjs`);
  if (!fs.existsSync(hookFile)) {
    say(`[agy-hook-adapter] 缺少 .claude/hooks/${hookName}.mjs，跳过`);
    return { missing: true, status: 0, stdout: '', stderr: '', json: [] };
  }
  const r = spawnSync(process.execPath, [hookFile], {
    shell: false,
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  const status = (r.status === null || r.status === undefined) ? -1 : r.status;
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  return { missing: false, status, stdout, stderr, error: r.error || null, json: parseJsonLines(stdout) };
}

function cleanReason(primary, fallback) {
  const s = String(primary || '').trim();
  return s || fallback;
}

// 密钥/凭据文件判定（对齐 cc-base settings.json permissions.deny 与 cursor-base cli.json）
function normalizeForSecretCheck(rawPath, root) {
  const posix = toPosix(String(rawPath || '').trim());
  if (!posix) return '';
  const rootPosix = toPosix(path.resolve(root)).replace(/\/+$/, '');
  if (posix.startsWith(rootPosix + '/')) {
    return posix.slice(rootPosix.length + 1);
  }
  return posix;
}

function isSecretReadPath(rawPath, root) {
  const p = normalizeForSecretCheck(rawPath, root);
  if (!p) return false;
  if (/(^|\/)\.env($|\.(?!example$|sample$|template$|schema$))/i.test(p)) return true;
  if (/(^|\/)secrets\//i.test(p)) return true;
  if (/(^|\/)(id_rsa|id_ed25519)($|\.|_)/i.test(p)) return true;
  if (/(^|\/)\.ssh\//i.test(p)) return true;
  if (/(^|\/)\.aws\/credentials$/i.test(p)) return true;
  if (/(^|\/)credentials\.json$/i.test(p)) return true;
  if (/\.(pem|key)$/i.test(p)) return true;
  return false;
}

function isSecretWritePath(rawPath, root) {
  const p = normalizeForSecretCheck(rawPath, root);
  if (!p) return false;
  if (/(^|\/)\.env($|\.(?!example$|sample$|template$|schema$))/i.test(p)) return true;
  if (/(^|\/)secrets\//i.test(p)) return true;
  if (/(^|\/)\.ssh\//i.test(p)) return true;
  if (/(^|\/)\.aws\/credentials$/i.test(p)) return true;
  if (/\.(pem|key)$/i.test(p)) return true;
  return false;
}

// 对齐 cc-base settings.json permissions.ask（发布类 HIGH 档命令）
const ASK_PUBLISH_RE = /(^|[\s;&|()])(gh\s+release\b|npm\s+publish\b|docker\s+push\b)/;

/**
 * 解析 `git commit` 实际作用的目标仓库根：
 * 当命令显式通过 `git -C <dir> ... commit` 或前置 `cd <dir> && ... git commit` 切到另一座仓库提交时，
 * pre-commit-check / auto-push 必须针对目标仓库执行（若目标仓装了 cc-base），绝不能误跑在当前会话的
 * workspace 根上（2026-11-25 实测：在仓 A 会话内 `cd ../agy-base && git commit` 误触发仓 A 的
 * readable-refresh 改写仓 A 工作树并误拦提交）。
 */
function unquoteShellArg(raw) {
  const s = String(raw || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function expandHome(p) {
  if (p === '~') return process.env.HOME || p;
  if (p.startsWith('~/') && process.env.HOME) return path.join(process.env.HOME, p.slice(2));
  return p;
}

function resolveGitCommitRoot(cmd, defaultRoot) {
  const s = String(cmd || '');
  if (!/\bgit\b[\s\S]*\bcommit\b/.test(s)) return defaultRoot;

  let candidate = '';
  const gitCMatch = /(?:^|[\s;&|()])git\s+-C\s+("[^"]+"|'[^']+'|\S+)[\s\S]*?\bcommit\b/.exec(s);
  if (gitCMatch) {
    candidate = unquoteShellArg(gitCMatch[1]);
  } else {
    const beforeCommit = s.split(/\bgit\b[\s\S]*?\bcommit\b/)[0] || '';
    const cdRe = /(?:^|[\n;&|()])\s*cd\s+("[^"]+"|'[^']+'|[^;&|()\n]+?)\s*(?=$|[\n;&|()])/g;
    let m;
    while ((m = cdRe.exec(beforeCommit)) !== null) {
      candidate = unquoteShellArg(m[1]);
    }
  }

  if (!candidate) return defaultRoot;
  const resolved = path.resolve(defaultRoot, expandHome(candidate));
  if (!fs.existsSync(resolved)) return defaultRoot;

  const top = spawnSync('git', ['-C', resolved, 'rev-parse', '--show-toplevel'], {
    shell: false,
    encoding: 'utf8',
    timeout: 3000,
  });
  if (top.status === 0 && String(top.stdout || '').trim()) {
    return path.resolve(String(top.stdout).trim());
  }
  return resolved;
}

// PreInvocation 去重：同一 conversationId 同一条 lastUserInput 只触发一次 detect-feedback-signal
function shouldRunPromptCheck(root, conversationId, prompt) {
  const cid = String(conversationId || 'default');
  const sig = crypto.createHash('sha256').update(prompt).digest('hex');
  const cacheFile = path.join(root, '.claude', '.runtime', 'agy-last-prompt.json');
  const now = Date.now();
  let cache = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cache = parsed;
  } catch (_e) { /* 首次或坏文件按空处理 */ }

  if (cache[cid] && cache[cid].sig === sig) return false;

  // 清理过期条目，控制文件体积
  const next = {};
  const entries = Object.entries(cache)
    .filter(([, v]) => v && typeof v.ts === 'number' && (now - v.ts) < PROMPT_CACHE_TTL_MS)
    .sort((a, b) => b[1].ts - a[1].ts)
    .slice(0, PROMPT_CACHE_MAX - 1);
  for (const [k, v] of entries) next[k] = v;
  next[cid] = { sig, ts: now };

  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(next) + '\n', 'utf8');
  } catch (_e) { /* fail-open：写缓存失败不阻断 */ }
  return true;
}

function handleSessionStart(root) {
  const hooks = [
    ['check-evolution', 10000],
    ['session-rules-banner', 5000],
    ['recap-on-dirty', 5000],
  ];
  const msgs = [];
  for (const [name, timeout] of hooks) {
    const r = runClaudeHook(root, name, { source: 'startup' }, timeout);
    msgs.push(...extractContext(r.json));
  }
  if (msgs.length) {
    emit({
      injectSteps: [
        { systemMessage: { systemMessage: msgs.join('\n\n') } },
      ],
    });
  } else {
    emit({});
  }
}

function handlePreInvocation(root, ev) {
  if (isSubagentEvent(ev)) {
    emit({});
    return;
  }
  const prompt = String(ev.lastUserInput || '');
  if (!shouldRunPromptCheck(root, ev.conversationId, prompt)) {
    emit({});
    return;
  }
  const r = runClaudeHook(root, 'detect-feedback-signal', { prompt }, 5000);
  const msgs = extractContext(r.json);
  if (msgs.length) {
    emit({
      injectSteps: [
        { systemMessage: { systemMessage: msgs.join('\n\n') } },
      ],
    });
  } else {
    emit({});
  }
}

function handlePreToolUse(root, ev) {
  const tc = (ev.toolCall && typeof ev.toolCall === 'object') ? ev.toolCall : {};
  const toolName = String(tc.name || '');
  const args = (tc.args && typeof tc.args === 'object') ? tc.args : {};
  const subagent = isSubagentEvent(ev);
  const agentFields = subagent ? { agent_id: String(ev.conversationId || 'subagent') } : {};

  if (toolName === 'read_file' || toolName === 'view_file') {
    const filePath = String(args.Path || args.path || args.file_path || args.AbsolutePath || '');
    if (isSecretReadPath(filePath, root)) {
      emit({
        decision: 'deny',
        reason: `⛔ [agy-secret-guard] 密钥/凭据文件禁止读取（对齐 cc-base permissions.deny）：${filePath}`,
      });
      return;
    }
    emit({ decision: 'allow' });
    return;
  }

  if (toolName === 'write_file' || toolName === 'edit_file'
      || toolName === 'write_to_file' || toolName === 'replace_file_content') {
    const filePath = String(args.Path || args.path || args.file_path || args.TargetFile || '');
    if (isSecretWritePath(filePath, root)) {
      emit({
        decision: 'deny',
        reason: `⛔ [agy-secret-guard] 密钥/凭据文件禁止写入（对齐 cc-base 权限红线）：${filePath}`,
      });
      return;
    }
    const payload = {
      tool_name: (toolName === 'write_file' || toolName === 'write_to_file') ? 'Write' : 'Edit',
      tool_input: { file_path: filePath },
      ...agentFields,
    };
    const r = runClaudeHook(root, 'no-direct-code-guard', payload, 5000);
    if (r.status === 2) {
      emit({ decision: 'deny', reason: cleanReason(r.stderr || r.stdout, 'no-direct-code-guard 拦截') });
      return;
    }
    emit({ decision: 'allow' });
    return;
  }

  if (toolName === 'run_command') {
    const cmd = String(args.CommandLine || args.command || '');
    const payload = {
      tool_name: 'Bash',
      tool_input: { command: cmd },
      ...agentFields,
    };
    const commitRoot = resolveGitCommitRoot(cmd, root);
    const bashHooks = [
      ['secret-exfil-guard', root, 5000],
      ['dangerous-pkill-guard', root, 5000],
      ['pre-commit-check', commitRoot, 30000],
      ['kill-dev-ports', root, 10000],
    ];
    for (const [name, targetRoot, timeout] of bashHooks) {
      if (targetRoot !== root && !fs.existsSync(path.join(targetRoot, '.claude', 'hooks', `${name}.mjs`))) {
        continue;
      }
      const r = runClaudeHook(targetRoot, name, payload, timeout);
      const blockedJson = r.json.find((o) => o.decision === 'block');
      if (r.status === 2 || blockedJson) {
        emit({
          decision: 'deny',
          reason: cleanReason((blockedJson && blockedJson.reason) || r.stderr || r.stdout, `${name} 拦截`),
        });
        return;
      }
    }
    if (ASK_PUBLISH_RE.test(cmd)) {
      emit({
        decision: 'force_ask',
        reason: 'HIGH 档发布命令（gh release / npm publish / docker push），对齐 cc-base permissions.ask，须用户显式批准。',
      });
      return;
    }
    emit({ decision: 'allow' });
    return;
  }

  if (toolName === 'invoke_subagent') {
    const payload = {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: String(args.TypeName || args.subagent_type || ''),
        prompt: String(args.Prompt || args.prompt || ''),
        description: String(args.Role || args.description || ''),
      },
    };
    const r = runClaudeHook(root, 'tdd-gate', payload, 5000);
    if (r.status === 2) {
      emit({ decision: 'deny', reason: cleanReason(r.stderr || r.stdout, 'tdd-gate 拦截') });
      return;
    }
    emit({ decision: 'allow' });
    return;
  }

  emit({ decision: 'allow' });
}

function handlePostToolUse(root, ev) {
  const tc = (ev.toolCall && typeof ev.toolCall === 'object') ? ev.toolCall : {};
  const toolName = String(tc.name || '');
  const args = (tc.args && typeof tc.args === 'object') ? tc.args : {};
  const subagent = isSubagentEvent(ev);
  const agentFields = subagent ? { agent_id: String(ev.conversationId || 'subagent') } : {};

  if (toolName === 'run_command') {
    const cmd = String(args.CommandLine || args.command || '');
    const commitRoot = resolveGitCommitRoot(cmd, root);
    if (commitRoot === root || fs.existsSync(path.join(commitRoot, '.claude', 'hooks', 'auto-push.mjs'))) {
      runClaudeHook(commitRoot, 'auto-push', {
        tool_name: 'Bash',
        tool_input: { command: cmd },
        ...agentFields,
      }, 15000);
    }
  } else if (toolName === 'write_file' || toolName === 'edit_file'
      || toolName === 'write_to_file' || toolName === 'replace_file_content') {
    const filePath = String(args.Path || args.path || args.file_path || args.TargetFile || '');
    const payload = {
      tool_name: (toolName === 'write_file' || toolName === 'write_to_file') ? 'Write' : 'Edit',
      tool_input: { file_path: filePath },
      ...agentFields,
    };
    runClaudeHook(root, 'mark-review-needed', payload, 3000);
    runClaudeHook(root, 'record-authorship', payload, 10000);
  }

  emit({});
}

function handleStop(root, ev) {
  // 子代理停止、主 Agent 正在等后台任务/子代理、或因取消/错误/上限退出时一律放行
  if (isSubagentEvent(ev)) {
    emit({ decision: 'allow' });
    return;
  }
  if (ev.fullyIdle === false) {
    emit({ decision: 'allow' });
    return;
  }
  if (ev.terminationReason && ev.terminationReason !== 'NO_TOOL_CALL') {
    emit({ decision: 'allow' });
    return;
  }
  // 防无限续跑硬熔断（实测 agy 下 continuationActive 可能保持 false 而 executionNum 递增）
  if (Number(ev.executionNum || 0) >= STOP_MAX_EXECUTIONS) {
    emit({ decision: 'allow' });
    return;
  }

  const blockReasons = [];
  for (const name of ['stop-gate', 'three-file-sync-gate']) {
    const r = runClaudeHook(root, name, {}, 5000);
    for (const o of r.json) {
      if (o.decision === 'block' && o.reason) {
        blockReasons.push(String(o.reason));
      } else if (o.systemMessage) {
        say(`[agy-stop-advise] ${o.systemMessage}`);
      }
    }
  }

  if (blockReasons.length > 0) {
    emit({ decision: 'continue', reason: blockReasons.join('\n') });
  } else {
    emit({ decision: 'allow' });
  }
}

const ev = readStdinJson();
const mode = process.argv[2] || String(ev.hookEventName || '');
const root = resolveProjectRoot(ev);

switch (mode) {
  case 'SessionStart':
    handleSessionStart(root);
    break;
  case 'PreInvocation':
    handlePreInvocation(root, ev);
    break;
  case 'PreToolUse':
    handlePreToolUse(root, ev);
    break;
  case 'PostToolUse':
    handlePostToolUse(root, ev);
    break;
  case 'Stop':
    handleStop(root, ev);
    break;
  default:
    emit({});
    break;
}
