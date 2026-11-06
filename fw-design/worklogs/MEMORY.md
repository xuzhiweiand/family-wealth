# 项目长期记忆 — 家庭资产管理 App（家资）

> 截止 2026-09-20。仅保留跨多天稳定事实，不写流水。

## 1. 状态

- **阶段**：W1–W6 全完成 + 技术债收尾。上线 5 阶段：①决策收口 ✅ ②真机 prebuild/UX 验证（进行中：APK 已能装，JS bundle 报错已解）③功能补齐（UI/推送/离线/性能）④测试质量门（E2E/OCR 回归/性能）⑤上架（内测/审核/监控）
- **代码**：`family-wealth/`；9 个包 + rpc-tests；测试 346 + 1 skipped，rpc 16/16
- **文档**：`../documents/`（PRD v2.1 / 数据模型 v1.0 / 技术方案 v1.0 含 D1–D10 / 鸿蒙评估 / `用AI端到端开发移动App-家资实践.md`）；原型 `../prototype/`
- **2026-09-27 状态**：`family-wealth/` 代码目录已从当前工作区消失；工作区出现 `.hvigor`、`.trae` 及大量鸿蒙真机截图，显示项目后续已迁移到 HarmonyOS 方向
- **真机**：华为 Mate 40 Pro，HarmonyOS 4 / Android 12 / API 31，**无 GMS**（ML Kit OCR 不可用，只能验降级路径）

## 2. 不可逆技术决策

| # | 决策 | 要点 |
|---|---|---|
| C1 | RN + Expo SDK 52 + expo-router 4 | 不用 React Navigation |
| C2 | pnpm workspaces | 单人项目，不用 Turborepo/Nx |
| C3 | Supabase（Postgres+Auth+Realtime+Edge） | 单后端 BaaS |
| C4 | 端到端加密 PBKDF2→UMK→HKDF→FDK→AES-256-GCM 信封 | 服务端无明文，趋势聚合必须在客户端 |
| C5 | 单表继承：11 类资产共用 `assets`，差异存 JSON | 趋势零 JOIN |
| C6 | `asset_snapshots` 独立表，金额变更即写 | 趋势图唯一数据源 |
| C7 | 软删除优先（全表 `deleted_at`） | 财务数据找回成本高 |
| C8 | 邀请码字母表去 0/O/1/I/L | 早期误把 L 写进去过 |
| C9 | 金额以「分」整数存储 | 避免浮点累计误差 |
| C10 | FDK 是**家庭级随机密钥**，不从 UMK 派生（ADR-0010） | 成员各存「自己 UMK 加密的 FDK 副本」；撤销=切断新数据+轮换，历史密文无法远程擦除 |

## 3. 已拍板决策

- D1 Tamagui / D2 @noble / D3 WatermelonDB / D4 端侧 OCR 优先（ADR 0005–0008）；ADR 0009 密钥轮换、0010 FDK 分发、0011 OCR 语料
- **D5 单家庭**（切换=退出旧家）/ **D9 强制更新** / **D10 暂不接第三方登录**（纯 email+password 不触发 Apple 登录强制）/ **生物识别暂删声明**（MVP 只做主密码）

## 4. 品牌（2026-09-20）

- 中文名 **家资**（与 scheme `jiazi` 一致）；包名 `com.familywealth.app` **不动**
- 图标：纯绿 `#10B981` 底 + 中间白色圆形 + 圆内屋檐（无下方竖线）+ 屋檐下 **4 段小幅上升**折线
- 源文件 `apps/mobile/assets/brand/jiazi-icon-v4.png`；App 用 `assets/icon.png`；`app.json` 的 `name` 与 `android/.../values/strings.xml` 的 `app_name` 已同步为「家资」

## 5. 用户偏好

- 中文交流，接受英文技术名词混排；结构化输出（表格/决策摘要）
- 「用最小资源验证产品价值，再决定扩大投入」；砍非核心、做精核心
- 先给设计选项再动手（design-decisions-before-code）；接受截图驱动迭代

## 6. 工具与环境

- node 22.22.2 (managed)；pnpm 由 `npm i -g pnpm@9.15.0` 装到 managed workspace（corepack 在 Windows 不可用）
- python 3.13.12 (managed)，**无 Pillow 且 pip 装不上**（沙箱拦截）
- 跑测试：`cd packages/X && NODE_PATH="C:/nm" ../../node_modules/.bin/jest`（根 node_modules 是 symlink 到 `C:\nm`）
- git 身份：`git config user.name "WorkBuddy" && git config user.email "workbuddy@local"`
- **Bash coreutils 时好时坏**（`ls`/`cd`/`dirname` 会 command not found）→ 主力用 PowerShell，但**PowerShell stdout 常被吞**，结果要 `Set-Content` 到文件再 Read 验证

## 7. 坑清单

**工程 / 测试**
1. INVITE_ALPHABET 类断言要写「概率性」而非确定性
2. `jest.fn(async () => …)` 推断为 `Mock<…, []>`，`calls[0]` 报「Tuple has no element」→ 给 mock 声明参数类型
3. 性能断言当「回归护栏」不是基准：PBKDF2 空载 300ms/满载 1.1s+，阈值写 3000ms 防 flaky
4. 删死代码前必验零引用（含测试是否只在测它本身）——`db/sync-queue.ts` 案例
5. 「W2 占位 W3 替换」注释会冻死；写「将来被替换」时必须写明转正后的角色
6. 裁决类纯函数**检查顺序有产品语义**（checkMemberRemoval 先判 self-removal），用「误用场景」测试逼出顺序
7. 两个包导出同名符号在 index 聚合时冲突（kdf.ts / share.ts 的 FDK_BYTES）——re-export 前查重
8. 包内 `import type {X} from './types'` 转手的类型不会 re-export，测试直接从 `@family-wealth/shared-types` 导入

