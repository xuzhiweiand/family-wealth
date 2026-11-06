# 登录性能优化技术报告（v0.1.7）

| 项 | 内容 |
|---|---|
| 版本 | 0.1.6 → 0.1.7（Android versionCode 8 / Harmony versionCode 1000002） |
| 提交 | `9150f97`（分支 `chore/de-expo`，18 个文件，+399 / −40） |
| 验证设备 | HUAWEI Mate X7（HarmonyOS 5.0，arm64-v8a），真机实测 |
| 日期 | 2026-09-27 |
| 目标 | 鸿蒙端登录耗时控制在 1 秒以内 |

---

## 1. 背景与目标

家庭资产 App 采用端到端加密架构：用户密码不直接用于数据加密，而是经 **PBKDF2-SHA256（100,000 次迭代）** 派生出用户主密钥 UMK，再由 UMK 经 HKDF 派生家庭数据密钥 FDK。该设计在 iOS / Android（JIT 加持）下性能良好，但迁移到鸿蒙（RNOH 0.77.74 + Hermes）后，用户反馈登录耗时极长、界面卡死。

本次目标：

1. 定位鸿蒙端登录慢的量化瓶颈；
2. 将登录耗时压缩至 **1 秒以内**；
3. 不降低原有加密强度与安全校验口径；
4. Android / iOS / Node（测试侧）行为不回归。

---

## 2. 优化前现状

### 2.1 登录链路（旧）

```
点击登录
  └─ Supabase GoTrue signInWithPassword（网络 RTT）
       └─ profiles 表查询（salt / envelope，又一次串行网络 RTT）
            └─ PBKDF2-SHA256 100k（@noble/hashes，纯 JS，同步）
                 └─ 密码信封校验
                      └─ set authenticated → 主页挂载
                           └─ 恢复 FDK → 拉取资产数据
```

旧实现中，**PBKDF2 位于「进入主页」的关键路径上**：所有网络往返与 CPU 重活全部串行完成后，用户才能看到主页。

### 2.2 量化基线（真机埋点实测）

| 阶段 | 耗时 |
|---|---|
| 登录缓存读取 | 20 ms |
| GoTrue 鉴权（网络） | 300 ms |
| profiles 查询 | 13 ms（缓存部分命中） |
| **PBKDF2-SHA256 100k（纯 JS）** | **76,145 ms** |
| **点击登录 → 主页可见** | **76 秒以上** |

PBKDF2 期间 JS 线程被 100% 占满（同步调用），表现为：点击登录后整个应用冻结约 76 秒，无任何 UI 反馈。

### 2.3 一个误导性的中途错误

首次将 KDF 下沉原生时，登录报 `Found invalid character when decoding base64 string`。排查一度怀疑：

- salt 不是合法 base64；
- ArkTS `Base64Helper` 默认字母表不是标准字母表。

后经 SDK 类型声明确认 `util.Base64Helper` 默认即标准 Base64（`util.Type.BASIC`，A–Z a–z 0–9 +/），salt 在 JS 侧 `atob` 也能正常解码。**真正根因见第 6 节「踩坑记录」：C++ 方法元数据宏用错。**

---

## 3. 根因分析

### 3.1 根因一：Hermes 无 JIT，纯 JS PBKDF2 慢 300 倍以上

鸿蒙端 JS 引擎为 Hermes，无 JIT，所有解释执行。`@noble/hashes` 的 PBKDF2 每轮迭代包含多轮 SHA-256 压缩函数（纯 JS 数组/算术运算），100k 迭代被放大到 **76 秒**。对照：

| 运行环境 | PBKDF2 100k 典型量级 |
|---|---|
| iOS / Android（JIT） | < 200 ms |
| Node（V8） | ~50 ms |
| **鸿蒙 Hermes（无 JIT）** | **76,145 ms** |

且该运算为**同步调用**，独占 JS 线程，UI、动画、网络回调全部被阻塞。

### 3.2 根因二：CPU 重活在进入主页的关键路径上

即使把 PBKDF2 提速，旧时序中「鉴权 → profiles → KDF → 挂载主页」全串行，关键路径长度为各阶段之和，没有并行化与「先渲染后计算」的编排。

### 3.3 根因三：profiles 查询是每次登录的固定 RTT

