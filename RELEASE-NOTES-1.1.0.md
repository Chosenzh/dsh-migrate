## 记忆搬家 · dsh-migrate 1.1.0

这一次从「只搬插件和记忆」变成了**真正能整机搬走**：配置、会话、附件、世界（房间与日记）都能带走，每个文件带 sha256 校验。

fork 自 [dsh-memory-sync](https://github.com/QIC-9821/dsh-memory-sync)（MIT）。

---

## 这一版新增什么

### 📦 整机搬运（不再只是插件）

| 类别 | 内容 |
| --- | --- |
| 配置 | profile 的 `package.json` + `cordis.patch.yml` |
| 会话 | 聊天记录（`sessions/`） |
| 附件 | 上传的文件与图片（`attachments/`） |
| 世界 | 房间、日记、人设（`worlds/`） |

**每个文件算 sha256** 写进 `manifest.json`，恢复时逐个校验；对不上的会明确告诉你，不静默跳过。

### 🧭 新手 / 老手，两种模式

**新手**：只选「完整度 + 放哪」

| 完整度 | 内容 | 实测体积 |
| --- | --- | --- |
| 精简 | 配置 + 记忆 | 2 文件 / 0 MB |
| 标准 | + 会话 + 世界 | 51 文件 / 20.9 MB |
| 全量 | + 附件 | 197 文件 / 91 MB |

**老手**：插件怎么打（轻量/完整）、额外带什么、压不压 zip、带不带记忆，全部自选。

### 🩺 启动体检（`memory_sync action=boot`）

装插件之前先问一句：**下次重启会不会挂？**

复刻 DSH 启动时的校验：
- profile 清单 JSON 是否合法
- 每个 bundle 有没有 `dsh.bundle.patch`
- patch 文件存在且能解析
- **patch 里的 id 有没有重复**（`duplicate loader entry id` 会让 DSH 直接起不来）

### 🛠 恢复时改写路径

`install.ps1` 恢复配置时会改写 `file:` / `link:` 里的源机绝对路径，换机不用手动改依赖。

---

## 修掉的坑

- **中文路径乱码**：`install.ps1` 原来无 BOM，PowerShell 5.1 按系统代码页读脚本，内嵌 manifest 里的中文路径全废（实测 49 个文件只认出 32 个）。现在写 UTF-8 BOM，全部通过。
- **id 重复误报**：体检脚本的正则把同一个 id 数两次，已修。

---

## 迁移到新电脑

```powershell
# 先预演
powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun

# 正式安装
powershell -ExecutionPolicy Bypass -File install.ps1
```

脚本会：找 DSH → 选 profile → 备份 → 装插件 → 改 bundles → 合并记忆 → 恢复 extras（校验 sha256）→ 确认后重启。

**重启确认**：检测到有会话在跑会连问三次；空闲只问一次。

---

## ⚠️ 注意事项

- 只支持 Windows
- 杀毒软件可能拦截（脚本会改配置、结束进程、重启 DSH）
- 全量包可能接近 100 MB
- **包内含会话和附件，可能是私密内容**——分享前先只选「精简」

## 致谢

- [QIC-9821/dsh-memory-sync](https://github.com/QIC-9821/dsh-memory-sync) —— 同步底座（MIT）
- [chenzhihan1751-cyber/dsh-plugin-porter](https://github.com/chenzhihan1751-cyber/dsh-plugin-porter) —— 启动体检、流式 zip、整机三档的思路来源（BSD-3-Clause）

## 许可

MIT
