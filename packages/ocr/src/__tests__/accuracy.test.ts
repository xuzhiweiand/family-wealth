/**
 * 准确率护栏
 *
 * 这不是「证明解析器好」的测试，而是「解析器不许悄悄变差」的测试：
 *   - top-1 率 ≥ 70%：用户打开候选列表时，第一个就是对的
 *   - top-3 率 ≥ 90%：前三名里有正确答案（点选即可）
 *   - 每个样本至少要出一个候选：连候选都不给 = 功能不可用
 *
 * ADR-0008 给端侧 OCR 定的目标是 70-80%（真机实测），
 * 解析层是纯函数，应该显著高于这个数；这里的阈值留了余量，
 * 真机语料接入后可以逐步收紧。
 */

import { extractCandidates } from '../parse';
import { OCR_CORPUS, corpusToBlocks, type CorpusSample } from './fixtures/corpus';

interface SampleResult {
  sample: CorpusSample;
  top1Hit: boolean;
  top3Hit: boolean;
  producedCandidate: boolean;
  top1Value: number | null;
}

function runCorpus(): SampleResult[] {
  return OCR_CORPUS.map((sample) => {
    const candidates = extractCandidates(corpusToBlocks(sample));
    const top3 = candidates.slice(0, 3).map((c) => c.valueInCents);
    return {
      sample,
      producedCandidate: candidates.length > 0,
      top1Hit: candidates[0]?.valueInCents === sample.expectedInCents,
      top3Hit: top3.includes(sample.expectedInCents),
      top1Value: candidates[0]?.valueInCents ?? null,
    };
  });
}

const results = runCorpus();

function rate(pick: (r: SampleResult) => boolean): number {
  return results.filter(pick).length / results.length;
}

function failures(pick: (r: SampleResult) => boolean): string {
  return results
    .filter((r) => pick(r))
    .map((r) => `${r.sample.id}(${r.sample.source}) 期望=${r.sample.expectedInCents} 实际top1=${r.top1Value}`)
    .join('\n');
}

describe('OCR accuracy over corpus', () => {
  it('corpus is non-trivial (>= 20 samples, all difficulties covered)', () => {
    expect(OCR_CORPUS.length).toBeGreaterThanOrEqual(20);
    const difficulties = new Set(OCR_CORPUS.map((s) => s.difficulty));
    expect(difficulties).toEqual(new Set(['easy', 'medium', 'hard']));
  });

  it('every sample produces at least one candidate', () => {
    const missing = failures((r) => !r.producedCandidate);
    expect(missing).toBe('');
  });

  it('top-1 hit rate >= 70%', () => {
    expect(rate((r) => r.top1Hit)).toBeGreaterThanOrEqual(0.7);
  });

  it('top-3 hit rate >= 90%', () => {
    const missing = failures((r) => !r.top3Hit);
    if (missing !== '') {
      throw new Error(`top-3 misses:\n${missing}`);
    }
    expect(rate((r) => r.top3Hit)).toBeGreaterThanOrEqual(0.9);
  });

  it('easy samples: the amount and keyword share a line, top-1 must hit', () => {
    const missing = failures((r) => r.sample.difficulty === 'easy' && !r.top1Hit);
    if (missing !== '') {
      throw new Error(`easy samples missing top-1:\n${missing}`);
    }
  });
});

/** 逐样本明细：失败时报出具体场景，便于定位是哪类页面退化 */
describe.each(OCR_CORPUS)('corpus sample %s', (sample) => {
  it(`expects ${sample.expectedInCents} cents in top-3 (${sample.source})`, () => {
    const candidates = extractCandidates(corpusToBlocks(sample));
    const top3 = candidates.slice(0, 3).map((c) => c.valueInCents);
    if (!top3.includes(sample.expectedInCents)) {
      throw new Error(
        `expected ${sample.expectedInCents} in top-3, got [${top3.join(', ')}] ` +
        `from candidates [${candidates.slice(0, 5).map((c) => `${c.valueInCents}(${c.reason})`).join(', ')}]`,
      );
    }
    expect(true).toBe(true);
  });
});
