'use strict';
/**
 * Claude Code 【MessageDisplay hook】
 * —— 每条助手消息【显示到屏幕前】，在末尾追加一行「剩余上下文」
 * ------------------------------------------------------------------
 * 为什么用它：Stop hook 的 systemMessage 在 VSCode 扩展里【不渲染】
 *   （扩展全目录搜 systemMessage = 0 命中 ⇒ 从未实现）。
 *   MessageDisplay 不同：替换动作由【核心】在交给前端【之前】完成，
 *   前端不需要认识 displayContent ⇒ 扩展能显示。
 *
 * 触发：MessageDisplay（助手文本流式输出，按"批"触发）
 * 输入：JSON on stdin
 *   { hook_event_name, turn_id, message_id, index, final, delta,
 *     session_id, transcript_path, cwd, ... }
 *   ★ 字段名已从 claude.exe(2.1.167) 二进制的 zod schema 核实，非猜测：
 *     "Input to command is JSON with turn_id, message_id, index, final,
 *      and delta (the newly completed lines)."
 * 输出：{"hookSpecificOutput":{
 *          "hookEventName":"MessageDisplay",
 *          "displayContent":"<本批原文 + [ctx] 行>"}}
 *   ★ display-only：只改【屏幕上的字】；不改存档、不进模型上下文、不花 token
 *   ★ 非 final 批 / 取数失败 ⇒ 【什么都不输出】⇒ 显示原文（安全兜底）
 * 取数：共用 ctx_core.js（★ 单一权威来源）
 * 痕迹：与 Stop hook 共用 _hook_trace_v1.log，本脚本的行带 "MD " 前缀
 * ------------------------------------------------------------------
 * v1 · 2026-10-02
 * v6 · 2026-10-03  ★ 抽出为可分发仓；新增 VERSION 导出 + require.main 守卫
 *                     （★ 没有守卫的话，install.js require 它时会立刻读 stdin 卡死）
 * ------------------------------------------------------------------
 */
'use strict';

const VERSION = 'v6';           // ★ 供 install.js 比对陈旧
const fs = require('fs');
const path = require('path');
const core = require('./ctx_core');

const WARN_PCT = 85;   // 到这条线就提醒跑断点存档
const TRACE = path.join(__dirname, '_hook_trace_v1.log');

function trace(line) {
  try {
    fs.appendFileSync(TRACE, new Date().toISOString() + '  ' + line + '\n', 'utf8');
  } catch (e) {}
}

function main() {
  const raw = core.readStdin();
  let d = {};
  try { d = JSON.parse(raw || '{}'); } catch (e) {}

  const isFinal = d.final === true;
  const delta = typeof d.delta === 'string' ? d.delta : '';

  trace('MD fired  final=' + isFinal + '  index=' + d.index + '  deltaLen=' + delta.length +
        '  cwd=' + (d.cwd || '?'));

  if (!isFinal) return;                       // ★ 只认 final 批，其余原样显示

  const r = core.resolve(d);
  if (r.used === null) {
    trace('MD skip  used=NULL' +
          '  cwd=' + (d.cwd || '?') + '  keys=' + Object.keys(d).join('|'));
    return;                                   // 拿不到 ⇒ 静默（显示原文）
  }

  // ★ 文案走 ctx_core.fmtLine（与 Stop hook 同一份，防两处漂移）
  // ★ v4：告警尾巴【项目感知】—— 只有本项目真有 project-checkpoint 才指名它
  const msg = core.fmtLine(r.used, r.size, WARN_PCT, core.warnNoteFor(d.cwd));

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'MessageDisplay',
      displayContent: delta + '\n\n' + msg,
    },
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    try { trace('MD THREW ' + e.message); } catch (e2) {}
  }
}

module.exports = { VERSION: VERSION };
