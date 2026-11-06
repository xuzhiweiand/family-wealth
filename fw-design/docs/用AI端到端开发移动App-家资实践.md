# 用 AI 端到端开发一款家庭资产管理 App：从 PRD 到安卓、鸿蒙双端上架的实战复盘

> 家资（Family Wealth）——一个端到端加密的家庭资产记账工具。本文记录从 2026-09-05 需求萌芽，到 09-27 完成 Android 回归、HarmonyOS 鸿蒙化并提交应用市场审核的全过程。一人 + AI，约三周时间，8 个版本迭代，希望这份复盘能成为团队内「AI 辅助研发」的可复用参考。

---

## 一、项目概览（成果速览）

| 维度 | 内容 |
|---|---|
| **产品名** | 家资 |
| **一句话定位** | 端到端加密的家庭资产记账工具：净资产、趋势一目了然，数据只属于你自己 |
| **业务范围** | 11 类资产（存款、股票、基金、房产、车辆、数字货币、公积金、债务等）、多人家庭协作、快照趋势、OCR 录入、回收站 |
| **移动端** | **bare React Native 0.77.3** + TypeScript + pnpm workspaces（前期用 Expo SDK 52，后期去除） |
| **鸿蒙端** | **RNOH（@react-native-oh/react-native-harmony 0.77.74）**，DevEco SDK 5.0.0(12)，arm64-v8a |
| **导航/UI** | @react-navigation（Android/iOS 走 native-stack，鸿蒙走纯 JS stack）+ Tamagui + zustand |
| **后端** | 自托管 Supabase（Postgres + Auth + RPC + RLS） |
| **安全** | 端到端加密：PBKDF2 → UMK → HKDF → FDK → AES-256-GCM，服务端永远只有密文 |
| **本地持久化** | WatermelonDB + react-native-keychain（含鸿蒙适配层） |
| **真机** | Android 真机一台 + 华为 Mate X7（鸿蒙） |
| **当前版本** | **v0.1.8**：Android 已回归通过；鸿蒙 .app 包已提交 AppGallery Connect 审核 |
| **质量护栏** | 约 350 条单测（346 + 1 skipped）、RPC 测试 16/16、真机 UX 验证清单 |
| **仓库** | github.com/xuzhiweiand/family-wealth（public），主干分支 `chore/de-expo` |

几个关键数字：

- **76,145ms → 104ms**：鸿蒙上密码派生（PBKDF2 10 万次）从纯 JS 实现下沉到原生 TurboModule，提速约 **730 倍**；
- **677ms**：优化后鸿蒙冷启动到首页数据加载完成的总耗时；
- **8 个版本**：v0.1.0 → v0.1.8，每个版本都有真机验证；
- **一人 + AI**：全程没有第二位工程师参与代码评审或结对。

---

## 二、为什么这篇复盘值得看

这不是一个「AI 帮我写了个 demo」的故事，而是一个**用 AI 贯穿需求 → 架构 → 编码 → 测试 → 原生扩展 → 性能优化 → 上架**的完整工程案例。它有几个特殊之处：

1. **AI 不是替代开发，而是结对程序员**：所有关键决策都通过结构化选项由人拍板，AI 不替人做价值判断。
2. **文档先行，代码随后**：每轮写代码前先产出可共享的 PRD / 数据模型 / 技术方案 / ADR。
3. **跨端打到了鸿蒙**：不是停在 Android，而是趟过了 RNOH 工程搭建、白屏攻坚、原生 TurboModule 开发、上架审核全流程——这部分中文资料很少，是本文的重点补充。
4. **真机实测优先**：沙箱、模拟器、TypeScript 类型都可能骗人，一切结论以真机为准。
5. **真实环境噪音倒逼工程纪律**：依赖装不上、沙箱权限受限、Windows 路径超长、安全策略锁文件——这些约束反而沉淀出一套可复用的工作流。

---

## 三、整体时间线：三个阶段

