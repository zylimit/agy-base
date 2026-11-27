// # risk: high
// Independent contract & integration test suite for Antigravity host bridge:
//   - gen-agents.mjs: canonical internal tool names (view_file/write_to_file/replace_file_content/run_command),
//     disallowedTools: Bash drops run_command, zero invoke_subagent across all roles, agents-models.json pinning,
//     frontmatter quote stripping & YAML escaping, orphan pruning vs user copied-renamed/handwritten preservation
//   - hook-adapter.mjs: SessionStart missing link & agent fingerprint drift self-healing + rules/tier injection;
//     PreInvocation dedup cache + /release-builder block warning on dirty .needs-review;
//     PreToolUse .env & private-key read/write guard + no-direct-code-guard (main Agent blocked on relative &
//     absolute src/foo.ts, F-04 /services/ ancestor normalization, subagent allowed when lastUserInput === "");
//     PreToolUse(run_command) dual-shell safety floor (blocks Remove-Item -Recurse -Force / Get-Content .env /
//     -EncodedCommand; allows Test-Path .env & Copy-Item .env.example .env; force_ask on npm publish);
//     F-03 outer untracked parent .git GIT_CEILING_DIRECTORIES isolation;
//     PostToolUse .agents/ exemption from .needs-review;
//     Stop subagent pass-through & executionNum >= 3 hard circuit breaker;
//     doctor.mjs Mode A / Mode B / F-06 smart selfRoot fallback

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runInstall } from '../../scripts/agy-base.mjs';
import { loadCcBaseContract } from '../../scripts/lib/cc-dep.mjs';
import { safeLstat, unlinkSymlinkOrJunctionSafe } from '../../scripts/lib/link-manager.mjs';
import {
  areGeneratedAgentsCurrent,
  computeAgentsFingerprint,
  generateAgents,
} from '../scripts/gen-agents.mjs';
import { normalizeWriteTarget } from '../scripts/hook-adapter.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..', '..');
const SIBLING_CC_BASE = path.resolve(REPO_ROOT, '..', 'cc-base');
const CONTRACT = loadCcBaseContract(REPO_ROOT);

function parseGeneratedAgentFrontmatter(mdText) {
  const lines = mdText.replace(/\r\n/g, '\n').split('\n');
  assert.equal(lines[0], '---', 'Generated agent must start with YAML ---');
  const end = lines.indexOf('---', 1);
  assert.ok(end > 0, 'Generated agent must close YAML ---');
  const fm = {};
  const tools = [];
  let inTools = false;
  for (const line of lines.slice(1, end)) {
    if (inTools) {
      const tm = /^\s*-\s*(\S+)\s*$/.exec(line);
      if (tm) {
        tools.push(tm[1]);
        continue;
      }
      inTools = false;
    }
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, k, vRaw] = kv;
    if (k === 'tools' && vRaw.trim() === '') {
      inTools = true;
    } else {
      fm[k] = vRaw.trim();
    }
  }
  return { fm, tools, body: lines.slice(end + 1).join('\n') };
}

/**
 * Seed a target project with real `.claude/hooks` & `.claude/agents` from sibling `cc-base` when present
 * (falling back to contract-equivalent implementations if run standalone), plus 15 compliant skills.
 */
