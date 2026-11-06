# 去 Expo 化 → Bare React Native 迁移计划

## Context

RNOH（react-native-harmony）不支持 Expo，接入前必须完成 bare RN 迁移。RN 0.77.3 升级前置验证已通过（APK 构建+真机安装+启动无崩溃，commit b51f89e）。本步目标：彻底移除 expo 依赖，改为 bare RN + react-navigation，Android release APK 继续可构建、真机行为零回归。鸿蒙工程下一步再建（用户已备 DevEco + NEXT 设备）。

分支：`chore/de-expo`，每步独立 commit 以便回退。

## 已调研事实（执行时直接引用）

- Expo 使用面 16 处/13 文件：expo-router useRouter×12 文件、`useLocalSearchParams`×2（asset/[id].tsx、asset/[id]/edit.tsx）、根 Stack 与 `(tabs)` Tabs 各 1；expo-status-bar×1（_layout）、expo-constants×1（me.tsx 版本号）、expo-image-picker×1（asset/new.tsx）。expo-linking/sharing/system-ui/splash-screen 源码零引用，直接删。
- 入口时序硬约束：`react-native-get-random-values` 必须先于一切间接引用 @noble/hashes 的模块求值（entry.js 注释）。新 index.js 第一行保留。
- app 运行时只用 `@family-wealth/db` 的 InMemory 仓储；WatermelonDB 未接线 → 从 packages/db dependencies 移除 `@nozbe/watermelondb`，避免 autolinking 编译原生模块。
- AuthGuard（app/_layout.tsx L24-55）：useSegments+router.replace 守卫 + authenticated 后 familyStore.refresh()。ocr-lab 页绕过守卫。
- react-native.config.js 已排除 reanimated autolinking（Windows 长路径坑），保留。
- android/ 是 gitignore 生成物；必保留清单：签名段（读 keystore.properties）、usesCleartextTraffic、CAMERA/POST_NOTIFICATIONS、`android.kotlinVersion=2.0.21`、local.properties、应用名「家资」、versionCode 5/versionName 0.1.5。
- src/services/supabase.ts 用 `process.env.EXPO_PUBLIC_SUPABASE_URL/ANON_KEY`（babel-preset-expo 内联）。
- 仓库根目录存在 stray `android/`（repo 根），确认非本工程后删除。

## 依赖增删

| 操作 | 包 |
|---|---|
| 删 | expo、expo-router、expo-constants、expo-image-picker、expo-linking、expo-sharing、expo-splash-screen、expo-status-bar、expo-system-ui；package.json 的 `expo.install.exclude` 段 |
| 加 | @react-navigation/native、@react-navigation/native-stack、@react-navigation/bottom-tabs（^7.x）；react-native-image-picker ^8 |
| 加（dev） | @react-native/metro-config 0.77.x、@react-native/babel-preset 0.77.x、babel-plugin-transform-inline-environment-variables |
| 不动 | screens 4.8、safe-area-context 5.1、gesture-handler、svg、keychain、netinfo、ml-kit、datetimepicker、tamagui、reanimated |

## 实施步骤

1. **基线**：新分支；确认现状 assembleRelease 绿（已有 b51f89e 产物）。
2. **装新依赖**：react-navigation 三件套 + image-picker（expo 包暂不删）。
3. **JS 迁移**（回退点：package.json `main` 切回 entry.js）：
   - 新建 `src/lib/navigation.ts`：RootStackParamList + navigationRef + navigate/replace/goBack 薄封装；Href 类型废弃。
   - 新建 `index.js`（首行 get-random-values → AppRegistry）+ `App.tsx`（gesture-handler 置顶 → TamaguiProvider → SafeAreaProvider → QueryClient → NavigationContainer）。
   - AuthGuard 改为官方 auth flow：读 auth-store status 条件渲染（`loading`→启动屏 View；`authenticated`→主 Stack，并触发 familyStore.refresh()；否则→Login/Family/Join Stack）。ocr-lab 作为独立 stack 页保留。
   - 页面搬迁：`app/(tabs)/*` → `src/screens/tabs/`；`app/login|family|join|ocr-lab|asset/*` → `src/screens/`；`router.push('/asset/123')` → `navigate('AssetDetail',{id})`；`useLocalSearchParams` → `route.params`。
   - TabBar.tsx 改接 bottom-tabs props（选中态按**路由名**判断，不再用绝对索引，规避旧 i+2 坑）。
   - me.tsx 版本号改硬编码常量；_layout StatusBar 换 react-native StatusBar；asset/new.tsx ImagePicker 换 react-native-image-picker。
   - package.json `main` → `index.js`。
4. **验证一**：`pnpm -r typecheck` + `pnpm -r test`（125 单测在 packages/*，纯 node jest 无 jest-expo，零改动）+ metro 起包 + debug 真机全页面走查。
5. **删 Expo**：移除全部 expo/* 依赖、app.json、entry.js、expo-env.d.ts；babel.config.js preset 换 @react-native/babel-preset + transform-inline-environment-variables（tamagui optimize:false 与 reanimated/plugin 置尾保留）；metro.config.js 换 @react-native/metro-config（watchFolders/nodeModulesPaths 保留）；删 .env 的 EXPO_NO_METRO_WORKSPACE_ROOT；scripts 改 react-native start/run-android，删 eas/prebuild/ios/web；删根 stray android/。
6. **android/ 重建**：用 RN 0.77 community 模板临时 init 同名工程（com.familywealth.app），拷入 android/ 后合入第「已调研事实」节的保留清单；styles.xml 启动 theme 设 `windowBackground=#10B981` + splash-logo drawable 居中（不引入 bootsplash）。
7. **出包**：`gradlew assembleRelease`（禁沙箱）→ 装 NOH-AN00 回归。

## 验证清单

- typecheck + 125 单测全绿
- assembleRelease 出签名 APK（时间戳新、签名指纹与 family-wealth.keystore 一致——**签名不变，Keychain 数据保留，自动登录不受影响**）
- 真机回归：冷启自动登录恢复、三卡月度台账口径、首页趋势月刻度、趋势页三口径切换、tab 选中态（重点复核）、录入/编辑/快照删除、OCR 选图识别、me 页版本号

## 风险与回退

- expo-router 与 react-navigation 无法并存（都独占根视图）→ 用 `main` 字段原子切换，步骤 5 前回退即切回 entry.js；之后回退靠分支。
- Keychain 保留前提：applicationId 与签名均不变（已列为硬约束）。
- metro monorepo 解析在 @react-native/metro-config 下需实测 packages/* TS 源加载。
- ML Kit OCR、keychain 鸿蒙适配属下一步鸿蒙工程范畴，本次 Android 侧零改动。
