'use strict';
/**
 * 断点交接 · 安装器 —— check / apply / finalize 三档
 * ★ 只做机械动作（检测 / 合并 JSON / 拷贝 / 写 marker）；判断留给读报告的本机 Claude
 *
 * 设计要点：
 * - 路径全部【显式传参】(resolvePaths(homeDir)) ⇒ 可测、可适配不同机器
 * - 报告结构固定 items[]：{name, ok, detail, err, advice}
 *   哪一步=name · 本机实测值=detail · 原始错误=err · 建议怎么改=advice
 * - settings.json 【不存在时必须新建】—— 已知坑：不存在则一堆脚本静默跳过
 *
 * v1 · 2026-10-03
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE = {
  UNSET: 'unset',
  UNVERIFIED: 'installed_unverified',
  VERIFIED: 'verified',
};

/** 输入 home 目录，展开出所有相关路径（★ 显式传参 ⇒ 可测、可适配不同机器） */
function resolvePaths(homeDir) {
  const home = homeDir || os.homedir();
  const claudeDir = path.join(home, '.claude');
  const handoverDir = path.join(claudeDir, 'handover');
  return {
    home: home,
    claudeDir: claudeDir,
    handoverDir: handoverDir,
    settingsPath: path.join(claudeDir, 'settings.json'),
    statePath: path.join(handoverDir, '_handover_state.json'),
    tracePath: path.join(handoverDir, '_hook_trace_v1.log'),
  };
}

function readState(statePath) {
  try {
    if (!fs.existsSync(statePath)) return STATE.UNSET;
    const o = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const s = o && o.state;
    return (s === STATE.UNVERIFIED || s === STATE.VERIFIED) ? s : STATE.UNSET;
  } catch (e) {
    return STATE.UNSET;          // ★ 坏文件绝不抛，退回"未装"
  }
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath,
    JSON.stringify({ state: state, at: new Date().toISOString() }, null, 2), 'utf8');
}

const HOOK_EVENT = 'MessageDisplay';

/** 尾灯那条 hook 的命令串（★ 路径里的反斜杠一律转正斜杠） */
function hookCommand(handoverDir) {
  const script = path.join(handoverDir, 'ctx_msgdisplay_hook.js').split(path.sep).join('/');
  return 'node "' + script + '"';
}

/** ★ 幂等合并：同样的 command 已存在就不再加（防重复触发） */
function mergeHook(settings, eventName, command) {
  const next = JSON.parse(JSON.stringify(settings || {}));
  if (!next.hooks) next.hooks = {};
  if (!Array.isArray(next.hooks[eventName])) next.hooks[eventName] = [];
  const exists = next.hooks[eventName].some(function (g) {
    return Array.isArray(g.hooks) && g.hooks.some(function (h) { return h.command === command; });
  });
  if (!exists) {
    next.hooks[eventName].push({ hooks: [{ type: 'command', command: command, timeout: 10 }] });
  }
  return next;
}

/** 摘掉某个事件的全部 hook（本机迁移用它摘 Stop） */
function removeEvent(settings, eventName) {
  const next = JSON.parse(JSON.stringify(settings || {}));
  if (next.hooks && next.hooks[eventName]) delete next.hooks[eventName];
  return next;
}

const REPO_ROOT = path.join(__dirname, '..');
const RUNTIME_SCRIPTS = ['ctx_core.js', 'ctx_msgdisplay_hook.js'];

function nodeOnPath() {
  try {
    const r = require('child_process').spawnSync('node', ['--version'], { encoding: 'utf8' });
    return r.status === 0 ? String(r.stdout).trim() : null;
  } catch (e) { return null; }
}

function loadVersion(file) {
  try { return require(file).VERSION || null; } catch (e) { return null; }
}

function mkItem(name, ok, detail, err, advice) {
  return { name: name, ok: ok, detail: detail, err: err || '', advice: advice || '' };
}

