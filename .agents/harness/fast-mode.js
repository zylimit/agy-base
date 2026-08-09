/**
 * Antigravity Fast Mode Controller
 */
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'fast-mode-state.json');

function setFastMode(status, hours = 24) {
  if (status === 'on') {
    const expireAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    const state = { enabled: true, expireAt, setAt: new Date().toISOString() };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    console.log(`⚡ Fast Mode ENABLED until ${expireAt}`);
  } else {
    const state = { enabled: false };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    console.log('🐢 Fast Mode DISABLED.');
  }
}

function getStatus() {
  if (!fs.existsSync(STATE_FILE)) {
    console.log('🐢 Fast Mode: DISABLED (Default)');
    return;
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (state.enabled) {
    if (new Date(state.expireAt) < new Date()) {
      console.log('⏰ Fast Mode EXPIRED. Falling back to Normal Mode.');
      setFastMode('off');
    } else {
      console.log(`⚡ Fast Mode ACTIVE (Expires at ${state.expireAt})`);
    }
  } else {
    console.log('🐢 Fast Mode: DISABLED');
  }
}

const action = process.argv[2] || 'status';
const param = process.argv[3] || 24;

if (action === 'on' || action === 'off') {
  setFastMode(action, parseInt(param));
} else {
  getStatus();
}