salt / password_check_envelope 属于「非机密但登录必需」数据，旧实现每次登录都串行查询 profiles 表，弱网下该 RTT 会被进一步放大。

---

## 4. 优化方案

### 4.1 PBKDF2 下沉鸿蒙原生：CryptoPbkdf2 TurboModule

鸿蒙系统库 `cryptoFramework` 自 API 11 起提供原生 PBKDF2，运算在系统侧完成、毫秒级返回，且以 Promise 异步执行、不占用 JS 线程：

```ts
// apps/mobile/harmony/entry/src/main/ets/turbo/CryptoPbkdf2TurboModule.ets
import { TurboModule, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { util } from '@kit.ArkTS';

export class CryptoPbkdf2TurboModule extends TurboModule {
  constructor(ctx: TurboModuleContext) { super(ctx); }

  async derive(
    password: string,
    saltBase64: string,
    iterations: number,
    keySize: number,
  ): Promise<string> {
    const salt: Uint8Array = new util.Base64Helper().decodeSync(saltBase64);
    const spec: cryptoFramework.PBKDF2Spec = {
      algName: 'PBKDF2',
      password,                                   // 明文 UTF-8，与 JS TextEncoder 口径一致
      salt,
      iterations,
      keySize,
    };
    const kdf = cryptoFramework.createKdf('PBKDF2|SHA256');
    const secret = await kdf.generateSecret(spec);
    return new util.Base64Helper().encodeToStringSync(secret.data);
  }
}
```

**RNOH 双侧注册机制**：RNOH 的 ArkTS TurboModule 必须同时在 ArkTS 与 C++ 两侧注册——JS 调用时 C++ `TurboModuleFactory` 先回调 ArkTS `hasModule` 查到实例，再要求 C++ delegate 返回一个 `ArkTSTurboModule` 包装对象，缺任一侧直接 Fatal。

- ArkTS Package（工厂 + `hasTurboModule('CryptoPbkdf2')`）：`turbo/CryptoPbkdf2Package.ets`；在 `entry/src/main/ets/pages/Index.ets` 的 `createRNPackages` 中 `new CryptoPbkdf2Package(ctx)`；
- C++ Package（header-only，免去 CMake 改动）：`entry/src/main/cpp/CryptoPbkdf2Package.h`，声明异步方法元数据并在 `PackageProvider.cpp` 中注册：

```cpp
// CryptoPbkdf2Package.h（节选）
class CryptoPbkdf2TurboModule : public ArkTSTurboModule {
  public:
    CryptoPbkdf2TurboModule(const ArkTSTurboModule::Context ctx, const std::string name)
        : ArkTSTurboModule(ctx, name) {
      methodMap_ = {
          ARK_ASYNC_METHOD_METADATA(derive, 4),   // 异步方法必须用 ASYNC 宏（见第 6 节）
      };
    }
};
```

C++ 侧代码全部放在头文件中，由已编译的 `PackageProvider.cpp` 引入即可，`CMakeLists.txt` 无需改动。

### 4.2 平台感知的异步 KDF：deriveUMKFast

在 `packages/crypto` 中新增异步派生函数，运行时检测平台：

- **鸿蒙**：通过 `TurboModuleRegistry.getEnforcing('CryptoPbkdf2')` 走原生实现；
- **Android / iOS / Node（测试侧）**：回落原有纯 JS `deriveUMK`。

```ts
// packages/crypto/src/kdf.ts（节选）
function getHarmonyKdf(): HarmonyKdfFn | null {
  if (harmonyKdf === undefined) {
    try {
      const rn = require('react-native');
      if (rn.Platform.OS === 'harmony') {
        harmonyKdf = rn.TurboModuleRegistry.getEnforcing('CryptoPbkdf2').derive;
      } else {
        harmonyKdf = null;
      }
    } catch {
      harmonyKdf = null;   // Node/测试侧：require('react-native') 失败时回落
    }
  }
  return harmonyKdf ?? null;
}

export async function deriveUMKFast(password: string, salt: Uint8Array): Promise<Uint8Array> {
  if (salt.length < SALT_BYTES) throw new Error(`salt must be at least ${SALT_BYTES} bytes`);
  const kdf = getHarmonyKdf();
  if (kdf) {
    const base64 = await kdf(password, toBase64(salt), PBKDF2_ITERATIONS, UMK_BYTES);
    return fromBase64(base64);
  }
  return deriveUMK(password, salt);
}
```

