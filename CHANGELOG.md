# Changelog

## 1.3.0 — 2026-11-14

打包改用**自己的流式 zip**，支持分卷。

- 新增 `lib/zip-stream.mjs`：自己写 local header / central directory / EOCD。
  - 每个条目置 **UTF-8 标志位（0x0800）**——中文文件名换到任何系统都不乱码。
  - 小文件（≤64MB）一次读入算 CRC32 + deflate；大文件**流式读入**，内存恒定。
  - 超过单卷上限（默认 1.8GB）自动切卷：`pack.zip`、`pack-part2.zip`……
- `zipPack()` 不再调用 PowerShell `Compress-Archive`：那个会整包缓冲（多 GB 直接 OOM），且按本地代码页存文件名。
- 实测：70MB 单文件 + 中文文件名 → 分两卷写出 → `Expand-Archive` 解压后字节数完整、中文名保留。

## 1.2.0 — 2026-11-14

新手引导。

- 首次打开「记忆搬家」时显示四步引导：这是什么 → 包里有什么 → 新电脑怎么用 → 开始。
- 可跳过、可随时重看（右上角「新手引导」按钮）。
- 用 `localStorage` 记住「看过了」，不再重复打扰。

## 1.1.0 — 2026-11-14

设置页重做，分「新手 / 老手」两种模式。

- **新手模式**：只选完整度（精简 / 标准 / 全量）+ 输出位置，其余由工具决定。
- **老手模式**：插件打包（轻量 / 完整）、额外内容（配置 / 会话 / 附件 / 世界）、zip、记忆快照全部自选。
- 打包接口新增 `preset`（essential / standard / everything）与 `include`（细粒度覆盖）。
- 实测三档体积：精简 2 文件 / 0 MB，标准 49 文件 / 21.8 MB，全量 197 文件 / 91 MB。

## 0.4.0 — 2026-11-14

**搬运范围从「插件 + 记忆」扩展到「整机」**。

- 新增 `lib/bundle-extra.mjs`：收集 `config`（profile 的 package.json + patch）、`sessions`、`attachments`、`worlds`，**每个文件算 sha256** 写进 manifest。
- `install.ps1` 新增第 7.2 段：逐文件校验 sha256 → 恢复 → 覆盖前备份 `.bak-migrate` → 恢复 config 时**改写源机绝对路径**。
- 修掉一个中文路径 bug：`install.ps1` 改为 **UTF-8 BOM** 写入，否则 PowerShell 5.1 按系统代码页读脚本，内嵌 manifest 里的中文路径全乱码（实测 49 个文件只认出 32 个）。

## 0.3.0 — 2026-11-14

**启动体检**（学自 plugin-porter）。

- 新增 `lib/boot-check.mjs`：复刻 DSH 启动校验——profile 清单合法、每个 bundle 有 `dsh.bundle.patch`、patch 文件存在且可解析、**patch 的 id 不重复**。
- 暴露成工具：`memory_sync action=boot`。
- 打包时 `ensureBundleField()`：本地插件快照缺 `dsh.bundle` 时只补副本，不动源码，manifest 标 `bundleFieldAdded`。

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
