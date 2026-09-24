# 鸿蒙 HAR 依赖存放目录

此目录用于存放 RNOH（react-native-harmony）的 HAR 包。

## 获取 react_native_openharmony.har

### 方式一：官方 Release（推荐）

从 [RNOH Releases](https://gitee.com/openharmony-sig/react-native-harmony/releases) 下载最新版本的 `react_native_openharmony.har`，放入本目录。

### 方式二：源码构建

```bash
# 克隆 RNOH 仓库
git clone https://gitee.com/openharmony-sig/react-native-harmony.git

# 构建 HAR
cd react-native-harmony
hvigorw assembleHar --mode module -p product=default

# 产物位于 entry/build/default/outputs/default/entry.har
# 重命名为 react_native_openharmony.har 后复制到本目录
```

## 版本对应关系

| RNOH 版本 | RN 版本 | 鸿蒙 API |
|-----------|---------|----------|
| 0.77.x    | 0.77.3  | API 12+  |

> 当前项目使用 RN 0.77.3，请选择与之匹配的 RNOH 版本。