懒加载 + 缓存查找结果，保证 crypto 包在 RN 运行时之外（Jest / Node）依旧可用；原同步 `deriveUMK` 保留，供测试向量与非鸿蒙回落实使用。

### 4.3 登录时序重排：先见主页，后台派生

`signIn` 重排为四个阶段，把「网络等待」与「CPU 重活」分离，主页门禁最小化：

```
点击登录
 │
 ├─ 阶段1  GoTrue 鉴权（纯网络等待，JS 线程空闲）
 │         并发读取本机 login-cache（salt/envelope）
 │
 ├─ 阶段2  set({ status: 'authenticated' })  ← AuthGuard 立即放行
 │         持久化 salt/session/user（fire-and-forget）
 │         主页挂载并完成首帧（等待两帧 rAF）
 │         ──────────────────── 此时主页已可见 ────────────────────
 │
 ├─ 阶段3  deriveUMKFast（鸿蒙原生，异步，不冻结 UI）
 │         密码信封 constant-time 校验 → setUmk + 持久化 UMK
 │
 └─ 阶段4  后台：familyStore.refresh() 恢复 FDK → assetStore.load() 拉取数据
```

关键代码（`apps/mobile/src/stores/auth-store.ts`）：

```ts
// 阶段2：立即建立登录态，让主页先挂载、首帧先渲染
set({ status: 'authenticated', user, session, error: null });
await new Promise<void>((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// 阶段3：首帧后派生 UMK + 信封校验
const umk = await deriveUMKFast(password, fromBase64(user.salt));
if (!verifyEnvelopeWithUMK(umk, user.passwordCheckEnvelope)) {
  // 安全校验失败：回滚为登出态（GoTrue 已验密码，此分支用于防 salt 篡改）
  await clearAll();
  set({ status: 'idle', user: null, session: null, error: '安全校验未通过，请重新登录' });
  return false;
}
useKeyStore.getState().setUmk(umk);

// 阶段4：数据恢复在后台进行，不阻塞登录返回
void (async () => {
  await useFamilyStore.getState().refresh();
  const familyId = useKeyStore.getState().familyId;
  if (familyId) await useAssetStore.getState().load(familyId);
})();
```

### 4.4 login-cache：本机登录档案缓存

新增 `apps/mobile/src/services/login-cache.ts`，通过 AsyncStorage 按邮箱缓存：

- `salt`（标注为非机密）：登录开始即可读取；
- `password_check_envelope`：公开校验体，缓存命中时**省去 profiles 查询这一整次串行 RTT**；
- `displayName`：命中时直接回填。

`SupabaseAuthClient` 构造函数新增 `LoginProfileCachePort`（get/set 两个方法，端口接口，不依赖具体存储）；由 `bootstrap.ts` 注入：

```ts
setAuthClient(
  new SupabaseAuthClient(supabase as unknown as SupabaseLike, {
    get: (email) => getCachedLogin(email),
    set: (email, profile) => saveCachedLogin(email, profile),
  }),
);
```

缓存命中后后台静默校准（`syncLoginCache`），salt 与服务端一致才写回，防止缓存陈旧；首次登录（无缓存）仍走 profiles，并在返回后写满缓存，下次登录即零 profiles RTT。

### 4.5 顺带修复（影响登录正确性）

| 文件 | 修复 |
|---|---|
| `babel.config.js` | `dotenv.config()` 显式指定 `path: resolve(__dirname, '.env')`。旧写法依赖 cwd，metro babel worker 以不同 cwd 启动时环境变量未内联，supabase 配置拿到 undefined、静默回退 InMemory，表现为「密码错误无法登录」 |
| `LoginScreen.tsx` | 密码框增加 `autoCapitalize="none"` / `autoCorrect={false}` / `spellCheck={false}`，避免系统键盘自动改写密码输入 |
| `global.d.ts` | 为 `@react-native-async-storage/async-storage` 补模块声明（工程只装鸿蒙移植包，类型层复用其类型） |

---

## 5. 优化前后对比（真机实测）

