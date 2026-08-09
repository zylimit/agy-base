/**
 * Native Hook Handlers for Antigravity (AGY) Lifecycle Hooks
 * Reads JSON stdin, outputs JSON stdout per Antigravity hook contracts.
 */
const fs = require('fs');
const path = require('path');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

async function handlePreToolCheck() {
  const input = await readStdin();
  const toolCall = input.toolCall || {};
  const toolName = toolCall.name || '';
  const args = toolCall.args || {};
  const cmd = args.CommandLine || args.command || '';

  // Security Gate: Check for dangerous commands
  if (cmd.includes('rm -rf /') || cmd.includes('DROP DATABASE')) {
    console.log(JSON.stringify({
      decision: 'deny',
      reason: '🚨 Destructive command blocked by Antigravity Security Gate.'
    }));
    return;
  }

  // Allow tool execution
  console.log(JSON.stringify({ decision: 'allow' }));
}

async function handlePostToolCheck() {
  await readStdin();
  // Return empty JSON object per PostToolUse contract
  console.log(JSON.stringify({}));
}

async function handlePreInvocation() {
  await readStdin();
  console.log(JSON.stringify({
    injectSteps: [
      {
        ephemeralMessage: "📌 SiteMaster AGY Harness: Enforce 5-D DFX, Arch Anti-Rot & Verification Before Completion."
      }
    ]
  }));
}

async function handleStopGate() {
  const input = await readStdin();
  // Check if fully idle or tasks complete
  console.log(JSON.stringify({ decision: 'allow' }));
}

const mode = process.argv[2] || 'pre-tool-check';

if (mode === 'pre-tool-check') {
  handlePreToolCheck();
} else if (mode === 'post-tool-check') {
  handlePostToolCheck();
} else if (mode === 'pre-invocation') {
  handlePreInvocation();
} else if (mode === 'stop-gate') {
  handleStopGate();
} else {
  console.log(JSON.stringify({ decision: 'allow' }));
}
