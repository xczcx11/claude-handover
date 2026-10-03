'use strict';
/**
 * 上下文用量【取数核心】—— ★ 单一权威来源
 * statusline.js（终端状态栏）、ctx_stop_hook.js（Stop hook）、
 * ctx_msgdisplay_hook.js（助手消息尾部追加）都 require 本文件。
 * 取数三级降级：① context_window.current_usage ② total_input_tokens ③ transcript 的 jsonl
 * ------------------------------------------------------------------
 * v1 · 2026-10-02
 * v2 · 2026-10-02  ★ 新增 fmtLine()：提示文案的单一权威（两处 hook 共用）
 *                  ★ usedFromTranscript() 改为【只读尾部 256KB】，长会话不再读几十 MB
 * v3 · 2026-10-02  ★ resolve() 新增兜底：payload 没给 transcript_path 时，
 *                     用 session_id + cwd 推导（★ 修"别的项目不显示"）
 * v4 · 2026-10-02  ★★ 修【分母错 5 倍】：窗口改为【可配置】ctx_config.json，
 *                     默认 1000000（实测：会话撑到 1,009,621 才压缩）
 *                  ★ 文案改为【项目感知】：只有该项目真有 project-checkpoint 才指名它
 *                  ★ used > size 时显式标注"已超假定窗口"
 * v5 · 2026-10-02  ★ project-checkpoint 提升为【全局】skill ⇒ warnNoteFor 先查
 *                     ~/.claude/skills/project-checkpoint，再查项目目录
 * v6 · 2026-10-03  ★ 抽出为可分发仓；新增 VERSION 导出（install.js 用它比对陈旧）
 * ------------------------------------------------------------------
 */
const VERSION = 'v6';           // ★ 供 install.js 比对"运行时副本是否陈旧"
const fs = require('fs');
const os = require('os');
const nodePath = require('path');

const TAIL_BYTES = 262144;      // ★ 只读尾部这么多字节（256KB）
const DEFAULT_WINDOW = 1000000; // ★ v4：实测校准（见文件头 v4）

/** ★ v4：读 ctx_config.json（与本文件同目录）。读不到就用默认值。 */
let _cfg = null;
function loadConfig() {
  if (_cfg) return _cfg;
  try {
    const p = nodePath.join(__dirname, 'ctx_config.json');
    _cfg = fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) || {}) : {};
  } catch (e) {
    _cfg = {};
  }
  return _cfg;
}

/** ★ v4：窗口大小。config 有值就【优先用 config】（本机中转端点报的 200k 是错的）。 */
function contextWindow(payloadSize) {
  const n = Number(loadConfig().context_window);
  if (isFinite(n) && n > 0) return n;
  if (typeof payloadSize === 'number' && payloadSize > 0) return payloadSize;
  return DEFAULT_WINDOW;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

function fmtK(n) {
  if (n === null || n === undefined || isNaN(n)) return '?';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

/**
 * ★ 提示文案的【单一权威】—— 各处 hook 共用，避免两处文案各写一份而漂移
 * @param {number} used    已用 token
 * @param {number} size    窗口大小
 * @param {number} [warnPct=85] 到此线加"⚠ ..."
 * @param {string} [warnNote]   告警时附在末尾的提示（★ v4：由调用方按【项目】给，见 warnNoteFor）
 */
function fmtLine(used, size, warnPct, warnNote) {
  const pct = Math.max(0, Math.min(100, (used / size) * 100));
  const left = Math.max(0, size - used);
  const over = used > size ? '（已超假定窗口 ⇒ 请核对 ctx_config.json）' : '';
  const body = pct.toFixed(0) + '% 已用 · 剩 ' + fmtK(left) + ' / ' + fmtK(size) + over;
  const limit = (warnPct === undefined || warnPct === null) ? 85 : warnPct;
  return pct >= limit ? '[ctx] ⚠ ' + body + (warnNote ? ' —— ' + warnNote : '')
                      : '[ctx] ' + body;
}

/**
 * ★ v4：告警尾巴必须【项目感知】—— hook 是全局的，但 project-checkpoint
 * 是【本项目专属】skill（本项目 .claude/skills 下才有）。别的项目指名它会误导。
 */
function warnNoteFor(cwd) {
  // ★ v5：project-checkpoint 已提升为【全局】skill ⇒ 先看全局目录，再看项目目录
  const cands = [
    nodePath.join(os.homedir(), '.claude', 'skills', 'project-checkpoint'),
    cwd ? nodePath.join(cwd, '.claude', 'skills', 'project-checkpoint') : null,
  ];
  for (let i = 0; i < cands.length; i++) {
    try {
      if (cands[i] && fs.existsSync(cands[i])) return '该跑 project-checkpoint 了';
    } catch (e) {}
  }
  return '上下文将满，建议收尾存档';
}

/** 从一段 jsonl 文本里倒着找最后一条带 usage 的记录 */
function scanUsage(txt) {
  const lines = txt.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (!ln) continue;
    let o;
    try { o = JSON.parse(ln); } catch (e) { continue; }   // 首行可能是被截断的半行 ⇒ 跳过
    const u = o && o.message && o.message.usage;
    if (!u) continue;
    const tot =
      (u.input_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0);
    if (tot > 0) return tot;
  }
  return null;
}

/**
 * 兜底：从 transcript jsonl 取用量。
 * ★ v2：先只读尾部 TAIL_BYTES（长会话快得多）；尾部找不到再退回全量扫描。
 */
function usedFromTranscript(tp) {
  try {
    const fd = fs.openSync(tp, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - TAIL_BYTES);
      const len = size - start;
      if (len > 0) {
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, start);
        const hit = scanUsage(buf.toString('utf8'));
        if (hit !== null) return hit;
      }
    } finally {
      fs.closeSync(fd);
    }
    return scanUsage(fs.readFileSync(tp, 'utf8'));   // 尾部没找到 ⇒ 全量
  } catch (e) {}
  return null;
}