```text
【阶段 A：业务骨架周 · 09-05 ~ 09-08】
09-05  需求定义 → PRD v2.1 → 鸿蒙适配评估 → 数据模型 → 技术方案 → 高保真原型
09-07  W1 脚手架（pnpm monorepo + Expo SDK 52 + 共享包 + Supabase 迁移 + CI）
       W2 端到端加密 + InMemoryAuthClient + Tamagui UI 基础
       W3 SupabaseAuthClient + WatermelonDB + keychain 持久化
       W4 资产录入/编辑 + OCR + 趋势三线 + 加密同步
09-08  W5 家庭共享/邀请码 + FDK 随机密钥模型 + RPC/RLS 权限
       W6 private 资产 + 角色订阅修复 + 回收站 + 技术债清理

【阶段 B：落地打磨 · 09-20 前后】
09-20  决策收口（单家庭/强制更新/暂不接第三方登录）；中文名「家资」、
       图标定稿、Android mipmap 全套生成、真机 APK 安装验证
之后   功能打磨 v0.1.0 → v0.1.5：月度台账口径、快照删除与墓碑同步、
       资产类型收敛、趋势图坐标轴、登录状态持久化等

【阶段 C：去 Expo + 双端 + 上架 · 09-26 ~ 09-27】
       ① 去除 Expo，bare RN 0.77.3，手动重建 Android 工程并适配 monorepo
       ② Android 真机回归通过，发版 v0.1.6（commit 6ccec8e）
       ③ 鸿蒙工程搭建：RNOH 0.77.74、HAR 准备、DevEco 工程文件、CMake
       ④ 白屏三场攻坚：模块求值异常 → 适配层拦截 → 导航库不渲染
       ⑤ 登录性能优化：自研 CryptoPbkdf2 TurboModule，v0.1.7（9150f97）
       ⑥ 图标修复 v0.1.8（2c603ec）、隐私政策（9fe80c1）
       ⑦ .app 包、截图、隐私政策提交 AppGallery Connect，等待审核
```

---

## 四、AI 协作工作流（方法论）

### 4.1 决策前先给选项，不替人拍板

几乎每一次产品或架构决策，AI 都先抛出 2–3 个选项，说明影响和代价，等人拍板后再动手。例如：

| 决策点 | 备选方案 | 最终选择 |
|---|---|---|
| 多家庭 UX | 单家庭 / 多家庭下拉切换 | 单家庭 |
| 回滚策略 | 强制更新 / 允许降级 | 强制更新 |
| 第三方登录 | Apple+微信 / 仅 Apple / 暂不接 | 暂不接 |
| 私有资产 | 计入家庭净资产 / 不计入 | 不计入 |
| 鸿蒙导航 | 强行适配 native-stack / 换纯 JS stack | 鸿蒙用 JS stack |
| 登录密钥派生 | 忍受 76 秒 / 下沉原生 TurboModule | 下沉原生 |

好处有两个：避免 AI 替人做价值判断；决策上下文自然沉淀进技术方案的决策矩阵，事后可追溯。

### 4.2 文档驱动，代码跟随

每进入新阶段，先改文档，确认后再写代码，测试用例紧跟着业务规则落地：

```text
PRD → 数据模型 → 技术方案 → ADR → 代码 → 单测/RPC 测试 → 真机验证
```

任何一条业务规则几乎都能在文档或测试里找到出处。项目沉淀的 ADR 覆盖了 UI 库选型、加密库选型、本地数据库、端侧 OCR、密钥轮换、FDK 随机密钥模型等关键决策。

### 4.3 一人分饰多角：架构师 / 开发 / QA / 运维 / 设计师

- **架构师**：里程碑路线图、WBS 拆解、风险清单；
- **开发**：RN 页面、Supabase 迁移、加密库、OCR、同步、ArkTS/C++ 原生模块；
- **QA**：jest 单测、RPC 测试、性能护栏、OCR 语料回归；
- **DevOps**：GitHub Actions CI、签名与构建脚本、真机验证清单；
- **设计师**：应用图标迭代（模型读不了图时，靠精确文字描述 + 用户确认）。

### 4.4 长周期项目靠「记忆」续命

三周跨度、经历多次会话上下文丢失，靠的是项目记忆机制：把**硬约束、工程约定、踩过的坑**持续写入项目记忆，下一次会话自动加载。例如「RN 0.77 必须配 Kotlin 2.0.21」「鸿蒙改 TS 后必须重打 bundle」这类结论，一旦写过就不会重犯。对 AI 辅助的长周期项目，建议从第一天就维护这样一份活文档。