**TypeScript / RN / Expo**
9. `noUncheckedIndexedAccess` 下 `arr[i]` 是 `T|undefined`（显式 `!` 或 `?? 0`）
10. mobile 不引 jest（RN 用 Detox，单测在 packages 跑）
11. expo 会重生成 `expo-env.d.ts` → gitignore + untrack；`EXPO_PUBLIC_*` 靠 `expo/types` 注入
12. expo-router typed routes 是 cli 生成且 gitignored，沙箱残缺 → segment 比较用 `as string|undefined`
13. **mobile typecheck 在沙箱是环境噪音**（tamagui 等装的是空包），不要为修它改业务代码
14. RN 真机**没有 `window.confirm`**（用了静默失效），确认一律 `Alert.alert`
15. zustand：渲染路径必须 `useStore(selector)`，`getState()` 只用于命令式回调（useMyFamilyRole 曾因此不重渲染）
16. WatermelonDB 映射抽到 `db/src/mappers.ts` 纯函数以便 jest 测；`watermelon/` 排除出 tsc
17. @supabase/supabase-js ≥2.115 改 .d.cts 且不再导出类型 → 包内声明最小 Port（如 `SupabaseLike`）
18. 编辑页先判「哪些字段变了」再决定 updateAmount（写快照）vs updateAssetMeta
19. 私有资产不计入家庭净资产；`buildTrendSeries` 不认 visibility，过滤统一走 `filterVisibleAssets`（调用方做）
20. 恢复操作**不写快照**（carry-forward 基线接回曲线，写快照会画出假暴涨）
21. 趋势窗口裁剪必须配 carry-forward 基线，否则首日从 0 起跳
22. 「万/亿 → 分」换算最易错一个零；期望值用 `12_856_000` 分隔符字面量并当场 node 验算

**SQL / Supabase / PGlite**
23. PGlite 0.2.17：`db.sql` 只支持 tagged template，可调用形式用 `db.query(sql, params)`
24. PGlite 不带 pgcrypto → 用 `sha256(convert_to(...))` 替代 `digest()`
25. PL/pgSQL `RAISE EXCEPTION` 回滚整个事务（含函数体内 INSERT）→ 副作用日志/限流计数必须放事务外
26. RLS 自引用会无限递归 → 用 SECURITY DEFINER 助手 `is_active_member(p_family_id)`
27. 启 RLS 但无 policy 时 owner 直接 select 也返回 0 行，调试要 `reset role`
28. rate-limit 断言必须先算清历史调用次数，或用全新用户 fixture
29. SECURITY DEFINER 以 owner 运行绕过 RLS；助手参数用 family_id 而非 user，避免成为成员关系预言机

**流程 / git**
30. **复合 `git add dir/` + Edit 空壳文件 = 误删套餐**（曾误删 5 个活文件）→ `git add` 按文件显式列出，commit 前必看 `git diff --cached --stat`
31. safe-delete shim：>50 文件删除/重命名直接 SIGTERM（绕不开）；装不了大依赖时用 `pnpm install --lockfile-only`，workspace 链接用 PowerShell `New-Item -ItemType Junction` + **绝对路径**
32. shim 触发会连带清 workspace junctions → `git checkout HEAD -- packages/` 恢复后重建链接
33. 同一文件连续多个 Edit 容易丢一条 → 合并到一个 Edit 块或 replace_all

**沙箱 / 工具链（2026-09-20 新增）**
34. **沙箱装不了 Pillow（pip 被拦，exit 1 无输出）也没有 sharp** → 图标缩放用**零依赖纯 Python**：`apps/mobile/scripts/gen-icons.py`（zlib 解 PNG + 行反滤波 + box 缩放 + PNG 编码）
35. **Android 同名 PNG/WebP 冲突**：prebuild 生成 `ic_launcher.webp`，手写 `ic_launcher.png` 会 AAPT2 "duplicate value for resource" → 生成 PNG 后必须删掉同名 webp
36. **改展示名要同步 `android/app/src/main/res/values/strings.xml` 的 `app_name`**（Manifest 用 `@string/app_name`），只改 app.json 对已生成的 android/ 无效
37. **`assetBundlePatterns: **/*` 会把 assets/ 下非图片文件打进 APK** → 构建脚本放 `scripts/` 不放 `assets/`
38. PowerShell `Get-ChildItem -Filter "*.webp"` 与通配符 Path 组合会返回 0 → 用 `-File | Where-Object { $_.Extension -eq '.webp' }`

**OCR / 内容**
39. OCR 真机样本走 JSONL（一行一条天然追加，不改尾部逗号），`device-samples.jsonl` gitignored，找不到就 skip 不挡 CI
40. **图像生成是盲写**（模型不能读图）：生成后必须先让用户确认再落地；描述**方向要写死**（「左下→右上」「末端高于起点」），只写「上升」会被画反（v1 返工）
41. 无 GMS 设备（华为/荣耀）上端侧 ML Kit OCR 不可用 → 需 HMS ML Kit 或云侧 OCR（ADR-0008 P1）