/** ★ 与 Claude Code 的 projects 目录名规则一致：非 [a-zA-Z0-9] 一律换成 '-' */
function sanitizeCwd(cwd) {
  return String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * ★ v3 兜底：payload 没给 transcript_path 时，用 session_id + cwd 推导出 jsonl 路径。
 * 背景：某些会话/事件下 payload 不带 transcript_path ⇒ 取数失败 ⇒ hook 静默。
 * 路径规则：~/.claude/projects/<cwd 清洗后>/<session_id>.jsonl
 */
function deriveTranscript(d) {
  try {
    if (!d || !d.session_id || !d.cwd) return null;
    const p = nodePath.join(os.homedir(), '.claude', 'projects',
                            sanitizeCwd(d.cwd), d.session_id + '.jsonl');
    return fs.existsSync(p) ? p : null;
  } catch (e) {
    return null;
  }
}

/** 从 payload 解析出 { used, size }；取不到 used 时为 null */
function resolve(d) {
  const cw = (d && d.context_window) || {};
  const size = contextWindow(cw.context_window_size);   // ★ v4：config 优先
  let used = null;
  const cu = cw.current_usage;
  if (cu && typeof cu === 'object') {
    const t =
      (cu.input_tokens || 0) +
      (cu.cache_creation_input_tokens || 0) +
      (cu.cache_read_input_tokens || 0);
    if (t > 0) used = t;
  }
  if (used === null && typeof cw.total_input_tokens === 'number' && cw.total_input_tokens > 0) {
    used = cw.total_input_tokens;
  }
  if (used === null && typeof cw.used_percentage === 'number') {
    used = Math.round((cw.used_percentage / 100) * size);
  }
  if (used === null) {
    // ★ v3：payload 没带 transcript_path 就用 session_id + cwd 推导
    const tp = (d && d.transcript_path) || deriveTranscript(d);
    if (tp) used = usedFromTranscript(tp);
  }
  return { used: used, size: size };
}

function bar(pct, w) {
  const width = w || 10;
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

module.exports = {
  VERSION: VERSION,
  readStdin: readStdin,
  fmtK: fmtK,
  fmtLine: fmtLine,
  warnNoteFor: warnNoteFor,
  loadConfig: loadConfig,
  contextWindow: contextWindow,
  sanitizeCwd: sanitizeCwd,
  deriveTranscript: deriveTranscript,
  usedFromTranscript: usedFromTranscript,
  resolve: resolve,
  bar: bar,
};
