/**
 * 真机 OCR 样本导入工具
 *
 * 工作流：
 *   1. 真机拍 5-10 个不同场景
 *   2. 每个场景把识别全文记一行（用 - 作为分隔符，英文逗号不安全因为 OCR 文本里常有逗号）
 *      或者用 jsonl 一行一条
 *   3. 把样本贴到 `device-samples.jsonl`（gitignored），按下面 DeviceSample 形状
 *   4. 跑 `pnpm test -- accuracy-device`，` 会自动读取该文件并跑护栏
 *
 * DeviceSample 字段：
 *   id         短横线 ID
 *   source     哪个 App / 哪个页面（自由文本）
 *   difficulty easy / medium / hard
 *   lines      OCR 全文（按屏幕自上而下顺序）
 *   expectedInCents 用户实际想录的那个数
 *   engine     "mlkit" / "vision" / "mock"（真机识别的引擎，用于打点回归）
 *
 * ⚠️ 这个文件不能作为单元测试入口 —— 它从磁盘读 JSONL，
 *    CI 没有这份文件就跑空集合。accuracy-device.test.ts 会自动 skip。
 */

import type { CorpusSample } from './corpus';

export interface DeviceSample extends CorpusSample {
  /** 真机引擎标识，便于打点回归（mlkit / vision） */
  engine?: string;
  /** 真机拍摄时间（ISO 8601），便于追溯 */
  capturedAt?: string;
}

/**
 * 把 device-samples.jsonl 解析成样本数组；解析失败累积到 errors（不抛，便于 CI 报告）。
 * 每行必须是合法 JSON；空行与 # 开行跳过。
 */
export function parseDeviceSamplesJsonl(raw: string): {
  samples: DeviceSample[];
  errors: string[];
} {
  const samples: DeviceSample[] = [];
  const errors: string[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (line === '' || line.startsWith('#')) continue;
    try {
      const obj = JSON.parse(line) as DeviceSample;
      // 最小校验
      if (!obj.id || !obj.lines || typeof obj.expectedInCents !== 'number') {
        errors.push(`第 ${i + 1} 行：缺少 id/lines/expectedInCents`);
        continue;
      }
      samples.push(obj);
    } catch (e) {
      errors.push(`第 ${i + 1} 行 JSON 解析失败：${(e as Error).message}`);
    }
  }
  return { samples, errors };
}

/** 把 device 样本转成与 OCR_CORPUS 同一接口 —— 直接喂给准确率测试 */
export function deviceToCorpus(s: DeviceSample): CorpusSample {
  return {
    id: s.id,
    source: s.source,
    difficulty: s.difficulty,
    lines: s.lines,
    expectedInCents: s.expectedInCents,
  };
}