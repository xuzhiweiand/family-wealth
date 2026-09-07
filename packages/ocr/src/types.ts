/**
 * OCR 类型定义（对齐 ADR-0008：端侧优先，云侧做 P1 增强）
 *
 * 端侧引擎只负责「把图变成带坐标的文本」，
 * 从文本里认出哪个数字是余额，由 parse.ts 的纯函数完成（可单测、可离线）。
 */

/** 文本框（归一化坐标或像素均可，本包不做坐标系假设） */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 端侧识别出的一个文本块（通常是一行） */
export interface OcrBlock {
  text: string;
  bbox: BoundingBox;
  /** 引擎给出的识别置信度 0~1 */
  confidence: number;
}

/** 候选金额是怎么被认出来的 —— 影响 UI 上要不要高亮提示 */
export type AmountReason =
  /** 附近有金额关键词（"余额"、"总资产"…） */
  | 'keyword'
  /** 带货币符号（¥ / ￥ / 元） */
  | 'currency-symbol'
  /** 光秃秃一个数字，只能靠位置猜 */
  | 'bare-number';

/** 从 OCR 文本里解析出的金额候选 */
export interface AmountCandidate {
  /** 金额，单位「分」（与全库一致，避免浮点误差） */
  valueInCents: number;
  /** 命中的原始文本片段，UI 复核时展示 */
  raw: string;
  /** 命中的关键词；currency-symbol / bare-number 时为 null */
  keyword: string | null;
  /** 综合置信度 0~1（关键词权重 + 符号 + 引擎置信度） */
  score: number;
  reason: AmountReason;
  /** 来源文本块（便于 UI 上框选定位） */
  block: OcrBlock;
}

export interface OcrResult {
  fullText: string;
  blocks: OcrBlock[];
  /** 按 score 降序排好的金额候选 */
  amountCandidates: AmountCandidate[];
}

/** 端侧 OCR 引擎接口 */
export interface OcrEngine {
  recognize(imageUri: string): Promise<OcrResult>;
}
