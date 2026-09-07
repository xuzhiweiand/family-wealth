import { MockOcrEngine, blocksFromLines } from '../mock-engine';
import type { OcrBlock } from '../types';

const BANK_SCREENSHOT = [
  '招商银行',
  '储蓄卡 6222 **** **** 1234',
  '2026-09-07',
  '账户余额',
  '¥128,543.68',
  '可用余额 ¥120,000.00',
  '七日年化 2.35%',
];

describe('blocksFromLines', () => {
  it('lays lines out top-to-bottom with sane boxes', () => {
    const blocks = blocksFromLines(['a', 'bb'], { lineHeight: 30 });
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.bbox.y).toBe(30);
    expect(blocks[0]!.confidence).toBeGreaterThan(0);
  });
});

describe('MockOcrEngine', () => {
  it('returns empty result for an unknown uri', async () => {
    const engine = new MockOcrEngine();
    const result = await engine.recognize('file://unknown.png');
    expect(result.blocks).toEqual([]);
    expect(result.fullText).toBe('');
    expect(result.amountCandidates).toEqual([]);
  });

  it('joins block text into fullText', async () => {
    const engine = new MockOcrEngine({ 'a.png': blocksFromLines(['账户余额', '¥100.00']) });
    const result = await engine.recognize('a.png');
    expect(result.fullText).toBe('账户余额\n¥100.00');
  });

  it('extracts amount candidates and ranks the labelled one first', async () => {
    const engine = new MockOcrEngine({ 'shot.png': blocksFromLines(BANK_SCREENSHOT) });
    const result = await engine.recognize('shot.png');
    expect(result.amountCandidates.length).toBeGreaterThan(0);
    expect(result.amountCandidates[0]!.keyword).toBe('可用余额');
    expect(result.amountCandidates[0]!.valueInCents).toBe(12_000_000);
  });

  it('does not leak the fixture array to callers', async () => {
    const blocks: OcrBlock[] = blocksFromLines(['账户余额 ¥100.00']);
    const engine = new MockOcrEngine({ 'a.png': blocks });
    const result = await engine.recognize('a.png');
    result.blocks[0]!.text = 'mutated';
    expect(blocks[0]!.text).toBe('账户余额 ¥100.00');
  });
});
