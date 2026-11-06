---
name: harmony-release-build
description: Build the signed HarmonyOS release .app package of the family-wealth RN app for AppGallery submission, via RN bundle and hvigor assembleApp. Use for requests like 打鸿蒙上架包, 构建鸿蒙.app, 鸿蒙发版, harmony release, or assembleApp. Do not use for Android APK, debug HAP, or iOS.
---

# HarmonyOS 上架包一键构建

一键完成：版本号核对 → harmony RN bundle → hvigor assembleApp 签名 .app → 产物验证（可选真机冒烟）。

## 固定路径（本机 Windows）

- 仓库根（当前工作副本）：`C:\dev\fw`
- 移动端：`C:\dev\fw\apps\mobile`
- 鸿蒙工程：`C:\dev\fw\apps\mobile\harmony`
- 签名上架产物：`harmony\build\outputs\default\harmony-default-signed.app`
- 调试 HAP（真机冒烟用）：`harmony\entry\build\default\outputs\default\entry-default-signed.hap`
- hvigorw：`C:\Program Files\Huawei\DevEco Studio\tools\hvigor\bin\hvigorw.bat`
- hdc：`C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe`
- 签名：release 证书已通过 DevEco「Project Structure → Signing Configs」配置，
  assembleApp 自动签名。**AI 不接触、不询问签名密码**；未配置签名时停止并让用户先走 DevEco 向导。

## 执行步骤

### 1. 确认版本号（发版必做）

版本号共 5 处，逐处核对、保持一致；审核被拒后的修复包必须递增（AGC 否则判重复包）：

| 文件 | 字段 |
|---|---|
| `apps\mobile\android\app\build.gradle` | `versionCode` / `versionName` |
| `apps\mobile\harmony\AppScope\app.json5` | `versionCode`（如 1000004）/ `versionName` |
| `apps\mobile\package.json` | `"version"` |
| `apps\mobile\src\screens\tabs\MeScreen.tsx` | `const version` |
| `apps\mobile\src\platforms\harmony\index.ts` | `HarmonyConfig.version` |

鸿蒙 versionName 三段式（0.1.9），versionCode 整数（1000000 起递增）。

### 2. 打 harmony RN bundle（核心纪律）

**只要改了 TS/TSX/JS，必须先重打 bundle；只跑 hvigor/assembleApp 不会更新 JS**，
会出现「包是新版、页面仍是旧版」的假发布（0.1.8 曾踩中）。

```powershell
cd C:\dev\fw\apps\mobile
pnpm bundle:harmony
```

该脚本已内置 prepare 前置（复制 HAR、生成缺失 .harmony.js 桩、patch RNOH）。
成功标志：`Done writing bundle output` + `Done copying assets`。
watchman 首次 query 可能等待 1~2 分钟，属正常，不要中断。

### 3. assembleApp 构建签名 .app

任务名是 **assembleApp**（产出上架 .app）；assembleHap 只产出调试 HAP，不要混用。

```powershell
$env:DEVECO_SDK_HOME = "C:\Program Files\Huawei\DevEco Studio\sdk"
cd C:\dev\fw\apps\mobile\harmony
& "C:\Program Files\Huawei\DevEco Studio\tools\hvigor\bin\hvigorw.bat" assembleApp --no-daemon
```

成功标志：`BUILD SUCCESSFUL`，任务链 PackageHap → SignHap → PackageApp → SignApp。
`--no-daemon` 用于避免 daemon OOM；构建约 2 分钟，建议 run_in_background。

### 4. 验证产物

确认 `harmony-default-signed.app` 的时间戳为本次构建，大小通常 8~10 MB；
向用户报告绝对路径、大小、versionName。

### 5.（可选，强烈建议）真机冒烟

审核被拒修复后，提审前先装 HAP 验证：

```powershell
& "<hdc 路径>" install "<entry-default-signed.hap 绝对路径>"
```

`hdc list targets` 为空则跳过并提示用户连接 Mate X7。
签名不一致报错时先告知用户再 uninstall `com.familywealth.app`（会清数据）。

## 必须注意的坑

- **沙箱限制 .hvigor 写入**：默认沙箱下 hvigor 报
  `EPERM ... harmony\.hvigor\cache\...` / `.git\index.lock`，需在沙箱外执行
  （dangerouslyDisableSandbox）。以 `BUILD SUCCESSFUL` 和产物时间戳为准。
- **不要用错误任务名或多余参数**：`assembleApp --mode module -p product=default`
  曾报 `Task [ 'assembleApp' ] was not found`；直接 `assembleApp --no-daemon` 即可。
- **PowerShell 5.1 不支持 `&&` / `||`**：用 `;` 或分步执行。
- **鸿蒙端功能可见性**：无鸿蒙原生实现的能力（如 ML Kit OCR、expo-sharing 导出）
  必须按平台隐藏入口，不能留一个点了就报错的按钮——AppGallery 审核明确拒绝此类问题。
- **原生组件 / TurboModule 必须双侧注册**：C++ PackageProvider.cpp 与 ArkTS
  `entry/src/main/ets/pages/Index.ets` 的 createRNPackages 缺一不可。只在 C++
  注册组件时，宿主 Stack 挂载但内部为空（无组件日志），表现为「点了没反应」。
  库若未提供 RNOHPackage（如 @react-native-ohos/datetimepicker 只给了组件），
  需在 `entry/src/main/ets/packages/` 自建 RNOHPackage（wrapBuilder +
  createWrappedCustomRNComponentBuilderByComponentNameMap）并加入列表。
  排查法：`uitest dumpLayout` 看目标原生节点是否存在、父容器是否为空。
- **改动范围决定构建方式**：改 ArkTS（.ets）只需 assembleApp 重新编译；
  改 JS/TS/TSX 必须先 `bundle:harmony` 再 assembleApp。

## 完成后

报告：.app 路径、大小、版本号、构建耗时；提醒用户
①真机冒烟 ②上传 AGC 替换旧包 ③备案号/合规材料齐备后再提审。