### 4.5 真机实测优先于静态检查

项目有一条铁律：**当类型签名与运行时行为冲突时，以真机结果为准**。典型例子：TypeScript 认为某个适配存在，但鸿蒙真机上模块根本没被打进 bundle；C++ 头文件编译通过，运行时却 dlopen 失败。静态分析只能排除一部分问题，原生跨端开发必须在真机闭环。

### 4.6 安全边界：AI 不碰密钥与密码

这是一条主动设计的红线：

- 自托管 Supabase 的密钥、应用签名证书密码、Keystore 密码**一律不进入对话和代码**；
- 发布证书通过 DevEco Studio 的签名向导由人自行生成，AI 只负责工程配置和脚本；
- 签名产物（`*.p12 / *.cer / *.p7b / signing/`）全部加入 `.gitignore`。

这既避免了凭据泄露，也让 AI 工具链的权限策略保持最小化。

---

## 五、业务技术方案亮点

### 5.1 端到端加密：服务端永远看不到明文

```text
用户密码
   │
   ▼
PBKDF2 (100k iterations)
   │
   ▼
UMK（用户主密钥，仅存内存）
   │
   ▼
HKDF ─────────► FDK（家庭级随机密钥）
   │              │
   ▼              ▼
 encrypt salt   AES-256-GCM envelope
（存 keychain）   （资产/快照 JSON 密文）
```

关键点：

- **FDK 是家庭级随机密钥**，不从 UMK 派生；成员退出时可轮换密钥、切断其新数据访问；
- salt 用 keychain 持久化；UMK 仅存内存，退后台一段时间后清空；
- 趋势聚合、净资产计算**全部在客户端完成**——服务端只有密文，想算也算不了。

### 5.2 单表继承 + 快照驱动趋势

11 类资产共用一张 `assets` 表，差异字段塞进加密 JSON 元数据；金额每次变更写一条 `asset_snapshots`，趋势图的唯一数据源就是快照表。

```text
assets
  ├── id / family_id / owner_id
  ├── visibility (family/private)
  ├── encrypted_envelope
  └── deleted_at

asset_snapshots
  ├── asset_id / captured_at
  ├── amount_cents
  └── source (manual | ocr | sync)
```

两个容易被忽略、但直接影响数字正确性的口径：

- **月度台账口径**：总览卡片只统计当月有快照的资产、每笔取当月最新快照，跨月补录不加总——用户把每月补录视为对同一账户的月度报表；
- **同日快照裁决**：capturedAt 相同（同日修正重录）时后写入的胜出。

### 5.3 软删 + 回收站 + 删除墓碑

所有业务表带 `deleted_at`；资产恢复时**故意不写新快照**，否则趋势图会出现「0 → 原金额」的假暴涨。快照删除则是物理移除 + 云端 `deleted_at` 墓碑上行，拉取端对墓碑做幂等处理。

### 5.4 三级角色 + 资产级 ACL

家庭内角色 **owner > editor > viewer**，权限裁决集中在纯函数：

```ts
function canDoOnAsset({ role, visibility, isOwn }, action): boolean
```

私有资产只对本人可见、不计入家庭净资产，UI 统一走 `filterVisibleAssets`；服务端用 Postgres RPC + RLS 兜底，共 16 条 RPC 权限测试。

### 5.5 OCR：端侧优先 + 语料护栏

OCR 分三层：候选提取（关键字 > 货币符号 > 裸数字打分）→ 去噪（日期/卡号/手机号/百分比）→ 单位换算（万/亿、负数、点选）。真机样本以 JSONL 追加进语料库（gitignored），CI 用同一套护栏跑回归。

---

## 六、去 Expo：bare RN 与 Android 工程重建

### 6.1 为什么主动去掉 Expo

鸿蒙化是直接动因，也是长期维护的选择：

