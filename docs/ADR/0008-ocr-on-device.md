# ADR-0008: OCR 端侧优先，云侧做 P1 纠错

**状态**: Accepted  
**日期**: 2026-09-07  
**对应技术方案**: §14、§21 D4

## 背景

11 类资产中银行存款/股票/基金/理财等需要录入当前金额，手动录入易出错且打断流程。
需决策 OCR 走端侧还是云侧。

## 决策

**MVP 端侧为主，云侧做 P1 增强**。

## 评估

| 维度 | 端侧（iOS Vision / Android ML Kit） | 云侧（百度/腾讯/自训练） |
|---|---|---|
| 隐私 | ⭐⭐⭐⭐⭐ 数据不出设备 | ⚠️ 截图需上传 |
| 离线可用 | ✅ | ❌ |
| 响应延迟 | < 200ms | 1-3s |
| 准确率（国内银行） | 70-80% | 90-95% |
| 成本 | 一次性集成 | 按调用付费、长期成本 |

## 理由

1. **隐私是核心卖点** — PRD v2.1 §1.2 明确"独立第三方 + 隐私至上"
2. **端侧准确率已可用** — 70-80% 已优于用户手输，剩余错误由用户复核（金融数据本来就要人眼确认）
3. **零成本** — 不增加运营成本与外部依赖
4. **云侧做 P1 增强** — 端侧无法识别的特殊版式截图（如某些冷门券商 App），用户可一键上传云端识别，准确率达 95%

## 实施

### MVP（端侧）

- iOS：`Vision.framework` 的 `VNRecognizeTextRequest`（系统级 API，免费）
- Android：`Google ML Kit Text Recognition`（本地模型，免费）
- 通用接口：

```ts
export interface OcrEngine {
  recognize(imageUri: string): Promise<OcrResult>;
}

export interface OcrResult {
  fullText: string;
  blocks: Array<{ text: string; bbox: BoundingBox; confidence: number }>;
  /** 端侧预解析出的"金额"候选（regex 匹配 ¥/数字/2位小数） */
  amountCandidates: Array<{ value: number; bbox: BoundingBox; source: 'regex' }>;
}
```

### P1（云侧增强）

- 用户在 OCR 结果页点击"识别不准？云端识别"
- 截图 AES-256-GCM 加密后上传到自建 OCR 代理（隐私仍可控）
- 命中规则：版式与已知模板（如招商银行/华泰证券）不匹配时启用

## 后果

- ✅ 隐私零妥协、零持续成本
- ✅ 离线可用
- ⚠️ 国内银行版式多变，准确率 < 云侧；用户可接受"复核"
- ⚠️ P1 云端需自建 OCR 代理（小工作量）

## 验证

- W8 在真机上对 5 家主流银行/券商 App 截图做测试，端侧准确率 ≥ 70%