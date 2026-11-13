## 记忆搬家 · dsh-migrate 1.0.0

把一台电脑上的 DSH 环境打包成能搬走的文件——**已装插件 + 记忆 + 安装脚本**，到了新电脑跑一遍脚本就全回来了。

fork 自 [dsh-memory-sync](https://github.com/QIC-9821/dsh-memory-sync)（MIT），在原「记忆同步」之上加了「整机搬家」。

---

## 它能做什么

### 📦 整机迁移包

扫描当前 profile 的 `dependencies` 和 `dsh.profile.bundles`，把**用户实际装的插件**打包（不预设清单）：

| 模式 | 内容 | 体积 | 接收端要求 |
| --- | --- | --- | --- |
| **轻量包**（lite） | 只带本地 tgz / link 目录，npm 插件记录版本 | 几 MB | 需要联网装 npm 插件 |
| **完整包**（full） | 所有插件 `npm pack` 成 tgz | 可能 200 MB+ | **完全离线可用** |

### 🔧 安装脚本 install.ps1

自动完成：

1. 找 DSH（注册表 → 常见路径）
2. 找 profile（多个会列出来让你选）
3. **备份**目标 profile 的 `package.json` / `cordis.patch.yml`
4. 装插件（本地 tgz / link 目录 / npm 联网）
5. 改 `bundles`
6. 合并记忆（同名先备份 `.bak-migrate`，相同的跳过）
7. 问你要不要重启 DSH

**安全设计**：
- `-DryRun` 只预演不动手
- 重启前检测会话（3 秒 CPU 差分）：**有会话连问三次**，空闲只问一次
- 覆盖任何文件前先写备份

### 🎛️ 设置页「记忆搬家」

在 DSH 设置里直接操作：选模式、选输出位置（可手输或点「浏览」弹文件夹选择器）、压不压 zip、带不带记忆。打包进度和结果原地显示。

### 🔄 顺带保留的同步能力

局域网快照同步、离线快照导入导出、冲突规则、定时推送、SSH 三段式——原插件有的都在。

---

## 安装

```bash
# 从 npm（如已发布）
dsh plugin add dsh-migrate

# 或本地 tgz
dsh plugin --profile desktop add <路径>\dsh-migrate-1.0.0.tgz
```

装完重启 DSH，设置里会出现「记忆搬家」。

---

## 迁移到新电脑

1. 在旧电脑打包（设置页或工具），拿到包目录 / zip
2. 拷到新电脑
3. 先预演：
   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun
   ```
4. 确认无误后正式安装：
   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```

---

## ⚠️ 注意事项

- **只支持 Windows**（安装脚本依赖 PowerShell 与注册表）
- **杀毒软件可能拦截**：脚本会改配置、结束进程、重启程序，行为像安装器，请确认来源后手动放行
- **完整包体积大**：取决于 npm 插件数量，可能超过 200 MB
- **不处理版本降级**：manifest 里记录来源 DSH 版本供参考，但脚本目前不强制校验
- **隐私**：包内是插件代码和记忆明文快照，**不要公开分享含个人记忆的包**

---

## 致谢

- [QIC-9821/dsh-memory-sync](https://github.com/QIC-9821/dsh-memory-sync) —— 同步底座（MIT）
- [DeepSeek Harness](https://github.com/deepseek-ai) —— 宿主平台

## 许可

MIT