function seedBridgeProject(targetDir) {
  fs.mkdirSync(path.join(targetDir, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(targetDir, '.claude', 'CLAUDE.md'), '# Project CLAUDE.md\n', 'utf8');
  fs.writeFileSync(path.join(targetDir, '.claude', 'rules', 'core.md'), '# Core Rules\n', 'utf8');

  const minSkills = Number(CONTRACT.skills?.minCount ?? 15);
  for (let i = 1; i <= minSkills; i += 1) {
    const sd = path.join(targetDir, '.claude', 'skills', `skill-${String(i).padStart(2, '0')}`);
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'SKILL.md'), `---\nname: skill-${i}\n---\n# Skill ${i}\n`, 'utf8');
  }

  const sibHooks = path.join(SIBLING_CC_BASE, '.claude', 'hooks');
  const sibAgents = path.join(SIBLING_CC_BASE, '.claude', 'agents');
  if (fs.existsSync(sibHooks) && fs.existsSync(sibAgents)) {
    fs.cpSync(sibHooks, path.join(targetDir, '.claude', 'hooks'), { recursive: true });
    fs.cpSync(sibAgents, path.join(targetDir, '.claude', 'agents'), { recursive: true });
  } else {
    // Standalone fallback implementing exact cc-base hook contracts
    const hooksDir = path.join(targetDir, '.claude', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const h of CONTRACT.hooks.requiredScripts) {
      fs.writeFileSync(path.join(hooksDir, h), '// noop hook\n', 'utf8');
    }
    fs.writeFileSync(
      path.join(hooksDir, 'session-rules-banner.mjs'),
      [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();",
        "let tier = 'standard';",
        "try { tier = JSON.parse(fs.readFileSync(path.join(root, '.claude/harness/profile.json'), 'utf8')).default || 'standard'; } catch {}",
        "const text = `tier: ${tier}（来源 default）\\n🔒 CC框架核心铁律：\\n1. 主 Agent 不亲自编码`;",
        "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }) + '\\n');",
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(hooksDir, 'detect-feedback-signal.mjs'),
      [
        "import fs from 'node:fs';",
        "const ev = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');",
        "if (/不对|你错了|别这样做/.test(String(ev.prompt || ''))) {",
        "  process.stdout.write(JSON.stringify({ additionalContext: '检测到用户修正信号。请派发 feedback-observer。' }) + '\\n');",
        "}",
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(hooksDir, 'no-direct-code-guard.mjs'),
      [
        "import fs from 'node:fs';",
        "const ev = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');",
        "if (ev.agent_id) process.exit(0);",
        "const fp = String(ev.tool_input?.file_path || '').replace(/\\\\/g, '/');",
        "if (/(\\.claude\\/|\\.md$|\\.json$)/.test(fp)) process.exit(0);",
        "if (/(^|\\/(?:src|app|lib|services))\\//.test('/' + fp) && /(^|\\/)(src|app|lib|services)\\//.test(fp)) {",
        "  process.stderr.write('[no-direct-code-guard] blocked: ' + fp + '\\n');",
        "  process.exit(2);",
        "}",
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(hooksDir, 'secret-exfil-guard.mjs'),
      [
        "import fs from 'node:fs';",
        "const ev = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');",
        "const cmd = String(ev.tool_input?.command || '');",
        "// Simulate POSIX-only secret-exfil-guard that blocks unknown verbs mentioning .env!",
        "if (/\\.env\\b/.test(cmd) && !/^\\s*(ls|stat|test|cp\\s+\\.env\\.example)\\b/.test(cmd)) {",
        "  process.stderr.write('POSIX secret-exfil-guard blocked: ' + cmd + '\\n');",
        "  process.exit(2);",
        "}",
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(hooksDir, 'mark-review-needed.mjs'),
      [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();",
        "const ev = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');",
        "const fp = String(ev.tool_input?.file_path || '').replace(/\\\\/g, '/');",
        "if (!fp || /^(tools|\\.claude)\\//.test(fp) || /\\.(md|json|txt)$/.test(fp)) process.exit(0);",
        "const sf = path.join(root, '.claude', '.needs-review');",
        "fs.mkdirSync(path.dirname(sf), { recursive: true });",
        "fs.writeFileSync(sf, fp + '\\n', 'utf8');",
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(hooksDir, 'stop-gate.mjs'),
      [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();",
        "const sf = path.join(root, '.claude', '.needs-review');",
        "if (!fs.existsSync(sf)) process.exit(0);",
        "const lines = fs.readFileSync(sf, 'utf8').split(/\\r?\\n/).map((s)=>s.trim()).filter((s)=>s && s !== 'clean');",
        "if (!lines.length) process.exit(0);",
        "let tier = 'standard';",
        "try { tier = JSON.parse(fs.readFileSync(path.join(root, '.claude/harness/profile.json'), 'utf8')).default || 'standard'; } catch {}",
        "if (tier === 'strict') process.stdout.write(JSON.stringify({ decision: 'block', reason: 'pending review: ' + lines.join(',') }) + '\\n');",
        "else process.stdout.write(JSON.stringify({ systemMessage: '[advise] pending review' }) + '\\n');",
      ].join('\n'),
      'utf8',
    );

    const agentsDir = path.join(targetDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const recorderRoles = new Set(['progress-recorder', 'feedback-observer', 'domain-recorder']);
    for (const role of CONTRACT.agents.requiredRoles) {
      const dis = recorderRoles.has(role) ? 'disallowedTools: Bash, Task\n' : 'disallowedTools: Task\n';
      fs.writeFileSync(
        path.join(agentsDir, `${role}.md`),
        `---\nname: ${role}\ndescription: Role ${role}\nmodel: sonnet\nskills: ${role}\n${dis}---\n\nBody for ${role}.\n`,
        'utf8',
      );
    }
  }

  const inst = runInstall(REPO_ROOT, targetDir, { noAutoCc: false });
  assert.equal(inst.ok, true, inst.error);
}

function invokeHookAdapter(projectRoot, eventName, stdinPayload, extraEnv = {}) {
  const adapterPath = path.join(projectRoot, '.agents', 'scripts', 'hook-adapter.mjs');
  const rawInput = typeof stdinPayload === 'string' ? stdinPayload : JSON.stringify(stdinPayload);
  const r = spawnSync(process.execPath, [adapterPath, eventName], {
    cwd: projectRoot,
    env: { ...process.env, ...extraEnv },
    input: rawInput,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 20000,
  });
  const stdout = String(r.stdout || '').trim();
  const stderr = String(r.stderr || '');
  let json = null;
  if (stdout) {
    const lastLine = stdout.split(/\r?\n/).filter(Boolean).pop() || '';
    json = JSON.parse(lastLine);
  }
  return { status: r.status ?? -1, stdout, stderr, json };
}

function encodePwshUtf16Base64(psCommand) {
  return Buffer.from(psCommand, 'utf16le').toString('base64');
}

describe('Antigravity Bridge Suite (gen-agents.mjs, hook-adapter.mjs & doctor.mjs)', () => {
  let tmpRoot = '';

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-bridge-test-'));
  });

  after(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  describe('1. gen-agents.mjs Subagent Generator & Fingerprint Contract', () => {
    it('maps canonical Antigravity tool names, strips run_command when Bash is disallowed, and never emits invoke_subagent', () => {
      const proj = path.join(tmpRoot, 'gen-agents-canonical');
      seedBridgeProject(proj);

      const res = generateAgents(proj, { quiet: true });
      assert.equal(res.ok, true, res.error);
      assert.ok(res.generated.length >= 8);
      assert.equal(areGeneratedAgentsCurrent(proj).current, true);

      const agentsOutDir = path.join(proj, '.agents', 'agents');
      for (const fileName of res.generated) {
        const raw = fs.readFileSync(path.join(agentsOutDir, fileName), 'utf8');
        const { fm, tools, body } = parseGeneratedAgentFrontmatter(raw);
        assert.equal(fm.subagent, 'true', `${fileName} must have subagent: true`);
        assert.equal(fm.mainAgent, 'false', `${fileName} must have mainAgent: false`);
        assert.equal(fm.model, 'inherit', `${fileName} default model must be inherit`);
        assert.equal(tools.includes('invoke_subagent'), false, `${fileName} MUST NEVER include invoke_subagent`);
        assert.equal(tools.includes('start_subagent'), false, `${fileName} MUST NEVER include start_subagent`);

        if (fileName === 'progress-recorder.md' || fileName === 'feedback-observer.md' || fileName === 'domain-recorder.md') {
          assert.deepEqual(tools, ['view_file', 'write_to_file', 'replace_file_content']);
          assert.match(body, /不要用 run_command（Bash）工具。/);
        } else {
          assert.deepEqual(tools, ['view_file', 'write_to_file', 'replace_file_content', 'run_command']);
        }
      }
    });

    it('supports agents-models.json pinning, quote stripping, YAML escaping, and orphan pruning vs custom preservation', () => {
      const proj = path.join(tmpRoot, 'gen-agents-synthetic');
      const srcAgents = path.join(proj, '.claude', 'agents');
      const dstAgents = path.join(proj, '.agents', 'agents');
      fs.mkdirSync(srcAgents, { recursive: true });
      fs.mkdirSync(dstAgents, { recursive: true });

      // Synthetic roles with double quotes, single quotes with '' escape, colon/hash YAML traps, skills & project memory
      fs.writeFileSync(
        path.join(srcAgents, 'code-reviewer.md'),
        [
          '---',
          'name: "code-reviewer"',
          'description: "Stage 0->2 review: catch P0 bugs #strict"',
          'skills: code-review, red-blue-review',
          'memory: project',
          'model: opus',
          'disallowedTools: Agent',
          '---',
          '',
          'Review body.',
        ].join('\n'),
        'utf8',
      );
      fs.writeFileSync(
        path.join(srcAgents, 'note-keeper.md'),
        [
          '---',
          "name: 'note-keeper'",
          "description: '[Recorder] Team''s note keeper'",
          'disallowedTools: Bash, Task',
          '---',
          '',
          'Recorder body.',
        ].join('\n'),
        'utf8',
      );
      fs.writeFileSync(
        path.join(srcAgents, 'temp-obsolete.md'),
        '---\nname: temp-obsolete\ndescription: Will be deleted\n---\nBody\n',
        'utf8',
      );

      // Pin code-reviewer to "pro" via .agents/agents-models.json
      const modelsPath = path.join(proj, '.agents', 'agents-models.json');
      fs.writeFileSync(modelsPath, JSON.stringify({ 'code-reviewer': 'pro' }) + '\n', 'utf8');

      const r1 = generateAgents(proj, { quiet: true });
      assert.equal(r1.ok, true, r1.error);
      const fp1 = computeAgentsFingerprint(proj);
      assert.ok(fp1?.sha256);

      const crParsed = parseGeneratedAgentFrontmatter(fs.readFileSync(path.join(dstAgents, 'code-reviewer.md'), 'utf8'));
      assert.equal(crParsed.fm.name, 'code-reviewer');
      assert.equal(crParsed.fm.model, 'pro');
      // Description contains ": " and " #", so YAML value must be JSON-quoted without double-wrapping quotes!
      assert.equal(JSON.parse(crParsed.fm.description), 'Stage 0->2 review: catch P0 bugs #strict');
      assert.match(crParsed.body, /\.claude\/skills\/code-review\/SKILL\.md/);
      assert.match(crParsed.body, /\.claude\/agent-memory\/code-reviewer\/MEMORY\.md/);
      assert.match(crParsed.body, /不要再派子代理。/);

      const nkParsed = parseGeneratedAgentFrontmatter(fs.readFileSync(path.join(dstAgents, 'note-keeper.md'), 'utf8'));
      assert.equal(nkParsed.fm.name, 'note-keeper');
      assert.equal(nkParsed.fm.model, 'inherit');
      assert.equal(JSON.parse(nkParsed.fm.description), "[Recorder] Team's note keeper");
      assert.deepEqual(nkParsed.tools, ['view_file', 'write_to_file', 'replace_file_content']);

      // User copies `code-reviewer.md` to `my-copied-reviewer.md` (retains old generated comment referencing code-reviewer.md!)
      // AND creates a hand-written `custom-helper.md` without marker
      fs.copyFileSync(
        path.join(dstAgents, 'code-reviewer.md'),
        path.join(dstAgents, 'my-copied-reviewer.md'),
      );
      fs.writeFileSync(
        path.join(dstAgents, 'custom-helper.md'),
        '---\nname: custom-helper\ndescription: Hand-written\nsubagent: true\nmodel: flash\ntools:\n  - view_file\n---\nCustom\n',
        'utf8',
      );

      // Remove `temp-obsolete.md` from `.claude/agents/` and regenerate
      fs.unlinkSync(path.join(srcAgents, 'temp-obsolete.md'));
      assert.equal(areGeneratedAgentsCurrent(proj).current, false, 'Fingerprint must detect removed upstream agent');

      const r2 = generateAgents(proj, { quiet: true });
      assert.equal(r2.ok, true, r2.error);
      assert.deepEqual(r2.pruned, ['temp-obsolete.md']);
      assert.equal(fs.existsSync(path.join(dstAgents, 'temp-obsolete.md')), false, 'Orphan generated file must be pruned');
      assert.equal(fs.existsSync(path.join(dstAgents, 'my-copied-reviewer.md')), true, 'Copied-and-renamed file must be preserved');
      assert.equal(fs.existsSync(path.join(dstAgents, 'custom-helper.md')), true, 'Hand-written file must be preserved');

      // Invalid JSON in agents-models.json must fail cleanly with code 1
      fs.writeFileSync(modelsPath, '{invalid-json', 'utf8');
      const rBad = generateAgents(proj, { quiet: true });
      assert.equal(rBad.ok, false);
      assert.equal(rBad.code, 1);
    });

    it('[CRITICAL-01 RED-LOCK] detaches .agents/agents -> ../.claude/agents symlink trap in both gen-agents.mjs and SessionStart without mutating .claude/agents/*.md', async () => {
      const { createHash } = await import('node:crypto');
      const proj = path.join(tmpRoot, 'critical-01-agents-symlink-trap');
      seedBridgeProject(proj);

      const srcAgentsDir = path.join(proj, '.claude', 'agents');
      const dstAgentsDir = path.join(proj, '.agents', 'agents');

      const snapshotClaudeAgents = () => {
        const snap = new Map();
        const names = fs.readdirSync(srcAgentsDir).filter((f) => f.endsWith('.md')).sort();
        for (const name of names) {
          const buf = fs.readFileSync(path.join(srcAgentsDir, name));
          snap.set(name, createHash('sha256').update(buf).digest('hex'));
        }
        return snap;
      };

      const assertClaudeAgentsUntouched = (expected, label) => {
        const actual = snapshotClaudeAgents();
        assert.equal(actual.size, expected.size, `Agent count changed (${label})`);
        for (const [name, expSha] of expected.entries()) {
          assert.equal(actual.get(name), expSha, `.claude/agents/${name} SHA-256 mutated (${label})`);
        }
      };

      const plantAgentsSymlinkTrap = () => {
        fs.rmSync(dstAgentsDir, { recursive: true, force: true });
        if (process.platform === 'win32') {
          fs.symlinkSync(srcAgentsDir, dstAgentsDir, 'junction');
        } else {
          fs.symlinkSync('../.claude/agents', dstAgentsDir, 'dir');
        }
        assert.equal(fs.lstatSync(dstAgentsDir).isSymbolicLink(), true, 'Precondition: .agents/agents must be symlink/Junction');
      };

      const initialSnap = snapshotClaudeAgents();
      assert.ok(initialSnap.size >= 8, `Expected >= 8 upstream .claude/agents/*.md files, got ${initialSnap.size}`);

      // 1. Direct gen-agents.mjs execution against `.agents/agents -> ../.claude/agents` trap
      plantAgentsSymlinkTrap();
      assert.equal(areGeneratedAgentsCurrent(proj).current, false, 'areGeneratedAgentsCurrent must reject symlinked .agents/agents');

      const rGen = generateAgents(proj, { quiet: true });
      assert.equal(rGen.ok, true, rGen.error);
      assert.equal(fs.lstatSync(dstAgentsDir).isSymbolicLink(), false, 'gen-agents.mjs must detach .agents/agents symlink');
      assert.equal(fs.lstatSync(dstAgentsDir).isDirectory(), true, '.agents/agents must become a physical directory');
      assertClaudeAgentsUntouched(initialSnap, 'after gen-agents.mjs over symlink trap');

      // 2. SessionStart self-healing against `.agents/agents -> ../.claude/agents` trap (even with matching agents-gen.sha256!)
      plantAgentsSymlinkTrap();
      assert.equal(areGeneratedAgentsCurrent(proj).current, false, 'Fingerprint check must flag symlink trap even when sha256 file matches');

      const rSs = invokeHookAdapter(proj, 'SessionStart', { cwd: proj });
      assert.equal(rSs.status, 0, rSs.stderr);
      assert.equal(fs.lstatSync(dstAgentsDir).isSymbolicLink(), false, 'SessionStart must detach .agents/agents symlink');
      assert.equal(fs.lstatSync(dstAgentsDir).isDirectory(), true, 'SessionStart must recreate physical .agents/agents directory');
      assert.equal(fs.existsSync(path.join(dstAgentsDir, 'implementer.md')), true);
      assertClaudeAgentsUntouched(initialSnap, 'after SessionStart over symlink trap');
    });
  });

  describe('2. hook-adapter.mjs Lifecycle Bridge & Dual-Shell Safety Floor', () => {
    let proj = '';

    before(() => {
      proj = path.join(tmpRoot, 'hook-bridge-proj');
      seedBridgeProject(proj);
      // Initialize own git repo and commit baseline scaffold so working tree starts clean (standard tier, no auto-raise)
      spawnSync('git', ['init', '-q'], { cwd: proj, shell: false, windowsHide: true });
      spawnSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: proj, shell: false, windowsHide: true });
      spawnSync('git', ['config', 'user.name', 'Tester'], { cwd: proj, shell: false, windowsHide: true });
      spawnSync('git', ['add', '-A'], { cwd: proj, shell: false, windowsHide: true });
      spawnSync('git', ['commit', '-qm', 'seed baseline'], { cwd: proj, shell: false, windowsHide: true });
    });

    it('SessionStart: self-heals broken/missing .agents/skills link & drifted subagent fingerprint and injects core rules + tier', () => {
      const skillsLink = path.join(proj, '.agents', 'skills');
      const implAgent = path.join(proj, '.agents', 'agents', 'implementer.md');
      const shaFile = path.join(proj, '.agents', '.runtime', 'agents-gen.sha256');

      // Break skills link and corrupt subagent fingerprint + delete one generated agent
      if (safeLstat(skillsLink)?.isSymbolicLink()) {
        unlinkSymlinkOrJunctionSafe(skillsLink);
      }
      fs.unlinkSync(implAgent);
      fs.writeFileSync(shaFile, '0000000000000000000000000000000000000000000000000000000000000000\n', 'utf8');
      assert.equal(areGeneratedAgentsCurrent(proj).current, false);

      const r = invokeHookAdapter(proj, 'SessionStart', { cwd: proj });
      assert.equal(r.status, 0, r.stderr);

      // Verify millisecond self-healing
      assert.equal(fs.lstatSync(skillsLink).isSymbolicLink(), true);
      assert.equal(fs.existsSync(implAgent), true);
      assert.equal(areGeneratedAgentsCurrent(proj).current, true);

      // Verify injected core rules & tier banner
      const sysMsg = r.json?.injectSteps?.[0]?.systemMessage?.systemMessage || '';
      assert.match(sysMsg, /tier:\s*standard/);
      assert.match(sysMsg, /CC框架核心铁律/);
    });

    it('PreInvocation: deduplicates identical prompts per conversationId and injects /release-builder block when .needs-review is dirty', () => {
      // 1) Feedback signal deduplication
      const r1 = invokeHookAdapter(proj, 'PreInvocation', {
        conversationId: 'conv-alpha',
        lastUserInput: '不对，这里逻辑写错了',
      });
      assert.equal(r1.status, 0);
      const msg1 = r1.json?.injectSteps?.[0]?.systemMessage?.systemMessage || '';
      assert.match(msg1, /修正信号|feedback-observer/);

      // Second call with identical (conversationId, lastUserInput) -> deduped ({})
      const r2 = invokeHookAdapter(proj, 'PreInvocation', {
        conversationId: 'conv-alpha',
        lastUserInput: '不对，这里逻辑写错了',
      });
      assert.deepEqual(r2.json, {});

      // Different conversationId -> fires again
      const r3 = invokeHookAdapter(proj, 'PreInvocation', {
        conversationId: 'conv-beta',
        lastUserInput: '不对，这里逻辑写错了',
      });
      assert.match(r3.json?.injectSteps?.[0]?.systemMessage?.systemMessage || '', /修正信号|feedback-observer/);

      // Subagent PreInvocation (lastUserInput: "") -> immediate {}
      const rSub = invokeHookAdapter(proj, 'PreInvocation', {
        conversationId: 'conv-sub',
        lastUserInput: '',
      });
      assert.deepEqual(rSub.json, {});

      // 2) /release-builder gate compensation when .claude/.needs-review has pending files
      const needsReviewFile = path.join(proj, '.claude', '.needs-review');
      fs.writeFileSync(needsReviewFile, 'src/payment.ts\nsrc/order.ts\n', 'utf8');

      const relBlocked = invokeHookAdapter(proj, 'PreInvocation', {
        conversationId: 'conv-rel',
        lastUserInput: '/release-builder v1.2.0',
      });
      const blockText = relBlocked.json?.injectSteps?.[0]?.systemMessage?.systemMessage || '';
      assert.match(blockText, /⛔ \[agy-release-gate\]/);
      assert.match(blockText, /src\/payment\.ts/);

      // Clearing .needs-review to "clean" switches /release-builder to standard release reminder
      fs.writeFileSync(needsReviewFile, 'clean\n', 'utf8');
      const relClean = invokeHookAdapter(proj, 'PreInvocation', {
        conversationId: 'conv-rel',
        lastUserInput: '/release-builder v1.2.0',
      });
      const cleanText = relClean.json?.injectSteps?.[0]?.systemMessage?.systemMessage || '';
      assert.match(cleanText, /📋 发布前置提醒（agy-release-gate）/);
      fs.rmSync(needsReviewFile, { force: true });
    });

    it('PreToolUse(read/write): blocks .env & private keys; blocks main Agent on relative & absolute src/foo.ts while allowing subagent & F-04 /services/ ancestor', () => {
      // Malformed non-empty stdin -> fail-closed deny
      const badJson = invokeHookAdapter(proj, 'PreToolUse', '{truncated-json');
      assert.equal(badJson.json?.decision, 'deny');

      // Secret read guard
      for (const secretFile of ['.env', '.env.production', 'certs/id_rsa', '.ssh/id_ed25519', 'tls/server.pem', 'tls/app.key', '.aws/credentials', '.credentials.json']) {
        const res = invokeHookAdapter(proj, 'PreToolUse', {
          lastUserInput: 'check config',
          toolCall: { name: 'read_file', args: { Path: path.join(proj, secretFile) } },
        });
        assert.equal(res.json?.decision, 'deny', `Expected read_file deny for ${secretFile}`);
      }
      for (const safeFile of ['.env.example', '.env.sample', '.env.template', 'README.md']) {
        const res = invokeHookAdapter(proj, 'PreToolUse', {
          lastUserInput: 'check sample',
          toolCall: { name: 'view_file', args: { Path: path.join(proj, safeFile) } },
        });
        assert.equal(res.json?.decision, 'allow', `Expected view_file allow for ${safeFile}`);
      }

      // Secret write guard
      for (const secretWrite of ['.env', 'secrets/token.txt', 'certs/private.key']) {
        const res = invokeHookAdapter(proj, 'PreToolUse', {
          lastUserInput: '',
          toolCall: { name: 'write_file', args: { Path: secretWrite } },
        });
        assert.equal(res.json?.decision, 'deny', `Expected write_file deny for ${secretWrite}`);
      }

      // Main Agent (`lastUserInput` non-empty) writing relative `src/foo.ts` AND absolute `<proj>/src/foo.ts` -> DENIED
      const mainRel = invokeHookAdapter(proj, 'PreToolUse', {
        lastUserInput: 'implement feature directly',
        toolCall: { name: 'write_file', args: { Path: 'src/foo.ts' } },
      });
      assert.equal(mainRel.json?.decision, 'deny');

      const mainAbs = invokeHookAdapter(proj, 'PreToolUse', {
        lastUserInput: 'implement feature directly',
        toolCall: { name: 'replace_file_content', args: { TargetFile: path.join(proj, 'src', 'foo.ts') } },
      });
      assert.equal(mainAbs.json?.decision, 'deny');

      // Subagent (`lastUserInput: ""`) writing relative `src/foo.ts` AND absolute `<proj>/src/foo.ts` -> ALLOWED
      const subRel = invokeHookAdapter(proj, 'PreToolUse', {
        conversationId: 'subagent-impl-1',
        lastUserInput: '',
        toolCall: { name: 'write_to_file', args: { TargetFile: 'src/foo.ts' } },
      });
      assert.equal(subRel.json?.decision, 'allow');

      const subAbs = invokeHookAdapter(proj, 'PreToolUse', {
        conversationId: 'subagent-impl-1',
        lastUserInput: '',
        toolCall: { name: 'replace_file_content', args: { TargetFile: path.join(proj, 'src', 'foo.ts') } },
      });
      assert.equal(subAbs.json?.decision, 'allow');

      // Main Agent writing `.agents/` self file -> ALLOWED
      const agySelf = invokeHookAdapter(proj, 'PreToolUse', {
        lastUserInput: 'adjust local config',
        toolCall: { name: 'write_file', args: { Path: path.join(proj, '.agents', 'local', 'helper.ts') } },
      });
      assert.equal(agySelf.json?.decision, 'allow');

      // F-04 end-to-end + unit verification: project located inside an ancestor named `services/`
      // must normalize paths relative to `servicesApp` so `docs/spec.txt` is NOT falsely blocked by `/services/`!
      const servicesApp = path.join(tmpRoot, 'services', 'my-app');
      seedBridgeProject(servicesApp);
      assert.equal(
        normalizeWriteTarget(path.join(servicesApp, 'docs', 'spec.txt'), servicesApp),
        'docs/spec.txt',
      );
      assert.equal(
        normalizeWriteTarget('.\\src\\foo.ts', servicesApp),
        'src/foo.ts',
      );
      const servicesDocRes = invokeHookAdapter(servicesApp, 'PreToolUse', {
        lastUserInput: 'update spec doc',
        toolCall: { name: 'write_file', args: { Path: path.join(servicesApp, 'docs', 'spec.txt') } },
      });
      assert.equal(servicesDocRes.json?.decision, 'allow');
      const servicesSrcRes = invokeHookAdapter(servicesApp, 'PreToolUse', {
        lastUserInput: 'edit src directly',
        toolCall: { name: 'write_file', args: { Path: path.join(servicesApp, 'src', 'foo.ts') } },
      });
      assert.equal(servicesSrcRes.json?.decision, 'deny');
    });

    it('PreToolUse(run_command): blocks Remove-Item -Recurse -Force, Get-Content .env & -EncodedCommand; allows Test-Path .env & Copy-Item .env.example .env; returns force_ask on npm publish', () => {
      const encDanger = `pwsh -EncodedCommand ${encodePwshUtf16Base64('Remove-Item -Recurse -Force C:\\')}`;
      const encSecret = `powershell.exe -NoProfile -ec ${encodePwshUtf16Base64('Get-Content .env')}`;

      const mustDenyCommands = [
        'Remove-Item -Recurse -Force C:\\',
        'Remove-Item -Path ~ -Recurse -Force',
        'rm -rf /',
        'git reset --hard HEAD~1',
        'git clean -fdx',
        'Get-Content .env',
        'cat .env',
        'Test-Path .env; Get-Content .env',
        encDanger,
        encSecret,
      ];
      for (const cmd of mustDenyCommands) {
        const res = invokeHookAdapter(proj, 'PreToolUse', {
          lastUserInput: 'run command',
          toolCall: { name: 'run_command', args: { CommandLine: cmd } },
        });
        assert.equal(res.json?.decision, 'deny', `Expected deny for dangerous/secret command: ${cmd}`);
      }

      // F-05.1: Safe PowerShell .env metadata & sample-copy commands MUST be allowed even with POSIX secret-exfil-guard installed!
      const mustAllowPsEnv = [
        'Test-Path .env',
        'Test-Path -Path .\\.env',
        'Copy-Item .env.example .env',
        'Copy-Item -Path .\\.env.example -Destination .\\.env -Force',
      ];
      for (const cmd of mustAllowPsEnv) {
        const res = invokeHookAdapter(proj, 'PreToolUse', {
          lastUserInput: 'init env',
          toolCall: { name: 'run_command', args: { CommandLine: cmd } },
        });
        assert.equal(res.json?.decision, 'allow', `Expected allow for safe PowerShell .env command: ${cmd} (got ${JSON.stringify(res.json)})`);
      }

      // HIGH-risk publish commands -> force_ask
      for (const pubCmd of ['npm publish', 'gh release create v3.0.0', 'docker push demo/service:1.0']) {
        const res = invokeHookAdapter(proj, 'PreToolUse', {
          lastUserInput: 'publish release',
          toolCall: { name: 'run_command', args: { CommandLine: pubCmd } },
        });
        assert.equal(res.json?.decision, 'force_ask', `Expected force_ask for: ${pubCmd}`);
      }
    });

    it('F-03: isolates untracked child project from outer parent .git via GIT_CEILING_DIRECTORIES and blocks cross-repo git commit', () => {
      const outerRepo = path.join(tmpRoot, 'outer-parent-git');
      const innerApp = path.join(outerRepo, 'untracked-child-app');
      fs.mkdirSync(innerApp, { recursive: true });
      spawnSync('git', ['init', '-q'], { cwd: outerRepo, shell: false, windowsHide: true });
      fs.writeFileSync(path.join(outerRepo, 'outer-dirty.txt'), 'uncommitted parent change\n', 'utf8');

      seedBridgeProject(innerApp);
      // Install a probe in check-evolution.mjs to confirm GIT_CEILING_DIRECTORIES is injected into child hooks
      fs.writeFileSync(
        path.join(innerApp, '.claude', 'hooks', 'check-evolution.mjs'),
        [
          "import { spawnSync } from 'node:child_process';",
          "const g = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', shell: false, windowsHide: true });",
          "const isolated = g.status !== 0;",
          "process.stdout.write(JSON.stringify({ additionalContext: `ceiling_isolated=${isolated}` }) + '\\n');",
        ].join('\n'),
        'utf8',
      );

      const ss = invokeHookAdapter(innerApp, 'SessionStart', { cwd: innerApp });
      assert.equal(ss.status, 0, ss.stderr);
      const sysMsg = ss.json?.injectSteps?.[0]?.systemMessage?.systemMessage || '';
      assert.match(sysMsg, /GIT_CEILING_DIRECTORIES/);
      assert.match(sysMsg, /ceiling_isolated=true/);

      const commitAttempt = invokeHookAdapter(innerApp, 'PreToolUse', {
        lastUserInput: 'commit changes',
        toolCall: { name: 'run_command', args: { CommandLine: 'git commit -m "accidental outer commit"' } },
      });
      assert.equal(commitAttempt.json?.decision, 'deny');
      assert.match(commitAttempt.json?.reason || '', /git-boundary-guard/);
    });

    it('PostToolUse: exempts .agents/ writes from .needs-review while recording business source writes', () => {
      const needsReviewFile = path.join(proj, '.claude', '.needs-review');
      fs.rmSync(needsReviewFile, { force: true });

      // Write inside .agents/ (both relative and absolute) -> must NOT mark .needs-review
      invokeHookAdapter(proj, 'PostToolUse', {
        lastUserInput: '',
        toolCall: { name: 'write_file', args: { Path: '.agents/scripts/custom-tool.js' } },
      });
      invokeHookAdapter(proj, 'PostToolUse', {
        lastUserInput: '',
        toolCall: { name: 'write_to_file', args: { TargetFile: path.join(proj, '.agents', 'local', 'state.ts') } },
      });
      assert.equal(fs.existsSync(needsReviewFile), false, '.agents/ writes must never create .claude/.needs-review');

      // Write business source file `src/order-service.ts` -> MUST mark .needs-review
      invokeHookAdapter(proj, 'PostToolUse', {
        conversationId: 'sub-impl',
        lastUserInput: '',
        toolCall: { name: 'write_to_file', args: { TargetFile: path.join(proj, 'src', 'order-service.ts') } },
      });
      assert.equal(fs.existsSync(needsReviewFile), true);
      assert.match(fs.readFileSync(needsReviewFile, 'utf8'), /src\/order-service\.ts/);
    });

    it('Stop: allows subagent immediately, advises without blocking in standard tier, enforces strict continue when executionNum < 3, and hard-trips circuit breaker at executionNum >= 3', () => {
      const needsReviewFile = path.join(proj, '.claude', '.needs-review');
      const profileFile = path.join(proj, '.claude', 'harness', 'profile.json');
      fs.writeFileSync(needsReviewFile, 'src/unreviewed.ts\n', 'utf8');
      fs.rmSync(path.join(proj, '.claude', '.stop-gate-strikes'), { force: true });
      fs.rmSync(path.join(proj, '.claude', '.stop-gate-advised'), { force: true });
      fs.rmSync(profileFile, { force: true });

      // 0) Standard tier (default): advises on stderr and returns decision: "allow"
      const stdStop = invokeHookAdapter(proj, 'Stop', {
        lastUserInput: 'finish task',
        fullyIdle: true,
        terminationReason: 'NO_TOOL_CALL',
        executionNum: 0,
      });
      assert.equal(stdStop.json?.decision, 'allow');

      // Switch to strict tier via profile.json
      fs.mkdirSync(path.dirname(profileFile), { recursive: true });
      fs.writeFileSync(profileFile, JSON.stringify({ version: 1, default: 'strict' }) + '\n', 'utf8');
      fs.rmSync(path.join(proj, '.claude', '.stop-gate-strikes'), { force: true });

      // 1) Subagent Stop (`lastUserInput: ""`) -> always allow
      const subStop = invokeHookAdapter(proj, 'Stop', {
        lastUserInput: '',
        fullyIdle: true,
        terminationReason: 'NO_TOOL_CALL',
        executionNum: 0,
      });
      assert.equal(subStop.json?.decision, 'allow');

      // 2) Main Agent Stop in strict tier with executionNum = 0 -> decision: "continue"
      const mainStop0 = invokeHookAdapter(proj, 'Stop', {
        lastUserInput: 'finish task',
        fullyIdle: true,
        terminationReason: 'NO_TOOL_CALL',
        executionNum: 0,
      });
      assert.equal(mainStop0.json?.decision, 'continue');
      assert.match(mainStop0.json?.reason || '', /src\/unreviewed\.ts/);

      // 3) Hard circuit breaker at executionNum >= 3 -> decision: "allow"
      const mainStop3 = invokeHookAdapter(proj, 'Stop', {
        lastUserInput: 'finish task',
        fullyIdle: true,
        terminationReason: 'NO_TOOL_CALL',
        executionNum: 3,
      });
      assert.equal(mainStop3.json?.decision, 'allow');

      fs.rmSync(profileFile, { force: true });
      fs.rmSync(needsReviewFile, { force: true });
      fs.rmSync(path.join(proj, '.claude', '.stop-gate-strikes'), { force: true });
    });
  });

  describe('3. doctor.mjs Dual-Mode & F-06 Smart selfRoot Fallback', () => {
    it('passes Mode A (--source-check), Mode B (with no-arg smart selfRoot fallback from os.tmpdir()), and flags illegal subagent tool names', () => {
      // Mode A on source repo
      const srcDoc = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, '.agents', 'scripts', 'doctor.mjs'), '--source-check', '--json', REPO_ROOT],
        { cwd: os.tmpdir(), encoding: 'utf8', shell: false, windowsHide: true },
      );
      assert.equal(srcDoc.status, 0, srcDoc.stderr);
      const srcJson = JSON.parse(srcDoc.stdout.trim());
      assert.equal(srcJson.ok, true);
      assert.equal(srcJson.mode, 'source');

      // Mode B invoked with ZERO positional arguments from os.tmpdir() -> F-06 smart selfRoot fallback!
      const dsProj = path.join(tmpRoot, 'doctor-selfroot-proj');
      seedBridgeProject(dsProj);
      const dsDoctor = path.join(dsProj, '.agents', 'scripts', 'doctor.mjs');
      const fallbackDoc = spawnSync(process.execPath, [dsDoctor, '--json'], {
        cwd: os.tmpdir(),
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      assert.equal(fallbackDoc.status, 0, fallbackDoc.stderr);
      const fbJson = JSON.parse(fallbackDoc.stdout.trim());
      assert.equal(fbJson.ok, true);
      assert.equal(fbJson.mode, 'downstream');

      // Corrupt one generated subagent with non-canonical tool name `read_file` -> doctor MUST exit 1
      fs.writeFileSync(
        path.join(dsProj, '.agents', 'agents', 'bad-tool-agent.md'),
        '---\nname: bad-tool-agent\ndescription: Bad\nsubagent: true\nmodel: inherit\ntools:\n  - read_file\n---\nBody\n',
        'utf8',
      );
      const badDoc = spawnSync(process.execPath, [dsDoctor, dsProj, '--json'], {
        cwd: os.tmpdir(),
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      assert.equal(badDoc.status, 1);
      const badJson = JSON.parse(badDoc.stdout.trim());
      assert.equal(badJson.ok, false);
      assert.ok(badJson.detail.errors.some((e) => e.includes('bad-tool-agent.md') && e.includes('read_file')));
    });
  });
});
