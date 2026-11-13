# Changelog

## 1.0.0 — 2026-11-13

首个正式版。fork 自 [dsh-memory-sync 0.3.0](https://github.com/QIC-9821/dsh-memory-sync)（MIT），
在原「记忆同步」之上加了「整机搬家」的能力。

### 新功能

- **整机迁移包**：扫描当前 profile 的 `dependencies` 和 `dsh.profile.bundles`，把已装插件 + 记忆快照打成一个能搬走的包。
  - `lite`（轻量包）：只带本地 tgz / link 目录，npm 插件记录版本，接收端联网安装。
  - `full`（完整包）：所有插件 `npm pack` 成 tgz，接收端完全离线安装。
- **安装脚本 `install.ps1`**：自动找 DSH（注册表 → 常见路径）、选 profile、备份配置、装插件、改 bundles、合并记忆、确认后重启。
  - `-DryRun` 预演，不改任何东西。
  - `-Yes` 跳过重启确认（谨慎使用）。
- **重启前会话检测**：3 秒 CPU 差分判断 DSH 是否有会话在跑；有会话连问三次才重启，空闲只问一次。
- **设置页「记忆搬家」**：在 DSH 设置里选打包方式、输出位置（可直接输入或浏览文件夹）、是否压 zip、是否带记忆；显示结果和已有包列表。
- **目录浏览接口** `/memory-sync/api/browse`：调用 Windows 原生文件夹选择器。
- **工具参数扩展**：`memory_sync action=pack` 支持 `mode` / `profile` / `out` / `zip` / `includeMemory`。

### 保留自原插件

- 局域网快照同步（HTTP 直连、共享密钥、覆盖前备份）
- 离线快照导出 / 导入（`.json.gz`）
- 冲突规则（local / peer）、定时推送、收到后回发
- SSH 三段式同步

### 修复 / 加固

- `readDshVersion` 增加注册表兜底，manifest 里能正确带上 DSH 版本。
- 渲染层模块 id 唯一化，避免与 `dsh-memory-sync` 同时安装时重复注册。
- 打包时 link 插件连 `node_modules` 一起带走，保证接收端离线可用。

### 已知限制

- 只支持 Windows（安装脚本依赖 PowerShell 与注册表）。
- `full` 包体积取决于 npm 插件大小，可能超过 200 MB。
- 杀毒软件可能拦截安装脚本（会改配置、结束进程、重启 DSH），需要手动放行。
- 不处理 DSH 版本降级；manifest 里记录来源版本供参考，但脚本目前不强制校验。

## 0.3.0 — 上游 dsh-memory-sync

上游历史见 [原仓库 CHANGELOG](https://github.com/QIC-9821/dsh-memory-sync/blob/main/CHANGELOG.md)。
