'use strict';
/**
 * Claude Code 【Stop hook】—— 每轮结束后推一行「剩余上下文」
 * ------------------------------------------------------------------
 * 触发：Stop（我每回完一轮话就跑一次）
 * 输出：{"systemMessage": "..."} —— ★ 只给使用者看，【不进模型上下文】、不花 API token
 * 取数：共用 ctx_core.js（★ 单一权威来源，与 statusline.js 同口径）
 * 版本：v2 · 2026-10-02    ★ v2 新增运行痕迹 _hook_trace_v1.log（判断"跑没跑过"）
 * 纪律：绝不抛异常、绝不输出垃圾 —— 拿不到数就【什么都不输出】
 * ------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./ctx_core');

const WARN_PCT = 85;   // 到这条线就提醒跑断点存档
const TRACE = path.join(__dirname, '_hook_trace_v1.log');   // ★ 运行痕迹（每轮一行）

function trace(line) {
  try {
    fs.appendFileSync(TRACE, new Date().toISOString() + '  ' + line + '\n', 'utf8');
  } catch (e) {}
}

function main() {
  const raw = core.readStdin();
  let d = {};
  try { d = JSON.parse(raw || '{}'); } catch (e) {}

  const r = core.resolve(d);

  if (r.used === null) {
    trace('fired  used=NULL  (JSON=' + (raw ? raw.length : 0) + 'B)' +
          '  cwd=' + (d.cwd || '?') + '  keys=' + Object.keys(d).join('|'));
    return;                                            // 拿不到 ⇒ 静默
  }

  trace('fired  used=' + r.used + '  size=' + r.size + '  event=' + (d.hook_event_name || '?') +
        '  cwd=' + (d.cwd || '?'));

  // ★ 文案走 ctx_core.fmtLine（单一权威，与 ctx_msgdisplay_hook.js 同一份）
  // ★ v4：告警尾巴【项目感知】—— 只有本项目真有 project-checkpoint 才指名它
  const msg = core.fmtLine(r.used, r.size, WARN_PCT, core.warnNoteFor(d.cwd));

  process.stdout.write(JSON.stringify({ systemMessage: msg }));
}

try {
  main();
} catch (e) {
  try { trace('THREW ' + e.message); } catch (e2) {}
}
