# 真机 prebuild + UX 验证清单（华为 Mate 40 Pro）

> 目标设备：**华为 Mate 40 Pro（NOH-AN00）**，HarmonyOS 4，底层 Android 12（API 31）
>
> 本清单把 W1–W6 所有只在沙箱里验证过的功能，串成一条「照着做就能走完」的真机验证路径。

---

## 0. 先读这段：本次验证的范围与已知 gap

这次真机验证的目的，是**首次拉通三个 native 模块（keychain / WatermelonDB / ML Kit）**，并确认 W6 phase 3 的 UI 链路（private 开关、详情/编辑、回收站、useMyFamilyRole 修复、Alert 确认）在真机上行为正确。

**三件事提前说清，避免验证时误判为 bug：**

1. **资产数据不持久（预期行为）**。当前 `bootstrap.ts` 里 `assetRepository = new InMemoryAssetRepository()`——资产存在内存里，杀进程即丢。WatermelonDB 仓储已经写好了（`packages/db/src/watermelon/`），但还没接进 bootstrap，那是后续阶段的工作。所以：**登录态能跨重启恢复（keychain 存了 session），但资产列表重启后是空的**。
2. **端侧 OCR 在这台设备上不可用（预期行为）**。华为 Mate 40 Pro 因美国制裁**没有 Google Play 服务（GMS）**，而 ML Kit 文本识别依赖 GMS 下发模型。点「拍照识别金额」会走到降级分支——这正是本次要验证的对象。
3. **不配 Supabase 环境变量 = 内存 mock**。`bootstrap.ts` 没有 `EXPO_PUBLIC_SUPABASE_URL` / `ANON_KEY` 时回退到 `InMemoryAuthClient`，此时「注册/登录/建家/邀请」都是内存假数据，测不出真实链路。**要测真实鉴权和家庭共享 RPC，必须先备好 Supabase 后端（见 §2）。**

---

## 1. 设备与环境前提

### 1.1 设备

| 项 | 值 |
|---|---|
| 型号 | 华为 Mate 40 Pro（NOH-AN00） |
| 系统 | HarmonyOS 4（底层 Android 12 / API 31） |
| GMS | **无**（HMS 替代） |
| 最低 SDK 要求 | RN 0.76 minSdk = 24，API 31 满足 ✅ |

### 1.2 Windows 侧工具

- Node 22.22.2（managed）：`C:\Users\xuzhiweiand\.workbuddy\binaries\node\versions\22.22.2-2\node.exe`
- pnpm 9.15.0（managed workspace 的 `.bin\pnpm`）
- **Android SDK + adb**（Android Studio 自带，或单独装 platform-tools）
- **华为 USB 驱动**（Windows 识别华为设备需要；装「华为手机助手 HiSuite」会自动带驱动，或从华为官网下载）

### 1.3 华为设备连接（先打通再 prebuild）

1. 手机：设置 → 关于手机 → 连点「版本号」7 次，开启**开发者选项**
2. 设置 → 系统和更新 → 开发人员选项：
   - 打开 **USB 调试**
   - 打开 **「仅充电」模式下允许 ADB 调试**（华为特有，否则插线只在充电模式）
3. USB 数据线连电脑，手机上弹「允许 USB 调试」→ 勾选「始终允许」→ 确定
4. 验证：
   ```bash
   adb devices
   # 应列出设备，状态为 device（不是 unauthorized）
   ```
   若显示 `unauthorized`，回手机重新点授权；若根本列不出，是驱动没装（装 HiSuite）。

> ⚠️ 华为手机默认走「传输文件」MTP，`adb devices` 能识别即可，不用切模式。

---

## 2. Supabase 后端准备（前置，二选一）

### 2.1 推荐：云上免费项目（真机直接连公网）