1. 鸿蒙端需要完全自定义的 metro 平台（`--platform harmony`）、原生模块和构建产物，Expo 的托管/预构建模型管不到；
2. monorepo 下 Expo 预构建对自定义原生目录不友好，`prebuild --clean` 还会反复删除 `local.properties`、重置 gradle 配置甚至 keystore；
3. 自己掌控 `android/` 后，依赖 autolink、Kotlin 版本、构建脚本全部透明可查。

### 6.2 重建过程

- 用 `@react-native-community/cli init` 生成 RN 0.77.3 裸模板，手工适配 pnpm monorepo，并把 `android/` 正式纳入 Git（此前 `.gitignore` 忽略该目录，导致原生工程无法协作）；
- 所有路径类配置显式指向仓库根的 `node_modules`（从 `android/app/` 上溯四级）；
- 鸿蒙专用包（10 个 `@react-native-ohos/*`）和 reanimated 排除 Android/iOS autolink，否则 duplicate class：

```js
// apps/mobile/react-native.config.js（示意）
module.exports = {
  dependencies: {
    'react-native-reanimated': { platforms: { android: null, ios: null } },
    // 10 个 @react-native-ohos/* 全部排除
  },
};
```

- `android/settings.gradle` 有个隐蔽点：gradle-plugin 需要**两处** `includeBuild`——pluginManagement 内一份、settings 级一份，再配合 `com.facebook.react.settings` 的 `autolinkLibrariesFromCommand`；
- RN 0.77 版本 catalog 钉的 Kotlin 是 **2.0.21**。若沿用 Expo 时期的 1.9.24 覆盖，会在配置阶段报 `Could not get unknown property 'release' for SoftwareComponent container`——**升级 RN 后第一件事就是核对 Kotlin 版本**；
- 还为 `@react-native/community-cli-plugin` 打了个小补丁：`runServer.js` 的 `unstable_extraMiddleware` 要 `.filter(Boolean)`，否则新版 cli-server-api 缺少 `indexPageMiddleware`，Metro 一启动就报 undefined 'handle'。

### 6.3 bare RN 的 polyfill 纪律

去除 Expo 后，Hermes 缺失的 Web API 必须在 `index.js` 顶部按顺序显式 polyfill：

```text
react-native-get-random-values
→ react-native-url-polyfill/auto      （URL.protocol，supabase-js 依赖）
→ fast-text-encoding                  （TextEncoder/TextDecoder，envelope 编解码依赖）
→ react-native-gesture-handler
```

顺序错或漏掉一个，表现极其迷惑：TextEncoder 缺失时解密**静默失败**，业务层报 `wrapped fdk malformed`，最终现象是「登录成功但云端数据为空」。这类问题只能靠真机端到端验证暴露。

---

## 七、鸿蒙化实战：RNOH 工程全记录

### 7.1 选型：RNOH，且版本必须严格对齐

鸿蒙上跑 RN 的现实选择是 **RNOH（React Native OpenHarmony）**。注意它的版本号必须与 RN 版本匹配：本项目用 RN 0.77.3 对应 RNOH **0.77.74**，小版本错位都可能引发编译或运行问题。

### 7.2 工程骨架与 HAR 处理

`apps/mobile/harmony/` 的核心结构：

```text
harmony/
├── AppScope/app.json5            # 应用级配置（图标、版本号）
├── hvigorfile.ts + hvigor/       # 构建脚本与配置
├── entry/
│   ├── src/main/ets/             # ArkTS：Ability、TurboModule
│   ├── src/main/cpp/             # C++：PackageProvider、NapiBridge、CMake
│   ├── src/main/resources/       # 图标、rawfile（RN bundle 输出目录）
│   ├── module.json5 / build-profile.json5 / hvigorfile.ts
│   └── oh-package.json5
├── libs/                         # 3 个 HAR（gitignored）
└── RNOH cpp/                     # RNOH 框架 C++ 源码
```

几个非显而易见的必备项：

