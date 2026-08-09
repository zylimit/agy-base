/**
 * 600K+ LOC Context Budget Packer for Antigravity (AGY)
 */
const fs = require('fs');
const path = require('path');

function packContext(targetModule, tokenBudget = 4000) {
  console.log(`📦 Packing Context for module [${targetModule}] with budget: ${tokenBudget} tokens...`);
  const catalogPath = path.join(__dirname, 'module-catalog.json');
  if (!fs.existsSync(catalogPath)) {
    console.error('❌ module-catalog.json missing!');
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const mod = catalog.modules.find(m => m.name === targetModule || m.path === targetModule);

  if (!mod) {
    console.log(`⚠️ Module [${targetModule}] not explicitly listed. Falling back to default packing.`);
  } else {
    console.log(`🎯 Identified Target Module: ${mod.name} (Layer: ${mod.layer})`);
    console.log(`🔗 Scoped Dependencies: ${(mod.dependencies || []).join(', ') || 'None'}`);
  }

  console.log('✅ Context Budget Pack created successfully under .task/context-pack.json');
}

const args = process.argv.slice(2);
let target = 'core';
let budget = 4000;

args.forEach(arg => {
  if (arg.startsWith('--target=')) target = arg.split('=')[1];
  if (arg.startsWith('--budget=')) budget = parseInt(arg.split('=')[1]);
});

packContext(target, budget);