1. 登录 [supabase.com](https://supabase.com) 新建一个免费项目（region 选近的，如 Singapore / Tokyo）
2. 应用 5 个迁移（项目根 `supabase/migrations/` 下，按文件名顺序）：
   ```bash
   cd family-wealth
   npx supabase link --project-ref <你的 project-ref>
   npx supabase db push
   ```
   （没有 supabase CLI 就 `npm i -g supabase`，或直接在 Supabase Dashboard 的 SQL Editor 里按顺序贴这 5 个 `.sql`）
3. 记下 Project Settings → API 里的 **Project URL** 和 **anon public key**

### 2.2 备选：本地 `supabase start`（有局域网坑）

```bash
cd family-wealth
npx supabase start
```

坑：**手机连不到 `localhost`**（localhost 在手机上指手机自己）。要用电脑的局域网 IP：

```bash
# 查电脑局域网 IP（Windows）
ipconfig   # 找 IPv4，如 192.168.1.23
```

- `EXPO_PUBLIC_SUPABASE_URL` 写成 `http://192.168.1.23:54321`
- 手机和电脑必须在**同一 WiFi**
- supabase 默认只监听 localhost，需在 `supabase/config.toml` 把 `[api]` 的监听地址改成可被局域网访问，否则手机连不上

> 所以**云项目更省事**，本地 start 只在「没网 / 不想注册」时用。

---

## 3. 环境变量配置

在 `apps/mobile/` 下建 `.env`（Expo 自动读取 `EXPO_PUBLIC_*` 前缀）：

```bash
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

> 不配这两个，App 走 InMemoryAuthClient，能测 UI 但测不了真实鉴权/家庭共享。想先快速看 UI 也可以不配。

---

## 4. prebuild 流程

```bash
cd family-wealth
pnpm install            # 真机上必须跑全量（沙箱装不了 native 模块）

cd apps/mobile
pnpm prebuild           # 生成 android/ 目录（首次）
pnpm android            # 编译 + 安装到华为 + 启动 Metro
```

- 首次编译较久（下载 gradle 依赖 + native 编译），耐心等
- 若改过依赖需要重生成：`pnpm prebuild --clean`
- 华为首次安装会提示「外部来源应用」，允许即可

**启动后看 Metro 是否报红**。重点确认三个 native 模块没在启动时抛 `Cannot find module`：
- `react-native-keychain`
- `@nozbe/watermelondb`（若 bootstrap 后续接入）
- `@react-native-ml-kit/text-recognition`（该库是**延迟 require**，启动不崩，识别时才崩）

---

## 5. 验证清单（核心链路）

> 每项：**步骤 → 预期 → 通过标准**。用真实 Supabase 时，注册两个账号（A 当 owner，B 当被邀请者）便于测家庭共享。

### 5.1 注册 / 登录

- 步骤：注册新账号 A → 登出 → 用 A 登录
- 预期：注册后进入首页（家庭页），登出回登录页
- 通过：登录后底部/顶部能看到家庭页入口；**杀掉 App 重开，仍保持登录**（keychain session 生效）

### 5.2 keychain 持久化（关键 native 验证）

- 步骤：登录后完全杀掉进程（从最近任务划掉，不是退后台）→ 重开 App
- 预期：**直接进入已登录态**，不回到登录页
- 通过：重开后无需重新输密码。这验证了 `react-native-keychain` 的 `setGenericPassword`/`getGenericPassword` 在华为 Keystore 上真实可用（之前只在沙箱 lockfile 层面验证过）

### 5.3 建家 / 邀请 / 加入（家庭共享 RPC）

- 步骤：A 建家 → 生成邀请码 → B 登录后输入邀请码加入
- 预期：B 加入后能看到家庭资产；A 能看到成员列表里有 B
- 通过：跨账号的家庭共享闭环走通（真实 Supabase 下走 `create_family` / `claim_invite` / `finalize_join` RPC）

### 5.4 录资产（含 private 开关）

- 步骤：A 录一条**家庭可见**资产，再录一条**private（仅自己可见）**资产
- 预期：录入页有「私有/家庭」的 Switch；viewer 角色（B）看到私有资产的入口被隐藏/禁用
- 通过：两条资产都成功保存；B 登录后**看不到** A 的 private 资产

### 5.5 趋势图（三线 + 私有不计入）

- 步骤：回首页看趋势图；对比「含 private」和「不含 private」的净资产
- 预期：趋势图有三线（净值/资产/负债）；**private 资产不计入家庭净资产**
- 通过：切到 B 视角，净资产数字不含 A 的 private 资产；三线曲线正常渲染（无假暴涨、无 0 起跳）

### 5.6 详情 / 编辑

- 步骤：点资产卡片进详情 → 编辑 → 只改名字保存；再改金额保存
- 预期：改名字**不**新增快照，改金额**才**写快照；详情页能看到最近 20 条快照
- 通过：详情页快照数只在「改金额」时 +1；编辑页按钮在「无改动」时是 disabled

### 5.7 删除 / 回收站 / 恢复

- 步骤：删一条资产 → 去家庭页「回收站」→ 恢复
- 预期：删除走 `Alert.alert` 确认（**不是** `window.confirm`——那是真机 bug 已修）；回收站列出软删资产；恢复后回到列表
- 通过：删除有弹窗确认；恢复后资产回到原列表，趋势图曲线接回原值（无假暴涨）

### 5.8 useMyFamilyRole 修复验证

- 步骤：A 登录 → 看 A 的权限（能录、能删）→ 登出 → 登 B → 看 B 的权限（viewer 受限）
- 预期：**切换账号后，按钮/入口立即按新角色重渲染**（不重渲染是已修的 bug）
- 通过：A 能看到录入按钮、B 看不到；切账号时无需手动刷新页面

### 5.9 tamagui 真机渲染

- 步骤：过一遍首页/详情/录入页，看排版
- 预期：Tamagui 组件（Button/Card/XStack/YStack）正常渲染，主题色正确
- 通过：无白屏、无「组件未渲染」；沙箱里报的「tamagui 没导出 Button」在真机应消失

---

## 6. OCR 专项（无 GMS）

### 6.1 拍照识别 → 预期降级

- 步骤：录入页点「拍照识别金额」→ 授权相机 → 拍一张金额截图
- 预期：**弹「端侧识别不可用，请手动输入金额」**（因为 ML Kit 无 GMS 加载失败）
- 通过：降级文案正确出现，App 不崩溃，可继续手动输入。**这验证了降级路径本身是正确的**，是本次有意的测试目标

### 6.2 OCR Lab 粘贴 → 解析层验证（不受 GMS 影响）

- 步骤：首页右上「OCR Lab」（dev build 才显示）→ 粘贴一段 OCR 文本 → 看候选
- 预期：`extractCandidates` 正常排序候选（解析层是纯 JS，不依赖 native 引擎）
- 通过：候选排序正确。要回归解析层，可把真实样本按 `docs/ocr-device-testing.md` 追加进语料

> **OCR 引擎（ML Kit 真实识别）需要换一台带 GMS 的 Android 或 iOS 设备验证**。华为这台只能验证「降级路径」和「解析层」。这是 ADR-0008「端侧优先」在国内无 GMS 设备上的已知盲区，建议后续决策：华为用户是否走 HMS ML Kit / 云侧 OCR。

---

## 7. 结果记录模板

每项验证完记录一行，方便回填：

```
| 编号 | 项目 | 结果(通过/失败/跳过) | 现象/备注 |
|---|---|---|---|
| 5.1  | 注册登录 | | |
| 5.2  | keychain 持久化 | | |
| 5.3  | 家庭共享 RPC | | |
| 5.4  | private 开关 | | |
| 5.5  | 趋势图三线 | | |
| 5.6  | 详情/编辑 | | |
| 5.7  | 回收站恢复 | | |
| 5.8  | useMyFamilyRole | | |
| 5.9  | tamagui 渲染 | | |
| 6.1  | OCR 降级 | | |
| 6.2  | OCR Lab 解析 | | |
```

---

## 8. 已知风险汇总

| # | 风险 | 说明 |
|---|---|---|
| 1 | **无 GMS → ML Kit 不可用** | 端侧 OCR 引擎在这台设备必然失败，只能验降级 + 解析层；真实识别需 GMS 设备或 iOS |
| 2 | **HarmonyOS 4 兼容性** | RN/Expo 走 AOSP 兼容层，一般能跑，但个别 native 模块可能有鸿蒙特有行为，遇报错先截图 logcat |
| 3 | **数据不持久** | InMemory 仓储，杀进程资产清零（预期）；WatermelonDB 已实现未接入，属后续阶段 |
| 4 | **本地 Supabase 局域网坑** | 若用 `supabase start`，手机连不到 localhost，需局域网 IP + 同 WiFi + 监听地址配置 |
| 5 | **adb 驱动** | 华为设备 Windows 下需 HiSuite/官方驱动，否则 `adb devices` 列不出 |
| 6 | **getOcrEngine 缓存** | `EXPO_PUBLIC_USE_MOCK_OCR` 改动后需整包重启（模块级缓存），非热重载 |