- **HAR 不入 Git**：RNOH npm 包自带 3 个 HAR，debug 单文件 128MB，超过 GitHub 100MB 限制。用 `prepare-harmony-hars.cjs` 在 postinstall / 一键命令 `pnpm harmony:prepare` 时复制到 `harmony/libs`；
- **缺失桩文件脚本化生成**：`prepare-harmony-stubs.cjs` 从 `.ios.js` 生成 3 个缺失的 `.harmony.js`（legacySendAccessibilityEvent / RCTNetworking / ReactDevToolsSettingsManager），这是 RNOH 0.77.74 与 RN 0.77.3 打包所必需的；
- **HAR 引用走工程级 overrides**：Windows 上用 `file:../libs/xxx.har` 直引会让 ohpm 临时目录超过 MAX_PATH（260 字符），引发 EPERM rename；在 `oh-package.json5` 的 `overrides` 里指定版本/路径即可；
- **工程文件一个不能少**：AppScope/app.json5、工程级 + 模块级 hvigorfile.ts、hvigor-config.json5；`main_pages.json` 的 src 必须是字符串数组 `["pages/Index"]`；`build-profile.json5` 同时设置 compatible/targetSdkVersion = `"5.0.0(12)"`；abiFilters 只留 `arm64-v8a`；
- **RN 启动入口** `harmony/index.js`：

  ```js
  import { AppRegistry } from 'react-native';
  import App from '../App';
  AppRegistry.registerComponent('familywealth', () => App);
  ```

  缺失时报错极具迷惑性：运行时 `Couldn't create bindings ... libRNOHApp is undefined`；
- **CMakeLists.txt** 必须真的构建库：`add_subdirectory(RNOH cpp)` → 编译 `rnoh_app` SHARED（PackageProvider.cpp + RNOHAppNapiBridge.cpp）→ `target_link_libraries(rnoh_app PUBLIC rnoh)`。全是注释的话，HAP 里缺 `librnoh_app.so`，启动 dlopen 直接崩溃。

### 7.3 白屏三场攻坚（最有价值的部分）

鸿蒙化一半时间在打白屏。三层问题剥洋葱式出现：

**第一战：模块求值抛异常，metro 静默返回 undefined**

现象：应用启动后白屏，无任何报错弹窗。日志深处发现 `require('tamagui')` 抛出 `Unsupported by the platform`，metro 捕获模块求值异常后返回 `undefined`，导致 `<TamaguiProvider>` 渲染失败。根因是 RNOH 未提供部分 RN delegate 基类的鸿蒙实现（如 `BaseAlertDelegate.prompt`、`BaseTextInputStateDelegate.blur/focus` 等），非 iOS/Android 平台直接抛异常。7.2 中的桩文件生成正是为此补上缺口。

**第二战：Keychain 适配层没打进 bundle**

鸿蒙没有 iOS Keychain，我们写了平台适配层（`src/platforms/harmony/index.ts`），但真机上仍加载到了真包。排查发现两个坑：

1. 业务代码里的 `isHarmony` 检测在打包期失效；
2. metro 的 `extraNodeModules` 指向无 package.json 的目录时，经 RNOH resolveRequest 链 fallback 后映射不生效。

可靠解法是在 `metro.config.js` 中用自定义 **resolveRequest 硬拦截**，直接返回 `{ filePath, type: 'sourceFile' }`：

```js
// 拦截 react-native-keychain、@react-native-ml-kit/text-recognition 等
resolveRequest: (context, moduleName, platform) => {
  if (moduleName === 'react-native-keychain' && isHarmonyBuild) {
    return { filePath: require.resolve('./src/platforms/harmony'), type: 'sourceFile' };
  }
  return context.resolveRequest(context, moduleName, platform);
}
```

顺带一个 metro 配置坑：判断平台不能写 `process.argv.includes('--platform harmony')`——argv 里参数和值是空格分隔的独立项，要用 `findIndex('--platform')` 再取下一项；harmony 平台声明为 `platforms: ['harmony', 'native']`。

**第三战（终极）：react-native-screens + native-stack 子树不渲染**

前两战解决后依然白屏。用 `hdc uitest dumpLayout` 导出 ArkUI 布局树，发现 RNSScreen 的原生骨架挂载成功，但**子组件 insert 后不可见**——`@react-native-ohos/react-native-screens@4.9.0` 与 `@react-navigation/native-stack` 的组合在 ArkUI 上不渲染子树。解法：**按平台分流导航**，鸿蒙端改用 `@react-navigation/stack`（纯 JS 实现，走普通 View），Android/iOS 保持 `createNativeStackNavigator`：

