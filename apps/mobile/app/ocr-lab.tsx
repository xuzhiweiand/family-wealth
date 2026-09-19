/**
 * OCR Lab —— 端侧 OCR 联调页（ADR-0008 / ADR-0011）
 *
 * 真机拿到一次识别结果后，把全文粘到这里 →
 * 立即看到 extractCandidates 排序后的候选 →
 * 点中正确项 → 复制生成一段 CorpusSample JSON，
 * 粘贴到 packages/ocr/src/__tests__/fixtures/corpus.ts 末尾即可回归。
 *
 * 用途：
 *   1. 真机识别偶尔拿不到期望值时，确认是「引擎识别错」还是「解析层排序错」
 *   2. 把真实样本喂回语料，把 top1 ≥ 70% / top3 ≥ 90% 护栏收紧到实测水位
 *   3. 离线时也能跑（不依赖相机），用 MockOcrEngine 验证流程
 *
 * ⚠️ 此页绕过 AuthGuard（仅开发态用），生产构建不会暴露入口（dev-only 提示）
 */

import { useState } from 'react';
import { ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Input, Text, XStack, YStack, TextArea } from 'tamagui';
import { extractCandidates, type AmountCandidate } from '@family-wealth/ocr';
import { blocksFromLines } from '@family-wealth/ocr';
import { formatCNY } from '@family-wealth/shared-utils';

interface DraftSample {
  id: string;
  source: string;
  difficulty: 'easy' | 'medium' | 'hard';
  lines: string[];
  expectedInCents: number;
  notes?: string;
}

function buildCorpusSnippet(d: DraftSample): string {
  // 与 fixtures/corpus.ts 中 CorpusSample 字面形状对齐 —— 粘贴即生效
  const linesLiteral = d.lines.map((l) => JSON.stringify(l)).join(',\n      ');
  const lines = `[\n      ${linesLiteral}\n    ]`;
  const noteSuffix = d.notes ? `\n    // ${d.notes.replace(/\n/g, ' ')}` : '';
  return `  {
    id: ${JSON.stringify(d.id)},
    source: ${JSON.stringify(d.source)},
    difficulty: ${JSON.stringify(d.difficulty)},
    lines: ${lines},
    expectedInCents: ${d.expectedInCents},${noteSuffix}
  },`;
}