/**
 * ★ 只读检测。报告结构固定为 items[]：{name, ok, detail, err, advice}
 *   哪一步 = name · 本机实测值 = detail · 原始错误 = err · 建议怎么改 = advice
 * 名字固定六个：node / claudeDir / settings.json / hook / runtime / state
 */
function buildReport(paths) {
  const items = [];

  const nv = nodeOnPath();
  items.push(mkItem('node', !!nv, nv || '(未找到)', '',
    nv ? '' : '先安装 Node.js，并确保 node 在 PATH 上（hook 由 shell 调用 node）'));

  const cd = fs.existsSync(paths.claudeDir);
  items.push(mkItem('claudeDir', cd, paths.claudeDir, '',
    cd ? '' : '目录不存在 ⇒ --apply 会创建'));

  const sjExist = fs.existsSync(paths.settingsPath);
  items.push(sjExist
    ? mkItem('settings.json', true, paths.settingsPath, '', '')
    : mkItem('settings.json', false, '(不存在)', '',
        '★ 必须【新建】—— 已知坑：settings.json 不存在时，安装脚本会静默跳过'));

  let hookItem;
  if (sjExist) {
    try {
      const s = JSON.parse(fs.readFileSync(paths.settingsPath, 'utf8'));
      const cmd = hookCommand(paths.handoverDir);
      const groups = (s.hooks && s.hooks[HOOK_EVENT]) || [];
      const hit = groups.filter(function (g) {
        return Array.isArray(g.hooks) && g.hooks.some(function (h) { return h.command === cmd; });
      });
      const ok = hit.length === 1;
      hookItem = mkItem('hook', ok,
        ok ? '已注册，1 条' : (hit.length === 0 ? '未注册' : '★ 重复 ' + hit.length + ' 条'),
        '', ok ? '' : '--apply 会写入 1 条 MessageDisplay');
    } catch (e) {
      hookItem = mkItem('hook', false, 'settings.json 无法解析', String(e.message),
        '人工修好 JSON 语法后重跑 --check');
    }
  } else {
    hookItem = mkItem('hook', false, '(settings.json 不存在，无从判断)', '',
      '--apply 会写入 1 条 MessageDisplay');
  }
  items.push(hookItem);

  let rtOk = false, rtDetail = '未安装（运行时目录不存在）', rtErr = '';
  if (fs.existsSync(paths.handoverDir)) {
    const rt = loadVersion(path.join(paths.handoverDir, 'ctx_core.js'));
    const rp = loadVersion(path.join(REPO_ROOT, 'scripts', 'ctx_core.js'));
    rtOk = !!rt && rt === rp;
    rtDetail = 'runtime=' + (rt || '(读不到)') + ' repo=' + (rp || '(读不到)');
    rtErr = rtOk ? '' : '运行时副本与仓里不一致（或读不到版本）';
  }
  items.push(mkItem('runtime', rtOk, rtDetail, rtErr,
    rtOk ? '' : '--apply 会把仓里的脚本覆盖拷过去'));

  const st = readState(paths.statePath);
  items.push(mkItem('state', true, st, '', ''));

  return { items: items, allOk: items.every(function (i) { return i.ok; }) };
}

function formatReport(rep) {
  const lines = ['【断点交接 · 安装自检】'];
  rep.items.forEach(function (i) {
    lines.push('  [' + (i.ok ? 'OK ' : '★FAIL') + '] ' + i.name + ': ' + i.detail);
    if (!i.ok && i.err) lines.push('          原始错误: ' + i.err);
    if (!i.ok && i.advice) lines.push('          ⇒ ' + i.advice);
  });
  lines.push('  ' + (rep.allOk ? '⇒ 全绿' : '⇒ 有 FAIL，见上方 ⇒'));
  return lines.join('\n');
}

module.exports = {
  STATE, resolvePaths, readState, writeState,
  HOOK_EVENT, hookCommand, mergeHook, removeEvent,
  REPO_ROOT, RUNTIME_SCRIPTS, buildReport, formatReport,
};
