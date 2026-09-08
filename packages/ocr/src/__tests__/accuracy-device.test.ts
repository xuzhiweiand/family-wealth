/**
 * 真机 OCR 样本护栏（CI 自动 skip：无 device-samples.jsonl 时）
 *
 * 设计要点：
 *   1. 找不到 device-samples.jsonl → 静默 skip，不挡 CI
 *   2. 找到但样本 < 3 条 → warn 并 skip（样本太少没统计意义）
 *   3. 找到 ≥ 3 条 → 跑同样的 top-1 / top-3 护栏（阈值同语料版）
 *
 * 这层测试的目的不是「再写一次断言」，而是「让真机数据每次提交都能回归」——
 * 你把新样本追加进 JSONL，下次跑 test 时如果哪个样本 top-1 突然退化，名字
 * + 期望值 + top-1 候选会直接打到测试报告里。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractCandidates } from '../parse';
import { corpusToBlocks } from './fixtures/corpus';
import { parseDeviceSamplesJsonl, deviceToCorpus } from './fixtures/device-samples';

const SAMPLE_FILE = resolve(__dirname, '..', '..', '..', 'device-samples.jsonl');

interface SampleResult {
  id: string;
  expected: number;
  top1Hit: boolean;
  top3Hit: boolean;
  top1Value: number | null;
  top3Values: number[];
}

function runDeviceAccuracy(): { results: SampleResult[]; errors: string[] } | null {
  if (!existsSync(SAMPLE_FILE)) return null;
  const raw = readFileSync(SAMPLE_FILE, 'utf8');
  const { samples, errors } = parseDeviceSamplesJsonl(raw);
  if (samples.length === 0) return null;

  const results = samples.map((s) => {
    const corpus = deviceToCorpus(s);
    const candidates = extractCandidates(corpusToBlocks(corpus));
    const top3 = candidates.slice(0, 3).map((c) => c.valueInCents);
    return {
      id: s.id,
      expected: s.expectedInCents,
      top1Hit: candidates[0]?.valueInCents === s.expectedInCents,
      top3Hit: top3.includes(s.expectedInCents),
      top1Value: candidates[0]?.valueInCents ?? null,
      top3Values: top3,
    };
  });
  return { results, errors };
}

describe('OCR accuracy over device samples', () => {
  const data = runDeviceAccuracy();

  if (!data) {
    it.skip('device-samples.jsonl not found or empty — create one to enable this guard', () => {});
    return;
  }

  const { results, errors } = data;

  it('parses cleanly (no JSON errors)', () => {
    // 把 JSON 错误直接打到 stderr 后面追加信息
    if (errors.length > 0) {
      throw new Error(`JSONL 解析问题：\n${errors.join('\n')}`);
    }
    expect(errors).toEqual([]);
  });

  it('sample count is meaningful (>= 3)', () => {
    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  it('every sample produces at least one candidate', () => {
    const missing = results.filter((r) => r.top1Value === null).map((r) => r.id);
    expect(missing).toEqual([]);
  });

  it('top-1 hit rate >= 70%', () => {
    const rate = results.filter((r) => r.top1Hit).length / results.length;
    if (rate < 0.7) {
      const detail = results
        .filter((r) => !r.top1Hit)
        .map((r) => `${r.id} 期望=${r.expected} top1=${r.top1Value} top3=[${r.top3Values.join(',')}]`)
        .join('\n');
      throw new Error(`top-1 ${(rate * 100).toFixed(1)}%（阈值 70%）\n未中明细：\n${detail}`);
    }
    expect(rate).toBeGreaterThanOrEqual(0.7);
  });

  it('top-3 hit rate >= 90%', () => {
    const rate = results.filter((r) => r.top3Hit).length / results.length;
    if (rate < 0.9) {
      const detail = results
        .filter((r) => !r.top3Hit)
        .map((r) => `${r.id} 期望=${r.expected} top3=[${r.top3Values.join(',')}]`)
        .join('\n');
      throw new Error(`top-3 ${(rate * 100).toFixed(1)}%（阈值 90%）\n未中明细：\n${detail}`);
    }
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });
});