| 指标 | 优化前（0.1.6） | 优化后（0.1.7） | 提升 |
|---|---|---|---|
| PBKDF2 100k | 76,145 ms，冻结 JS 线程 | **104 ms**，系统线程异步 | **≈730 倍** |
| 点击登录 → 主页首帧（门禁） | 76,000 ms+ | **518 ms** | ≈147 倍 |
| 点击登录 → UMK 就绪、恢复任务启动 | 76,000 ms+ | **677 ms** | ≈112 倍 |
| profiles RTT（缓存命中） | 每次必查 | **0**（后台静默校准） | 省一次串行 RTT |
| 登录期间 UI 响应 | 完全冻结 | 全程可交互 | — |

### 5.1 门禁 518 ms 的口径拆解

| 子项 | 耗时 | 说明 |
|---|---|---|
| login-cache 读取 | 20 ms | AsyncStorage 本机读 |
| GoTrue 鉴权 | 300 ms | 网络 RTT（Wi-Fi/5G 环境） |
| profiles 阶段 | 13 ms | 缓存部分命中；全命中为 0 |
| 登录态切换 + 主页挂载首帧 | 185 ms | set authenticated → AuthGuard 放行 → stack 挂载 → 两帧绘制 |
| **合计** | **518 ms** | 点击登录 → 主页首帧可见 |

PBKDF2（104 ms）在门禁**之后**于后台执行，不进入门禁耗时。

### 5.2 总量 677 ms 的口径

`点击登录（0 ms）→ 主页首帧（518 ms）→ 原生 KDF + 信封校验 + UMK 持久化（+159 ms）= 677 ms`。此时家庭/资产数据恢复任务已在后台启动，实测数据在约 1 秒内全部呈现（家庭净资产 ¥-413,000、总资产 ¥36.2 万、总负债 ¥77.5 万，与云端一致）。

### 5.3 应用重启的自动登录

会话期内重启走 `hydrate()`：Keychain 本地读取 session + UMK + user → `setSession` 恢复 SDK 态，**零网络、零 KDF**，毫秒级进入主页，本次优化后行为不变。

---

## 6. 踩坑记录：方法元数据宏不可混用

`ArkTSTurboModule` 的方法元数据有三个宏，分别对应不同派发路径：

| 宏 | 派发路径 | 适用方法 |
|---|---|---|
| `ARK_METHOD_METADATA` | `call`（同步阻塞，等待返回值） | 同步方法 |
| `ARK_ASYNC_METHOD_METADATA` | `callAsync`（创建并返回 JS Promise） | **async / Promise 方法** |
| `ARK_SCHEDULE_METHOD_METADATA` | `scheduleCall`（只发起、不取结果） | fire-and-forget 方法 |

初版 C++ Package 误用了 `ARK_METHOD_METADATA(derive, 4)`：JS 侧以同步路径调用一个 ArkTS `async` 方法，napi 返回的 Promise 被当作同步结果处理，ArkTS 内 `await` 链未能正常推进，base64 步骤抛出 `Found invalid character when decoding base64 string`。

**教训**：

1. 该错误信息字面指向「base64 字符非法」，但实际是派发路径错误——排查这类问题应先核对方法元数据与方法签名（sync/async）是否匹配，再怀疑数据内容；
2. ArkTS TurboModule 的方法签名、C++ 元数据、JS 调用方式三者必须一致；
3. 改为 `ARK_ASYNC_METHOD_METADATA(derive, 4)` 后立即恢复正常，无需改动任何 base64 数据。

---

## 7. 安全性分析

| 关注点 | 结论 |
|---|---|
| 加密强度 | **不降低**。PBKDF2-SHA256、100k 迭代、32 字节输出全部保持，仅执行方从 JS 换为系统 cryptoFramework，算法与参数完全相同 |
| 正确性验证 | 优化前后以同一密码 + salt 派生，信封校验（`verifyEnvelopeWithUMK`，constant-time）通过即证明 UMK 一致；失败会回滚登出态 |
| salt 缓存 | salt 在设计上即标注为非机密，本机副本不引入新风险 |
| envelope 缓存 | 密码校验信封为公开校验体，安全性依赖 100k PBKDF2 的离线猜测成本，本机副本不削弱该属性 |
| 缓存陈旧 | 缓存命中后后台以服务端 profiles 静默校准，salt 不一致不写回；下次登录回落到服务端值 |
| 明文密码传输范围 | 密码仅在登录调用中进入系统 KDF，不落盘、不写日志（调试埋点已全部移除） |
| 沙箱 | AsyncStorage / Keychain 均为应用私有沙箱存储 |

