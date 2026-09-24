# RNOH 鸿蒙工程

## 前置要求

1. **DevEco Studio** 5.0.0+（支持 HarmonyOS NEXT API 12+）
2. **RNOH SDK**：从 [react-native-harmony](https://gitee.com/openharmony-sig/react-native-harmony) 获取 `react_native_openharmony.har`，放入 `libs/` 目录
3. **Node.js** 18+ 与 pnpm（用于打包 RN bundle）

## 目录结构

```
harmony/
├── entry/                  # 主模块
│   ├── src/main/ets/       # ArkTS 代码
│   │   ├── entryability/   # 应用入口
│   │   └── pages/          # 页面
│   ├── src/main/resources/ # 资源文件
│   └── build-profile.json5 # 模块构建配置
├── libs/                   # 本地 HAR 依赖
│   └── react_native_openharmony.har
├── build-profile.json5     # 工程级构建配置
├── oh-package.json5        # 工程级依赖配置
└── local.properties        # SDK 路径配置
```

## 构建步骤

### 1. 准备 RNOH 依赖

从 RNOH  releases 下载最新 `react_native_openharmony.har`：

```bash
# 放入 libs/ 目录
cp /path/to/react_native_openharmony.har apps/mobile/harmony/libs/
```

### 2. 打包 RN Bundle

```bash
cd apps/mobile
# 启动 metro（鸿蒙模式）
pnpm react-native start --platform harmony

# 另开终端，打包 bundle
pnpm react-native bundle \
  --platform harmony \
  --dev false \
  --entry-file index.js \
  --bundle-output harmony/entry/src/main/resources/rawfile/bundle/index.harmony.bundle \
  --assets-dest harmony/entry/src/main/resources/rawfile/
```

### 3. DevEco Studio 构建

1. 打开 DevEco Studio
2. 打开工程目录 `apps/mobile/harmony`
3. 同步工程（Sync Now）
4. 配置签名（File → Project Structure → Signing Configs）
5. 连接鸿蒙设备或启动模拟器
6. 点击 Run 或 Build → Build Hap(s)

### 4. 命令行构建（可选）

```bash
cd apps/mobile/harmony
hvigorw assembleHap --mode module -p product=default -p buildMode=release
```

## 已知限制

- **react-native-keychain**：鸿蒙侧需要桥接至鸿蒙的 KeyStore/Asset Store
- **react-native-svg**：RNOH 已内置支持
- **react-native-gesture-handler**：RNOH 已内置支持
- **react-native-ml-kit/text-recognition**：需要鸿蒙 OCR 替代方案（鸿蒙 AI 引擎）
- **@supabase/supabase-js**：网络层依赖 fetch，RNOH 已支持

## 签名配置

在 `build-profile.json5` 的 `signingConfigs` 中添加：

```json5
{
  "app": {
    "signingConfigs": [
      {
        "name": "default",
        "type": "HarmonyOS",
        "material": {
          "certpath": "/path/to/certificate.pem",
          "storePassword": "xxx",
          "keyAlias": "familywealth",
          "keyPassword": "xxx",
          "profile": "/path/to/profile.p7b",
          "signAlg": "SHA256withECDSA",
          "storeFile": "/path/to/keystore.p12"
        }
      }
    ]
  }
}
```

## 版本同步

鸿蒙版与 Android 版共享同一套 RN JS 代码，版本号通过 `src/lib/version.ts` 统一管理。
