/**
 * 加入家庭：输入邀请码 → 解封 FDK → 加入
 *
 * 用户在这一页交出的不只是「资格」，而是把家庭密钥接到自己名下：
 * 解出的 FDK 会立刻用自己的 UMK 重新包裹存档，之后每次登录都凭自己的
 * 密码取回，不再依赖邀请码（短码只在这一个时刻用一次）。
 */

import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Button, Card, Input, Text, XStack, YStack } from 'tamagui';
import { normalizeInviteCode } from '@family-wealth/crypto';
import { useFamilyStore } from '../src/stores/family-store';

const WARN_COLOR = '#DC2626';

export default function JoinFamilyScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');

  const joinByCode = useFamilyStore((s) => s.joinByCode);
  const loading = useFamilyStore((s) => s.loading);
  const error = useFamilyStore((s) => s.error);

  const canSubmit = normalizeInviteCode(code).length >= 6;

  async function onSubmit() {
    const ok = await joinByCode(code);
    if (ok) router.replace('/');
  }

  return (
    <YStack flex={1} backgroundColor="$bgSecondary" padding="$lg" space="$md" justifyContent="center">
      <Card padded elevate backgroundColor="$bgPrimary" borderColor="$border" borderWidth={1} borderRadius="$lg">
        <YStack space="$md">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            加入家庭
          </Text>
          <Text fontSize="$2" color="$textSecondary">
            输入家人给你的邀请码（一次性，15 分钟内有效）。加入后家庭数据密钥会安全地交到你手里，
            之后凭你自己的密码即可访问，无需再输邀请码。
          </Text>

          <Input
            size="$4"
            value={code}
            onChangeText={setCode}
            placeholder="如 K7M2-X9AB"
            autoCapitalize="characters"
            autoCorrect={false}
            keyboardType="default"
            textAlign="center"
            fontSize="$6"
            fontWeight="700"
            letterSpacing={2}
          />

          <Button
            size="$4"
            backgroundColor={canSubmit ? '$primary' : '$border'}
            color={canSubmit ? 'white' : '$textSecondary'}
            disabled={!canSubmit || loading}
            onPress={() => void onSubmit()}
          >
            {loading ? '验证中…' : '加入家庭'}
          </Button>

          {error ? (
            <Text fontSize="$2" color={WARN_COLOR}>
              {error}
            </Text>
          ) : null}
        </YStack>
      </Card>

      <XStack justifyContent="center">
        <Text fontSize="$2" color="$primary" onPress={() => router.back()}>
          返回
        </Text>
      </XStack>
    </YStack>
  );
}