---

## 8. 测量方法（保证结论可复现）

1. 在 `signIn` 各阶段插入高精度时间戳（`Date.now()`），记录：起点、缓存读后、鉴权后、profiles 后、主页两帧后、KDF 后、UMK 就绪后；
2. 鸿蒙真机下 JS `console.log` 不便于持续观察，验证期间以临时 `Alert` 弹窗呈现汇总数据（验证通过后已**全部移除**，最终包无任何调试 UI）；
3. 每次测量前执行「退出登录 → 重新登录」，确保走完整登录路径而非自动登录；
4. 网络阶段数据与具体网络环境相关（实测 Wi-Fi/5G，鉴权 RTT 约 300 ms）；KDF 耗时与网络无关，是本次优化的确定性收益；
5. 最终干净包（同一份提交）再做一次完整退出 → 登录回归，确认：登录成功、无弹窗、数据正确、版本号显示 v0.1.7。

---

## 9. 变更文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `apps/mobile/harmony/entry/src/main/ets/turbo/CryptoPbkdf2TurboModule.ets` | 新增 | 原生 PBKDF2 ArkTS 实现 |
| `apps/mobile/harmony/entry/src/main/ets/turbo/CryptoPbkdf2Package.ets` | 新增 | ArkTS Package / 工厂 |
| `apps/mobile/harmony/entry/src/main/cpp/CryptoPbkdf2Package.h` | 新增 | C++ 转发壳（header-only） |
| `apps/mobile/harmony/entry/src/main/ets/pages/Index.ets` | 修改 | ArkTS 侧注册 |
| `apps/mobile/harmony/entry/src/main/cpp/PackageProvider.cpp` | 修改 | C++ 侧注册 |
| `packages/crypto/src/kdf.ts` | 修改 | `deriveUMKFast` 平台感知异步派生 |
| `apps/mobile/src/stores/auth-store.ts` | 修改 | 登录时序重排，signIn/signUp 统一走 Fast KDF |
| `apps/mobile/src/services/login-cache.ts` | 新增 | 本机登录档案缓存 |
| `packages/api/src/supabase.ts` | 修改 | `LoginProfileCachePort` 注入与缓存读写/校准 |
| `apps/mobile/src/services/bootstrap.ts` | 修改 | 注入缓存端口 |
| `apps/mobile/babel.config.js` | 修改 | dotenv 显式路径 |
| `apps/mobile/src/screens/LoginScreen.tsx` | 修改 | 密码输入属性 |
| `apps/mobile/src/types/global.d.ts` | 修改 | AsyncStorage 模块声明 |
| `apps/mobile/android/app/build.gradle` | 修改 | versionCode 8 / 0.1.7 |
| `apps/mobile/harmony/AppScope/app.json5` | 修改 | 1000002 / 0.1.7 |
| `apps/mobile/package.json` | 修改 | 0.1.7 |
| `apps/mobile/src/screens/tabs/MeScreen.tsx` | 修改 | 版本显示 0.1.7 |
| `apps/mobile/src/platforms/harmony/index.ts` | 修改 | 版本常量 0.1.7 |

---

## 10. 后续建议

1. **弱网门禁仍受 RTT 约束**：当前门禁 518 ms 中 300 ms 为鉴权网络往返。若要进一步压缩，可考虑登录请求预连接 / DNS 预解析，或在用户输入完成后提前发起预热；
2. **原生能力扩展**：本次验证了 RNOH ArkTS TurboModule 双注册链路，后续高 CPU 场景（如大批量数据加解密）可复用同一模式下沉 cryptoFramework；
3. **KDF 迭代次数复核**：原生实现使 100k 迭代成本几乎可忽略，未来可按安全策略上调迭代次数而无用户体验负担；
4. **登录耗时埋点的常态化**：可在开发构建中保留可开关的阶段耗时日志（release 关闭），替代本次的临时埋点方式，便于回归监控。
