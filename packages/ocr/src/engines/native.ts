/**
 * 端侧 OCR 引擎（ADR-0008）
 *
 * iOS     → Vision.framework (VNRecognizeTextRequest)
 * Android → Google ML Kit Text Recognition
 * 二者由 @react-native-ml-kit/text-recognition 统一封装，模型在设备本地，图片不出端。
 *
 * ⚠️ 本文件依赖 native 模块，已从 tsconfig 中 exclude（本机沙箱装不了 native 依赖）。
 *    真机 prebuild 后由 Metro 编译，请在设备上验证。
 */

import { extractCandidates } from '../parse';
import type { OcrBlock, OcrEngine, OcrResult } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MlKit = { recognize(uri: string): Promise<{ text?: string; blocks?: any[] }> };

interface MlKitFrame {
  x?: number;
  y?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

function toBbox(frame: MlKitFrame | undefined): OcrBlock['bbox'] {
  return {
    x: frame?.x ?? frame?.left ?? 0,
    y: frame?.y ?? frame?.top ?? 0,
    width: frame?.width ?? 0,
    height: frame?.height ?? 0,
  };
}

export class NativeOcrEngine implements OcrEngine {
  // 延迟 require：避免在测试/无原生环境下一 import 就崩
  private async load(): Promise<MlKit> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-ml-kit/text-recognition');
    return (mod.default ?? mod) as MlKit;
  }

  async recognize(imageUri: string): Promise<OcrResult> {
    const engine = await this.load();
    const raw = await engine.recognize(imageUri);
    const blocks: OcrBlock[] = (raw.blocks ?? []).map((b) => ({
      text: String(b.text ?? ''),
      bbox: toBbox(b.frame),
      // ML Kit 不逐块返回置信度，给一个中性值，让排序主要由关键词权重决定
      confidence: 0.9,
    }));
    return {
      fullText: raw.text ?? blocks.map((b) => b.text).join('\n'),
      blocks,
      amountCandidates: extractCandidates(blocks),
    };
  }
}
