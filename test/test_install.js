'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const inst = require('../scripts/install');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'handover-test-'));
}

test('resolvePaths: 以 homeDir 为根展开出各路径', function () {
  const home = tmpHome();
  const p = inst.resolvePaths(home);
  assert.equal(p.handoverDir, path.join(home, '.claude', 'handover'));
  assert.equal(p.settingsPath, path.join(home, '.claude', 'settings.json'));
  assert.equal(p.statePath, path.join(home, '.claude', 'handover', '_handover_state.json'));
});

test('readState: marker 不存在 ⇒ unset', function () {
  const p = inst.resolvePaths(tmpHome());
  assert.equal(inst.readState(p.statePath), 'unset');
});

test('writeState/readState: 往返', function () {
  const p = inst.resolvePaths(tmpHome());
  inst.writeState(p.statePath, 'installed_unverified');
  assert.equal(inst.readState(p.statePath), 'installed_unverified');
});

test('readState: marker 是坏 JSON ⇒ 退回 unset（不抛）', function () {
  const p = inst.resolvePaths(tmpHome());
  fs.mkdirSync(path.dirname(p.statePath), { recursive: true });
  fs.writeFileSync(p.statePath, '{ 坏掉的', 'utf8');
  assert.equal(inst.readState(p.statePath), 'unset');
});