export default function OcrLabScreen() {
  const router = useRouter();
  const [fullText, setFullText] = useState('');
  const [candidates, setCandidates] = useState<AmountCandidate[]>([]);
  const [picked, setPicked] = useState<AmountCandidate | null>(null);
  const [id, setId] = useState('');
  const [source, setSource] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [notes, setNotes] = useState('');

  function analyze() {
    const lines = fullText.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    if (lines.length === 0) {
      Alert.alert('空文本', '先粘一些 OCR 文本');
      return;
    }
    const blocks = blocksFromLines(lines, { confidence: 0.9 });
    const cands = extractCandidates(blocks);
    setCandidates(cands);
    setPicked(null);
  }

  function useTopAsExpected(c: AmountCandidate) {
    setPicked(c);
  }

  function generate() {
    if (!picked) {
      Alert.alert('还没点中正确候选', '请先在下方候选里点中你想录的那个金额');
      return;
    }
    if (id.trim() === '' || source.trim() === '') {
      Alert.alert('id / source 不能空', '给样本起个 id（英文短横线）+ source（哪个 App 哪个页面）');
      return;
    }
    const lines = fullText.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    const notesVal = notes.trim() || undefined;
    const snippet = buildCorpusSnippet({
      id: id.trim(),
      source: source.trim(),
      difficulty,
      lines,
      expectedInCents: picked.valueInCents,
      ...(notesVal ? { notes: notesVal } : {}),
    });
    Alert.alert('复制这段到 corpus.ts 末尾', snippet);
  }

  return (
    <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ paddingBottom: 32 }}>
      <YStack padding="$lg" space="$md">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">OCR Lab（开发态）</Text>
          <Button size="$3" backgroundColor="$bgPrimary" color="$primary" onPress={() => router.back()}>
            返回
          </Button>
        </XStack>

        <Text fontSize="$2" color="$textSecondary">
          真机识别后把识别到的文本粘到下面，立即看候选排序；点中正确项后即可生成 CorpusSample 代码片段。
        </Text>

        <YStack space="$xs">
          <Text fontSize="$2" color="$textSecondary">OCR 全文（每行一段，从真机 logcat / xcrun simctl 复制）</Text>
          <TextArea
            value={fullText}
            onChangeText={setFullText}
            placeholder={'招商银行\n储蓄卡(...)\n账户余额\n¥85,420.57\n转账'}
            backgroundColor="$bgPrimary"
            borderColor="$border"
            minHeight={160}
            multiline
          />
          <Button size="$3" backgroundColor="$primary" color="white" onPress={analyze}>
            解析
          </Button>
        </YStack>

        {candidates.length > 0 ? (
          <YStack space="$xs">
            <Text fontSize="$2" color="$textSecondary">
              候选（{candidates.length}） · 点中正确金额以填入 expectedInCents
            </Text>
            {candidates.slice(0, 8).map((c, i) => {
              const isPicked = picked && picked.raw === c.raw && picked.valueInCents === c.valueInCents;
              return (
                <Card
                  key={`${c.raw}-${i}`}
                  padded
                  backgroundColor={isPicked ? '$primary' : '$bgPrimary'}
                  borderColor="$border"
                  borderWidth={1}
                  borderRadius="$md"
                  pressStyle={{ opacity: 0.6 }}
                  onPress={() => useTopAsExpected(c)}
                >
                  <XStack justifyContent="space-between" alignItems="center">
                    <Text
                      fontSize="$4"
                      fontWeight="600"
                      color={isPicked ? 'white' : '$textPrimary'}
                    >
                      {formatCNY(c.valueInCents)}
                    </Text>
                    <Text
                      fontSize="$1"
                      color={isPicked ? 'white' : '$textSecondary'}
                    >
                      {c.keyword ?? (c.reason === 'currency-symbol' ? '带货币符号' : '纯数字')} ·{' '}
                      {Math.round(c.score * 100)}%
                    </Text>
                  </XStack>
                  <Text fontSize="$1" color={isPicked ? 'white' : '$textSecondary'}>
                    原文：{c.raw}
                  </Text>
                </Card>
              );
            })}
          </YStack>
        ) : null}

        <YStack space="$xs">
          <Text fontSize="$2" color="$textSecondary">id（短横线命名，如 alipay-my-2026-09-08）</Text>
          <Input value={id} onChangeText={setId} backgroundColor="$bgPrimary" borderColor="$border" />
        </YStack>
        <YStack space="$xs">
          <Text fontSize="$2" color="$textSecondary">source（哪个 App / 哪个页面）</Text>
          <Input value={source} onChangeText={setSource} backgroundColor="$bgPrimary" borderColor="$border" />
        </YStack>
        <YStack space="$xs">
          <Text fontSize="$2" color="$textSecondary">difficulty</Text>
          <XStack space="$xs">
            {(['easy', 'medium', 'hard'] as const).map((d) => (
              <Button
                key={d}
                size="$3"
                backgroundColor={d === difficulty ? '$primary' : '$bgPrimary'}
                color={d === difficulty ? 'white' : '$textPrimary'}
                onPress={() => setDifficulty(d)}
              >
                {d}
              </Button>
            ))}
          </XStack>
        </YStack>
        <YStack space="$xs">
          <Text fontSize="$2" color="$textSecondary">notes（可选）</Text>
          <Input value={notes} onChangeText={setNotes} backgroundColor="$bgPrimary" borderColor="$border" />
        </YStack>

        <Button size="$4" backgroundColor="$primary" color="white" onPress={generate} disabled={!picked}>
          生成 CorpusSample 片段
        </Button>
      </YStack>
    </ScrollView>
  );
}