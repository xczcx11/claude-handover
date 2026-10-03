# 交接（断点交接）

**尾灯**（每条回复末尾那行上下文余量）+ **断点存档**（compact/clear 前把进度落成文件）。
两者合起来叫「**交接**」—— 让 compact / clear 发生得**是时候、且不丢东西**。

```
        ┌── 感知层：尾灯 —— 到 85% 亮 ⚠，告诉你"该准备了"
 交接 ──┤
        └── 执行层：断点存档 —— 把「现在到哪 / 下一步 / 已作废」落成文件
                 ↓
              然后才 compact / clear（不丢东西）
```

## 装

```bash
git clone https://github.com/xczcx11/claude-handover.git ~/.claude/skills/project-checkpoint
```

然后跟 Claude 说「**断点存档**」，它会引导你装尾灯（检测 → 问你 → 装 → 提示重启）。

★ **若 `/project-checkpoint` 没出现**，重启一次 Claude。

★ 装完**必须重启一次**才生效 —— Claude Code 的 `settings.json` hook 有热重载缺陷（原子保存会让监听失效）。

## 修 / 重装

装好后安装器会被自动删掉（"平时清爽"）。**出事了**用这两条拿回来：

```bash
git -C ~/.claude/skills/project-checkpoint checkout .
node ~/.claude/skills/project-checkpoint/scripts/install.js --check
```

实在不行：**删掉整个目录重新 clone**。

## 已知副作用（★ 不是错误）

- `--finalize` 会删 `install.js`、改 `SKILL.md` ⇒ **git 工作区会变脏**（`git status` 显示 deleted / modified）。这是**预期的**。
- ⇒ 以后在这个目录里 `git pull` 可能因本地改动冲突。处理：先 `git checkout .` 再 pull。

## 目录

- `scripts/` —— 取数核心 + 尾灯 + 安装器
- `optional/ctx_stop_hook.js` —— 可选件（终端用），**默认不装**。要用就先把它**拷到与 `ctx_core.js` 同目录**（它 `require('./ctx_core')`），再往 `settings.json` 加一条 `Stop`
- `templates/ctx_config.json` —— 上下文窗口配置（默认 1000000；换模型要改）
- `docs/` —— 设计与实施文档
- `test/` —— `install.js` 的回归测试（`node --test test/test_install.js`）

## 运行时

脚本与配置**不在仓里**，装在：

```
~/.claude/handover/
├── ctx_core.js
├── ctx_msgdisplay_hook.js
├── ctx_config.json
├── _handover_state.json     ← 状态机（unset / installed_unverified / verified）
└── _hook_trace_v1.log       ← 痕迹日志（判断"跑没跑过"用）
```

`settings.json` 里只注册**一条** `MessageDisplay` hook，指向 `~/.claude/handover/ctx_msgdisplay_hook.js`。
