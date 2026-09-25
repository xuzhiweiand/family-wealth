# 鸿蒙 HAR 依赖存放目录

此目录用于存放 RNOH（react-native-harmony）的 HAR 包。

> HAR 不纳入 Git（单文件约 128MB，超过 GitHub 100MB 限制），由脚本本地生成。

## 自动生成（推荐）

`@react-native-oh/react-native-harmony` npm 包根目录已自带 HAR，执行：

```bash
# 在仓库根目录
pnpm install            # postinstall 会自动复制 HAR 到本目录

# 或在 apps/mobile 下手动执行
pnpm harmony:hars
```

执行后本目录将出现：

- `react_native_openharmony.har`（debug，约 128MB）
- `react_native_openharmony_release.har`（约 12MB）
- `react_native_openharmony_release2.har`（约 12MB）

## 手动获取（备选）

### 官方 Release

从 [RNOH Releases](https://gitee.com/openharmony-sig/react-native-harmony/releases) 下载对应版本的 HAR，放入本目录。

### 源码构建

```bash
git clone https://gitee.com/openharmony-sig/react-native-harmony.git
cd react-native-harmony
hvigorw assembleHar --mode module -p product=default
# 产物重命名后复制到本目录
```

## 版本对应关系

| RNOH 版本 | RN 版本 | 鸿蒙 API |
|-----------|---------|----------|
| 0.77.x    | 0.77.3  | API 12+  |

> 当前项目使用 RN 0.77.3，HAR 由 0.77.74 npm 包提供。