```ts
export const RootStack = isHarmony
  ? createStackNavigator()        // 纯 JS stack，鸿蒙可见
  : createNativeStackNavigator(); // 原生 stack，双端体验更好
```

### 7.4 白屏排查方法论（可直接套用）

三场战役沉淀出一套跨端白屏排查法：

1. **最小化渲染测试**：先让一个红底白字的裸 `<View><Text>` 跑起来，确认 RN → ArkUI 基础管线通畅；
2. **看原生树而不只看 JS 日志**：`hdc shell uitest dumpLayout` 导出 ArkUI 树，能区分「组件没挂载」和「挂载了但不可见」；
3. **分层隔离**：基础 View → 导航库 → UI 库（Tamagui）→ 业务页面，逐层接入，白屏复现在哪层就锁定哪层；
4. **反查 bundle 内容**：确认适配层代码确实被打进去了，不要相信「我配过了」。

### 7.5 TurboModule 性能攻坚：把 76 秒干到 104ms

这是鸿蒙化中技术含量最高的一段。

**问题**：鸿蒙 Hermes 没有 JIT，`@noble/hashes` 的纯 JS PBKDF2-SHA256 10 万次迭代实测 **76,145ms**，且冻结 JS 线程——用户点完登录要等一分多钟。

**方案：自研 CryptoPbkdf2 TurboModule，计算下沉原生**

- **ArkTS 侧**：`entry/src/main/ets/turbo/CryptoPbkdf2TurboModule.ets`，调用鸿蒙 `cryptoFramework.createKdf('PBKDF2|SHA256')`（API 11+），异步 `generateSecret`；
- **C++ 侧**：header-only 的 `CryptoPbkdf2Package.h`，在 ArkTS Index 与 `PackageProvider.cpp` 双注册；
- 业务侧 crypto 包提供统一入口 `deriveUMKFast`：鸿蒙走原生，其他平台回落纯 JS，业务代码不再直接调用同步派生。

效果：**104ms**，提速约 730 倍，且不阻塞 JS 线程。

**一个极具误导性的坑**：RNOH 的 TurboModule 方法元数据宏不能混用——异步/Promise 方法必须用 `ARK_ASYNC_METHOD_METADATA`。误用同步宏后，ArkTS async 方法执行异常，报出的错误是 `Found invalid character when decoding base64 string`，让人疯狂排查 Base64 字母表（实际字母表根本没问题）。看到这个报错先检查宏。

**配套的登录时序重排**（光把 KDF 加速还不够，流程也要重排）：

```text
① 网络鉴权（Supabase auth）
② set authenticated → AuthGuard 立即放行进主页
③ 两帧 rAF 后再派生 UMK（不抢首屏）
④ 后台 refresh family / load assets / sync
```

另用 AsyncStorage 做了 `login-cache`（salt/envelope/displayName），命中时省掉一次 profiles 网络往返。最终鸿蒙上：门禁约 **518ms**，完整登录到数据加载约 **677ms**。详细方案见附件中的性能报告。

### 7.6 构建、签名与上架

**构建命令**：鸿蒙不用 npx hvigorw，而是用 DevEco 自带的 `tools\hvigor\bin\hvigorw.bat`，并显式设置 SDK 环境；daemon OOM 时加 `--no-daemon`：

```powershell
$env:DEVECO_SDK_HOME = "C:\Program Files\Huawei\DevEco Studio\sdk"
```

**改 TS/TSX 后必须重打 RN bundle**，只跑 hvigor/assembleHap 不会更新 JS 代码（曾因此出现「HAP 是新的，Me 页还显示旧版本号」）：

```bash
react-native bundle --platform harmony --dev false --entry-file index.js \
  --bundle-output harmony/entry/src/main/resources/rawfile/bundle/index.harmony.bundle \
  --assets-dest harmony/entry/src/main/resources/rawfile/ --minify
```

**签名**：发布证书（.p12）、CSR、AGC 签发证书（.cer）和发布 Profile（.p7b）通过 DevEco「Project Structure → Signing Configs」向导完成，密码不经 AI；签名文件全部 gitignore。

