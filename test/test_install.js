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

test('mergeHook: 空 settings 也能建出正确结构', function () {
  const out = inst.mergeHook({}, 'MessageDisplay', 'node "a.js"');
  assert.deepEqual(out.hooks.MessageDisplay, [
    { hooks: [{ type: 'command', command: 'node "a.js"', timeout: 10 }] },
  ]);
});

test('★ mergeHook 幂等：同样的 command 加两次只留一条', function () {
  const once = inst.mergeHook({}, 'MessageDisplay', 'node "a.js"');
  const twice = inst.mergeHook(once, 'MessageDisplay', 'node "a.js"');
  assert.equal(twice.hooks.MessageDisplay.length, 1);
});

test('mergeHook: 不动别人的键（statusLine/env/permissions 等）', function () {
  const src = { env: { A: '1' }, statusLine: { type: 'command', command: 'x' } };
  const out = inst.mergeHook(src, 'MessageDisplay', 'node "a.js"');
  assert.deepEqual(out.env, { A: '1' });
  assert.deepEqual(out.statusLine, { type: 'command', command: 'x' });
});

test('mergeHook: 不修改入参（纯函数）', function () {
  const src = {};
  inst.mergeHook(src, 'MessageDisplay', 'node "a.js"');
  assert.deepEqual(src, {});
});

test('removeEvent: 摘掉 Stop，其它事件保留', function () {
  const src = { hooks: { Stop: [{ hooks: [] }], MessageDisplay: [{ hooks: [] }] } };
  const out = inst.removeEvent(src, 'Stop');
  assert.equal(out.hooks.Stop, undefined);
  assert.ok(Array.isArray(out.hooks.MessageDisplay));
});

test('hookCommand: 反斜杠转正斜杠且带引号', function () {
  const cmd = inst.hookCommand('C:\\Users\\x\\.claude\\handover');
  assert.equal(cmd, 'node "C:/Users/x/.claude/handover/ctx_msgdisplay_hook.js"');
});
