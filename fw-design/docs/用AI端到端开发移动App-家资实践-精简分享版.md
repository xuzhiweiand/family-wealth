# 一人 + AI，三周做完一款移动 App：从需求到安卓、鸿蒙双端上架

> 「家资」是一个端到端加密的家庭资产记账工具。本文是完整复盘的精简版，只保留过程主线、最值钱的坑和可复用的方法，供同事快速参考。

## 成果速览

- **全程一人 + AI**，约三周，8 个版本迭代，无第二位工程师参与
- Android release 真机回归通过；**鸿蒙 .app 已提交 AppGallery Connect 审核**
- 技术栈：bare React Native 0.77.3 + RNOH 0.77.74（鸿蒙）+ 自托管 Supabase，端到端加密（PBKDF2 → UMK → HKDF → FDK → AES-256-GCM）
- 约 350 条单测 + 16/16 RPC 测试 + 真机验证清单

## 三阶段时间线

```text
阶段 A 业务骨架（09-05 ~ 09-08）
  PRD → 数据模型 → 技术方案 → 原型 → W1~W6：加密、快照、同步、OCR、家庭协作

阶段 B 落地打磨（~09-20 后，v0.1.0 → 0.1.5）
  品牌定名「家资」、真机 APK、月度台账口径、趋势图、登录持久化

阶段 C 去 Expo + 鸿蒙化 + 上架（09-26 ~ 27，v0.1.6 → 0.1.8）
  去 Expo 重建 Android 工程 → 鸿蒙 RNOH 工程 → 三场白屏攻坚
  → 自研 TurboModule 把登录从 76 秒干到 677ms → 提交上架
```

## AI 怎么协作的：四条经验

1. **决策给选项，不替人拍板**：单家庭 vs 多家庭、是否下沉原生等，都先给 2~3 个方案和代价，人选，AI 执行，结论进决策矩阵。
2. **文档先行**：PRD → 数据模型 → 技术方案 → ADR → 代码 → 测试 → 真机验证。任何业务规则都能在文档或测试里找到出处。
3. **项目记忆续命**：长周期会话必然丢上下文，把硬约束和踩坑实时写进项目记忆（如「RN 0.77 必须配 Kotlin 2.0.21」），下次自动加载不重犯。
4. **安全红线：AI 不碰密码**。签名证书走 DevEco 向导由人生成，AI 只管工程配置；签名产物全部 gitignore。

## 最值钱的五个坑

**① 鸿蒙白屏剥洋葱，要三层打穿**
1. RNOH 缺部分 delegate 基类 → `require('tamagui')` 求值抛异常，metro 静默返回 undefined → 脚本从 .ios.js 生成缺失的 `.harmony.js` 桩文件；
2. Keychain 适配层没打进 bundle → `extraNodeModules` 在 RNOH 链上不可靠，改用 metro `resolveRequest` 硬拦截返回 `{ filePath, type: 'sourceFile' }`；
3. 终极根因：`react-native-screens@4.9.0` + `native-stack` 在 ArkUI 上**挂载了但不渲染子树**（用 `hdc uitest dumpLayout` 才看到）→ 鸿蒙换纯 JS `@react-navigation/stack`，Android 保持原生 stack。

> 排查法：裸 View+Text 最小渲染测试 → dumpLayout 看原生树 → 分层隔离（View → 导航 → UI 库 → 业务页）→ 反查 bundle 确认代码真进去了。

**② 纯 JS 加密在鸿蒙上是灾难**：Hermes 无 JIT，PBKDF2 10 万次实测 **76,145ms** 且冻结 UI。自研 CryptoPbkdf2 TurboModule（ArkTS 调 cryptoFramework + C++ 头文件包），降到 **104ms**（约 730 倍）。配合登录时序重排（鉴权 → 立即进主页 → 两帧后派生密钥 → 后台同步），总耗时 **677ms**。

**③ 误导性报错别当真**：TurboModule 异步方法误用同步宏 `ARK_METHOD_METADATA`，报的是 `Found invalid character when decoding base64 string`——和 Base64 毫无关系。跨端平台报错措辞经常指错方向。

**④ Windows + monorepo 三连**：`settings.gradle` 的 gradle-plugin 要 pluginManagement 和 settings 级**双 includeBuild**；RN 0.77 钉 Kotlin **2.0.21**（沿用旧的会报 SoftwareComponent 错）；ohpm 用 `file:` 直引 HAR 会超 MAX_PATH → 走工程级 `overrides`。

**⑤ 鸿蒙改代码必须重打 bundle**：只跑 `assembleHap` 不更新 JS，会出现「包装了新版、页面还是旧版本号」。改动 TS/TSX 后先 `react-native bundle --platform harmony` 再打包。

## 可以直接照搬的

- 每个阶段一个 commit 收口 + 可验证产物（测试数/真机截图）
- 环境准备全部脚本化：一键 `pnpm harmony:prepare`（复制 HAR + 生成桩文件）
- 跨端差异只收敛在三个点：导航入口、metro 拦截、`platforms/` 目录，业务代码一份
- 性能问题**先量化再动手**：先测出 76 秒，再决定下沉原生，用前后数字验收
- 上架合规前置：隐私政策随仓库版本管理、截图按市场规格（1080×1920）批处理

## 需要谨慎的

- RNOH 版本必须与 RN 严格对齐，生态坑要有「白屏时间」预算
- 端到端加密 = 服务端无法聚合/搜索/推送，所有分析在客户端
- 去 Expo 是单向门：换来完全掌控，也接回所有原生维护责任

---

*详细版（含完整踩坑清单 17 条、版本记录、工程结构图）见《用AI端到端开发移动App-家资实践.md》。*
