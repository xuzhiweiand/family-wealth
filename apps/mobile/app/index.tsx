/**
 * 已登录主页（仪表盘冒烟版）
 */

import { YStack, Text, Card } from 'tamagui';
import { useAuthStore } from '../src/stores/auth-store';
import { useKeyStore } from '../src/stores/key-store';
import { deriveUMK, fromBase64 } from '@family-wealth/crypto';
import { useEffect } from 'react';

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const setUmk = useKeyStore((s) => s.setUmk);
  const umkLoaded = useKeyStore((s) => s.umk !== null);

  // 派生 UMK 并存入内存 key-store（实际场景：登录后立即派生，不在主页副作用里）
  useEffect(() => {
    if (user && !umkLoaded) {
      // 演示：派生 UMK 后立即清掉密码
      const salt = fromBase64(user.salt);
      const tempPassword = 'demo-not-real-password';
      const umk = deriveUMK(tempPassword, salt);
      setUmk(umk, 'demo-family');
    }
  }, [user, umkLoaded, setUmk]);

  return (
    <YStack flex={1} backgroundColor="$bgSecondary" padding="$lg" space="$md">
      <Text fontSize="$5" fontWeight="700" color="$textPrimary">
        欢迎，{user?.displayName ?? '用户'}
      </Text>
      <Text fontSize="$2" color="$textSecondary">
        会话 token：{session?.accessToken.slice(0, 12)}…
      </Text>
      <Card padded elevate backgroundColor="$bgPrimary" borderColor="$border" borderWidth={1} borderRadius="$lg">
        <Text fontSize="$3" color="$textSecondary">UMK 状态</Text>
        <Text fontSize="$4" fontWeight="600" color={umkLoaded ? '$primary' : '$debt'}>
          {umkLoaded ? '已派生 ✓' : '未派生 ✗'}
        </Text>
      </Card>
      <Card padded elevate backgroundColor="$bgPrimary" borderColor="$border" borderWidth={1} borderRadius="$lg">
        <Text fontSize="$3" color="$textSecondary">W2 进度</Text>
        <Text fontSize="$2" color="$textPrimary">· Tamagui 接入</Text>
        <Text fontSize="$2" color="$textPrimary">· 主密钥派生</Text>
        <Text fontSize="$2" color="$textPrimary">· Auth Store + 登录页</Text>
        <Text fontSize="$2" color="$textPrimary">· ADR 0005-0009</Text>
      </Card>
      <Text
        color="$primary"
        fontSize="$2"
        marginTop="$md"
        pressStyle={{ opacity: 0.6 }}
        onPress={() => signOut()}
      >
        退出登录
      </Text>
    </YStack>
  );
}