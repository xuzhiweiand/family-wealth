# 端侧 OCR 真机联调（W6 第二段）

端侧 OCR 引擎（iOS Vision / Android ML Kit）的真实样本回归。本文档覆盖：
- 真机 prebuild 流程
- 真机样本采集
- 真机样本喂入语料与回归测试

## 一、前提

- `apps/mobile` 已能 `pnpm install --lockfile-only` 跑通（沙箱装不了 native 模块时）
- 真机 iOS（iPhone 8+ / iOS 15+）或 Android（API 24+，Google Play 服务）
- USB 连接 + Xcode（iOS）或 Android Studio（Android）
- Expo CLI / EAS CLI 已登录（`npx expo login` 或 `eas login`）

## 二、真机 prebuild

```bash
# 一次性：同步原生工程（生成 ios/、android/ 目录）
cd apps/mobile
pnpm install              # 真机上必须跑（沙箱里跑不了）
pnpm prebuild             # 生成 ios/、android/
pnpm prebuild --clean     # 重生成（依赖改了之后）

# iOS 真机
pnpm ios                  # 编译 + 安装 + 启动 Metro

# Android 真机
pnpm android
```

> ⚠️ `pnpm install` 在沙箱会触发 safe-delete shim 报错（pitfall #6）；
> 遇到就改用 `--lockfile-only` 重写 lockfile，真机上再跑 `pnpm install`。

首次 prebuild 后 Metro 会自动打包；如果 native 模块没装好，启动时 `require('@react-native-ml-kit/text-recognition')` 会抛错，
这时打开 `/ocr-lab` 路径可以确认是否是 native 模块缺失（识别按钮按下去会提示「端侧识别不可用」）。

## 三、采集样本

### 方式 1：手机拍 + 复制 OCR 文本（推荐）

1. 真机启动 App → 首页 → 点击右上「OCR Lab」（仅 `__DEV__` 时显示）
2. 拍你的银行 App / 支付宝 / 券商界面
3. 真机 logcat / Xcode console 里把识别到的文本复制下来
4. 粘到 OCR Lab 页面的「OCR 全文」框 → 点「解析」
5. 看到候选后点中正确金额 → 填 id/source/difficulty → 点「生成 CorpusSample 片段」
6. 弹窗里复制 JSON → 粘到 `packages/ocr/src/__tests__/fixtures/corpus.ts` 末尾

> 建议每个样本独立 id（如 `cmb-my-card-2026-09-08`），difficulty 据实情标。

### 方式 2：真机 OCR 全文 → 一次性导入 JSONL

把每次识别的全文 + 期望值整理成 `device-samples.jsonl`（一行一条 JSON）：

```jsonl
{"id":"cmb-my-card","source":"招行 APP 首页","difficulty":"easy","lines":["招商银行","账户余额","¥85,420.57"],"expectedInCents":8542057,"engine":"mlkit","capturedAt":"2026-09-08T10:32:00Z"}
{"id":"alipay-my","source":"支付宝总资产页","difficulty":"medium","lines":["总资产(元)","¥234,567.89","昨日收益 +12.34"],"expectedInCents":23456789,"engine":"mlkit"}
```

放到 `packages/ocr/device-samples.jsonl`（gitignored —— 真实账户信息不进仓库）。

跑：

```bash
cd packages/ocr
NODE_PATH="C:/nm" node ../../node_modules/jest/bin/jest.js accuracy-device
```

如果没文件，测试自动 skip（不挡 CI）；有 ≥ 3 条样本则跑同样护栏（top1 ≥ 70% / top3 ≥ 90%）。

## 四、把真机样本搬到语料（推荐时机）

如果你发现某个真实样本 top-1 不命中，**先确认是「引擎识别错」还是「解析层排序错」**：
- 真机 logcat 看 `fullText` 实际是什么
- 把那段粘到 OCR Lab 看候选 —— 如果 top-1 是对的但解析层没排第一，是解析层 bug（修 `parse.ts`）
- 如果引擎本身就识别错了，把样本加进 `corpus.ts` 并标 `source: '真机识别'`，让护栏先顶住再考虑是不是解析层要更激进

## 五、护栏收紧节奏

ADR-0008 给端侧 OCR 定的是 70-80% 目标，解析层当前 25 条样本基线 top1 ≈ 96%。
真机样本进来后：
- 5 条以内：阈值不收紧，留余量
- 5-15 条：top1 ≥ 80% / top3 ≥ 92%（小幅收紧）
- ≥ 15 条：top1 ≥ 85% / top3 ≥ 95%（正式收紧 —— 这里就该上报给产品经理了）

每次收紧阈值提交时，commit 信息里写明「基于 N 条真机样本」以便追溯。

## 六、踩过的坑

- pitfall #6：本机沙箱装不了 react-native-ml-kit 这种 native 模块（safe-delete shim 拦截大文件删除）。真机环境直接 `pnpm install` 即可
- pitfall #14：`@supabase/supabase-js` 2.115 起不再导出 Session 等类型。同理 `@react-native-ml-kit/text-recognition` 类型也不全，recognize 返回值用 `any[]` 接 + `OcrBlock` 包一层
- OCR Lab 路由用 `__DEV__` 守卫；真机 dev build 可见，prod build 自动消失