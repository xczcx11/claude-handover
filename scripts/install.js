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

module.exports = { STATE, resolvePaths, readState, writeState };