**图标（v0.1.8）**：鸿蒙图标三处引用缺一不可——AppScope 桌面图标、module.json5 的 ability icon 和 startWindowIcon。原有三个占位 PNG 是损坏文件（85/60/61 字节的非法 PNG），且对应路径被工具安全策略锁定无法覆盖，最终改用**新文件名**（app_icon_fw / ability_icon / splash_icon）并更新三处引用解决。

**上架材料**：

- 类目选「实用工具 - 记账」，避开需要金融资质的类目；
- 隐私政策托管在 GitHub（公网可访问的 markdown 渲染 URL），随仓库一起版本管理；
- 截图严格按市场规格：将真机截图（1080×2444）等比缩放到高 1920，置于 1080 宽画布居中，两侧填充 `#F7F8FA` 背景，输出 5 张 1080×1920 JPEG（首页/资产/录入/趋势/我的）。

---

## 八、版本与提交记录

| 版本 | 主要内容 | 提交 |
|---|---|---|
| W1–W6 | 业务骨架：加密、快照、同步、OCR、家庭协作、权限 | 每周一个收口 commit |
| v0.1.x（至 0.1.5） | 月度台账口径、快照删除、类型收敛、趋势图、登录持久化 | — |
| v0.1.6 | 去 Expo、Android 工程重建、真机回归 | `6ccec8e` |
| v0.1.7 | CryptoPbkdf2 TurboModule、登录时序重排、login-cache | `9150f97` |
| v0.1.8 | 鸿蒙图标三引用修复 | `2c603ec` |
| 配套 | 隐私政策文档 | `9fe80c1` |

版本号统一维护在 5 处：Android `build.gradle`（versionCode 9）、鸿蒙 `AppScope/app.json5`（versionCode 1000003）、`apps/mobile/package.json`、Me 页展示、鸿蒙平台 index——每发版逐处核对，避免出现「系统里是新版、关于页是旧版」。

---

## 九、踩坑清单（按域分类，可直接复用）

### Windows + monorepo 工程类

1. **settings.gradle 要双 includeBuild**：pluginManagement 内和 settings 级各引一次 gradle-plugin，缺一个构建行为就异常。
2. **Kotlin 版本必须对齐 RN catalog**：0.77 钉 2.0.21；沿用旧覆盖会报 SoftwareComponent 'release' 错误。升级 RN 后第一件事核对它。
3. **community-cli-plugin 需补丁**：middleware 数组 `.filter(Boolean)`，否则 Metro 启动报 undefined 'handle'。
4. **鸿蒙包必须排除 Android autolink**：10 个 `@react-native-ohos/*` 加 reanimated 全部在 react-native.config.js 里关掉，否则 duplicate class。
5. **自托管后端 + 明文 HTTP**：release 包要显式允许 cleartext traffic（Android 9+ 默认禁），否则所有 fetch 静默网络异常。

### 鸿蒙（RNOH）类

6. **HAR 太大不入 Git**：prepare 脚本复制 HAR + 从 .ios.js 生成缺失 .harmony.js，一键 `pnpm harmony:prepare`。
7. **ohpm 别在 Windows 上 file: 直引 HAR**：临时目录超 MAX_PATH → EPERM；走工程级 overrides。
8. **平台适配用 resolveRequest 硬拦截**：extraNodeModules 在 RNOH 链上不可靠；平台检测用 findIndex 解析 argv。
9. **screens + native-stack 鸿蒙不渲染子树**：鸿蒙换纯 JS `@react-navigation/stack`，双端分流。
10. **异步 TurboModule 必须 ARK_ASYNC_METHOD_METADATA**：用错会报误导性的 base64 错误。
11. **改 TS 后必须重打 harmony bundle**：assembleHap 不更新 JS；纯资源/配置改动才不用。
12. **hvigor 用 DevEco 自带 hvigorw.bat + DEVECO_SDK_HOME**；OOM 加 --no-daemon。
13. **polyfill 顺序与缺失项**：TextEncoder 缺失会导致解密静默失败、云端数据看似为空。
14. **图标三处引用 + 锁定文件改新名**：AppScope icon、ability icon、startWindowIcon 必须同时有效。

