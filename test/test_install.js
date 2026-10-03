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

test('★ buildReport: 全新机器 ⇒ 未装 + 明说 settings.json 必须新建', function () {
  const rep = inst.buildReport(inst.resolvePaths(tmpHome()));
  assert.deepEqual(rep.items.map(function (i) { return i.name; }),
    ['node', 'claudeDir', 'settings.json', 'hook', 'runtime', 'state']);
  const sj = rep.items.find(function (i) { return i.name === 'settings.json'; });
  assert.equal(sj.ok, false);
  assert.match(sj.advice, /新建/);
  const rt = rep.items.find(function (i) { return i.name === 'runtime'; });
  assert.equal(rt.ok, false);
});

test('buildReport: 不写任何东西（只读）', function () {
  const p = inst.resolvePaths(tmpHome());
  inst.buildReport(p);
  assert.equal(fs.existsSync(p.claudeDir), false);
});

test('★ buildReport: 运行时副本陈旧 ⇒ runtime.ok=false 且报出两个版本', function () {
  const home = tmpHome();
  const p = inst.resolvePaths(home);
  fs.mkdirSync(p.handoverDir, { recursive: true });
  for (const f of ['ctx_core.js', 'ctx_msgdisplay_hook.js']) {
    fs.writeFileSync(path.join(p.handoverDir, f), 'module.exports={VERSION:"v-old"};', 'utf8');
  }
  const rep = inst.buildReport(p);
  const rt = rep.items.find(function (i) { return i.name === 'runtime'; });
  assert.equal(rt.ok, false);
  assert.match(rt.detail, /v-old/);
});

test('★ apply: 全新机器 ⇒ 拷脚本 + 建 settings.json + marker=installed_unverified', function () {
  const p = inst.resolvePaths(tmpHome());
  inst.apply(p);
  assert.ok(fs.existsSync(path.join(p.handoverDir, 'ctx_core.js')));
  assert.ok(fs.existsSync(path.join(p.handoverDir, 'ctx_msgdisplay_hook.js')));
  assert.ok(fs.existsSync(path.join(p.handoverDir, 'ctx_config.json')));
  const s = JSON.parse(fs.readFileSync(p.settingsPath, 'utf8'));
  assert.equal(s.hooks.MessageDisplay.length, 1);
  assert.equal(inst.readState(p.statePath), 'installed_unverified');
});

test('★ apply 幂等：连跑两次 ⇒ settings.json 里仍只有 1 条', function () {
  const p = inst.resolvePaths(tmpHome());
  inst.apply(p);
  inst.apply(p);
  const s = JSON.parse(fs.readFileSync(p.settingsPath, 'utf8'));
  assert.equal(s.hooks.MessageDisplay.length, 1);
});

test('★ apply: 不覆盖已有的 ctx_config.json（本机调过的窗口值要保住）', function () {
  const p = inst.resolvePaths(tmpHome());
  fs.mkdirSync(p.handoverDir, { recursive: true });
  fs.writeFileSync(path.join(p.handoverDir, 'ctx_config.json'), '{"context_window": 777}', 'utf8');
  inst.apply(p);
  assert.match(fs.readFileSync(path.join(p.handoverDir, 'ctx_config.json'), 'utf8'), /777/);
});

test('apply: 保住 settings.json 里原有的其它键', function () {
  const p = inst.resolvePaths(tmpHome());
  fs.mkdirSync(p.claudeDir, { recursive: true });
  fs.writeFileSync(p.settingsPath, JSON.stringify({ env: { K: 'V' } }), 'utf8');
  inst.apply(p);
  const s = JSON.parse(fs.readFileSync(p.settingsPath, 'utf8'));
  assert.deepEqual(s.env, { K: 'V' });
});

test('★ finalize: marker→verified + 删 install.js + 剥 SKILL.md 安装段', function () {
  const p = inst.resolvePaths(tmpHome());
  const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'handover-repo-'));
  fs.mkdirSync(path.join(fakeRepo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(fakeRepo, 'scripts', 'install.js'), 'x', 'utf8');
  fs.writeFileSync(path.join(fakeRepo, 'SKILL.md'),
    '前\n<!-- INSTALL:BEGIN -->\n中间\n<!-- INSTALL:END -->\n后\n', 'utf8');

  inst.finalize(p, fakeRepo);

  assert.equal(inst.readState(p.statePath), 'verified');
  assert.equal(fs.existsSync(path.join(fakeRepo, 'scripts', 'install.js')), false);
  const md = fs.readFileSync(path.join(fakeRepo, 'SKILL.md'), 'utf8');
  assert.equal(md, '前\n\n后\n');
});

test('stripInstallSection: 没有标记 ⇒ 原样返回', function () {
  assert.equal(inst.stripInstallSection('abc\n'), 'abc\n');
});
