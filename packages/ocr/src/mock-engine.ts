import { extractCandidates } from './parse';
import type { OcrBlock, OcrEngine, OcrResult } from './types';

/**
 * 把纯文本行转成 OcrBlock —— 测试与 UI 预览用。
 * 真实设备上由端侧引擎产出等价结构。
 */
export function blocksFromLines(
  lines: readonly string[],
  options?: { confidence?: number; lineHeight?: number },
): OcrBlock[] {
  const confidence = options?.confidence ?? 0.9;
  const lineHeight = options?.lineHeight ?? 24;
  return lines.map((text, i) => ({
    text,
    bbox: { x: 0, y: i * lineHeight, width: text.length * 12, height: lineHeight },
    confidence,
  }));
}

/**
 * 内存 OCR 引擎：按 imageUri 返回预置的识别结果。
 * 用于单测与「没有真机也能跑通录入流程」的开发态。
 */
export class MockOcrEngine implements OcrEngine {
  private readonly fixtures: Record<string, readonly OcrBlock[]>;

  constructor(fixtures: Record<string, readonly OcrBlock[]> = {}) {
    this.fixtures = fixtures;
  }

  async recognize(imageUri: string): Promise<OcrResult> {
    const source = this.fixtures[imageUri] ?? [];
    const blocks: OcrBlock[] = source.map((b) => ({
      text: b.text,
      bbox: { ...b.bbox },
      confidence: b.confidence,
    }));
    return {
      fullText: blocks.map((b) => b.text).join('\n'),
      blocks,
      amountCandidates: extractCandidates(blocks),
    };
  }
}
