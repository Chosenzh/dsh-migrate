# dsh-migrate · 记忆搬家

把一台电脑上的 DSH 环境打包成能搬走的文件：**已装插件 + 配置 + 会话 + 附件 + 记忆 + 安装脚本**。
到了新电脑，跑一遍包里的 `install.ps1`，这些都回来了。

> 这是社区工具，不是 DSH 官方发布。Fork 自 [QIC-9821/dsh-memory-sync](https://github.com/QIC-9821/dsh-memory-sync)（MIT）。

## 两种模式

**新手** —— 只选「完整度 + 放哪」，其他都替你想好：

| 完整度 | 内容 | 参考体积 |
| --- | --- | --- |
| 精简 | 配置 + 记忆 | 几 MB |
| 标准 | + 会话 + 世界 | 约 20 MB |
| 全量 | + 附件 | 约 90 MB |

**老手** —— 自己挑：插件怎么打（轻量/完整）、额外带什么（配置/会话/附件/世界）、压不压 zip、带不带记忆。


## 怎么用

### 在 DSH 里

1. 打开 **设置 → 记忆搬家**
2. 切「新手」或「老手」
3. 新手：选完整度（精简/标准/全量）；老手：勾选额外内容
4. 选输出位置（留空 = `~/.dsh/memory-sync/packs/`，也可以点「浏览」选文件夹）
5. 可选：同时压成 `.zip`、带不带记忆快照
6. 点「开始打包」

### 打包产物长这样

```
dsh-migrate-<时间戳>/
├─ manifest.json      # 清单：DSH 版本、插件列表、记忆信息
├─ plugins/           # 本地 tgz（完整包还含 npm 插件的 tgz）
├─ npm-plugins.json   # 轻量包：要联网装的插件清单
├─ memory.json.gz     # 记忆快照
├─ install.ps1        # 安装脚本
└─ README.md          # 就是你正在看的这份
```

### 到了新电脑

把整个目录（或 zip）拷过去，然后：

```powershell
# 1) 先预演，不改任何东西
powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun

# 2) 确认没问题，正式安装
powershell -ExecutionPolicy Bypass -File install.ps1
```

脚本会自动：

1. 找 DSH（注册表 → 常见安装路径）
2. 找 profile（有多个会列出来让你选）
3. **备份**目标 profile 的 `package.json` / `cordis.patch.yml`
4. 装插件（本地 tgz / link 目录 / npm 联网）
5. 改 `bundles`
6. 合并记忆（同名文件先备份成 `.bak-migrate`）
7. 问你要不要重启 DSH——**检测到有会话在跑会连问三次**

## 常见问题

**Q：杀毒软件报警？**
A：正常。脚本会改配置、结束进程、重启程序，行为像安装器。确认来源后手动放行。

**Q：新电脑没装 DSH？**
A：脚本会明确报「DSH (DeepSeek Harness) not found」，先装 DSH 再跑。

**Q：轻量包装到一半没网？**
A：本地插件会装上，npm 插件会报错。联网后重跑脚本即可，已装的会跳过。

**Q：记忆会被覆盖吗？**
A：同名文件覆盖前先写 `.bak-migrate` 备份；内容相同的直接跳过；本地更长的日志不覆盖。

**Q：能只搬记忆不搬插件吗？**
A：可以，打包时取消勾选插件部分，或者只用 `memory.json.gz` 手动导入。

## 工具参数（给我调用的）

```
memory_sync action=pack mode=lite|full out=<路径> zip=true|false includeMemory=true|false profile=<名字>
memory_sync action=status
memory_sync action=list
memory_sync action=export path=<文件>
memory_sync action=import path=<文件> dryRun=true|false
```

## 安全说明

- 插件只读写 `$DSH_HOME/memories` 和 `$DSH_HOME/memory-sync`
- 网络只连你配置的 `peerUrl`，无遥测
- 安装脚本会备份配置，覆盖记忆前先写 `.bak-migrate`
- 完整包会把 npm 插件 `npm pack` 成 tgz，体积较大但离线可用

## 许可

MIT。原项目版权归 QIC-9821，本 fork 保留原许可与署名。
