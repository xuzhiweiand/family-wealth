/**
 * 端侧 OCR 引擎入口
 *
 * 默认用 NativeOcrEngine（iOS Vision / Android ML Kit，图片不出设备，见 ADR-0008）。
 * 引擎内部是延迟 require，所以在本机/Expo Go 缺原生模块时也不会一启动就崩；
 * 真到识别那一步失败，上层会提示改用手动输入。
 */

import { MockOcrEngine, NativeOcrEngine, type OcrEngine } from '@family-wealth/ocr';

let cached: OcrEngine | null = null;

export function getOcrEngine(): OcrEngine {
  if (cached === null) {
    cached = process.env['EXPO_PUBLIC_USE_MOCK_OCR'] === '1' ? new MockOcrEngine() : new NativeOcrEngine();
  }
  return cached;
}

/** 供开发/预览替换成内存引擎 */
export function setOcrEngine(engine: OcrEngine | null): void {
  cached = engine;
}
