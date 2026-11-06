---
name: android-release-install
description: Build the signed release APK of the family-wealth Expo/RN mobile app and install it on the adb-connected Android phone. Use for requests like 打包正式APK安装到手机, rebuild release and install to device, or 重装到手机. Do not use for debug builds, AAB bundles, or iOS.
---

# Android Release APK 构建并安装到手机

一键完成：设备检测 → typecheck → 正式签名 release APK → adb 安装到已连接手机。

## 固定路径（本机 Windows）

- 仓库根：`c:\Users\xuzhiweiand\WorkBuddy\2026-09-05-14-35-28\family-wealth`
- Android 工程：`family-wealth\apps\mobile\android`
- 产物：`family-wealth\apps\mobile\android\app\build\outputs\apk\release\app-release.apk`
- adb：`C:\Users\xuzhiweiand\AppData\Local\Android\Sdk\platform-tools\adb.exe`
- 签名：release keystore 已通过 `android\keystore.properties`（gitignored）配置，
  `assembleRelease` 会自动用正式证书签名，无需额外参数。

## 步骤

1. **先确认设备在线**，无设备则停止并提示用户连接手机、开启 USB 调试：

   ```powershell
   & "C:\Users\xuzhiweiand\AppData\Local\Android\Sdk\platform-tools\adb.exe" devices -l
   ```

   需看到状态为 `device` 的一行；`unauthorized` 时让用户在手机上点允许调试。

2. **typecheck**（在仓库根，失败必须先修复，不要带病打包）：

   ```powershell
   pnpm -F mobile typecheck
   ```

3. **构建 release APK**。构建耗时可能数分钟，用后台方式运行（`run_in_background`）：

   ```powershell
   .\gradlew.bat assembleRelease --console=plain
   ```

   工作目录设为 `family-wealth\apps\mobile\android`。

4. **安装到手机**（确认产物时间戳为本次构建后）：

   ```powershell
   & "C:\Users\xuzhiweiand\AppData\Local\Android\Sdk\platform-tools\adb.exe" install -r "<产物绝对路径>"
   ```

   看到 `Success` 即完成；若报 `signatures do not match`，说明手机上装的是其他签名
   （如 debug）包，需先 `adb uninstall com.familywealth.app` 再装（会清数据，先告知用户）。

## 必须注意的两个坑

- **沙箱误报 exit 1**：构建命令可能返回非零，错误为
  `Not allow operate files: ...Android\Sdk\.knownPackages`。这发生在 Gradle 打包完成之后，
  **以日志中的 `BUILD SUCCESSFUL` 和产物的最新修改时间为准**，APK 是好的，直接继续安装。
- **PowerShell 5.1 不支持 `&&` / `||`**：串联命令用 `;`，或分步执行。

## 完成后

向用户报告：产物路径、大小、构建时间、安装目标设备型号，并提示打开 app 验证。
用户若还要把同一 APK 离线发给他人，直接给出产物路径即可，无需另打 AAB。