### AI 协作类

15. **同一文件的多个编辑合并成一次**，避免连续 Edit 丢改动；commit 前必看 `git diff --cached --stat`。
16. **AI 不接触密码凭据**：签名走 IDE 向导，产物 gitignore；被安全策略锁定的文件不要硬覆盖，换路径/换文件名解决。
17. **沙箱里装不上依赖时**：用 lockfile-only 校验依赖、代码先按接口占位，把真机验证作为最终门。

---

## 十、给同事的复用建议

### 可以直接照搬的

- **文档先行链路**：PRD → 数据模型 → 技术方案 → ADR → 代码 → 测试 → 真机验证；
- **选项式决策**：重大选择先给 2–3 个方案和代价，结论记入决策矩阵；
- **阶段粒度收口**：每个 Phase 一个 commit、一组可验证产物（测试数 / 真机截图）；
- **跨端差异收敛到适配层**：平台分流只存在于导航入口、metro 拦截、`platforms/` 目录，业务代码保持一份；
- **环境准备全部脚本化**：如 `harmony:prepare`，新人（及未来的自己）一条命令恢复工程；
- **性能问题先量化再动手**：先测真实耗时（76,145ms），再决定下沉原生，用前后对比数字验收；
- **维护项目记忆**：硬约束、约定、踩坑实时记录，跨会话不重犯。

### 需要谨慎评估的

- **RNOH 仍在快速演进**：版本必须与 RN 严格对齐；缺失的 delegate、screens 渲染问题、异步宏这类坑要有心理预期，预留专门的「白屏时间」；
- **端到端加密是双刃剑**：服务端无法聚合/搜索/推送，所有分析在客户端；注册/登录链路也因此更复杂；
- **华为无 GMS**：Google ML Kit 等服务不可用，OCR 等能力要准备 HMS 或端侧/云侧替代；
- **上架合规前置**：记账类目相对安全，但隐私政策、数据加密说明、截图规格最好在开发末期前就准备，避免卡在审核；
- **去 Expo 是单向门**：换来完全掌控，也意味着原生工程的所有维护责任回到自己身上，小团队需权衡。

---

## 十一、当前状态与下一步

截至 2026-09-27：

- Android release APK 真机回归通过（登录、同步、首页趋势、资产分布饼图、录入、我的页均正常）；
- 鸿蒙 v0.1.8 运行于 Mate X7：登录约 677ms，五大页面功能正常，图标已修复；
- .app 包、5 张截图、隐私政策、应用文案已提交 AppGallery Connect，**等待审核**；
- 质量护栏：346 单测 + 1 skipped、RPC 16/16。

后续路线：跟进审核反馈 → 合并主干 → 视需要补 iOS → 推送提醒与更多分析维度。

---

## 十二、附件索引

| 文档 / 产物 | 位置 |
|---|---|
| 需求定义 PRD v2.1 | `documents/家庭资产管理App-需求定义.md` |
| 数据模型设计 | `documents/数据模型设计.md` |
| 技术方案设计 | `documents/技术方案设计.md` |
| 鸿蒙适配评估（前期） | `documents/鸿蒙适配方案评估.md` |
| 去 Expo / bare RN 迁移文档 | `.trae/documents/de-expo-bare-rn-migration.md` |
| 登录性能优化报告（v0.1.7） | `.trae/documents/login-performance-0.1.7.md` |
| 隐私政策 | `.trae/documents/privacy-policy.md`（同时托管于 GitHub） |
| 上架截图 ×5（1080×1920） | `.trae/documents/screenshots/` |
| 高保真原型 | `prototype/index.html` + `prototype/screenshots/` |
| 真机 UX 验证清单 | 仓库 `docs/device-ux-verification.md` |
| 项目仓库 | github.com/xuzhiweiand/family-wealth |

---

*写于 2026-09-27。从一行需求到双端上架，AI 承担了绝大部分执行，而人负责决策、审美、安全边界和真机上的最后一次点击。如果你也在尝试用 AI 端到端做移动 App，希望这份复盘能帮你少踩几个坑、少熬几个白屏之夜。*
