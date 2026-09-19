/**
 * 家庭页：成员管理 + 邀请 + 轮换
 *
 * 权限按钮的可用性全部来自 packages/family 的纯函数裁决（can /
 * checkMemberRemoval），服务端仍会再校验一次——这里的禁用只是 UX。
 */

import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { Button, Card, Text, XStack, YStack } from 'tamagui';
import { ROLE_LABELS, can } from '@family-wealth/family';
import { useAuthStore } from '../src/stores/auth-store';
import { useFamilyStore } from '../src/stores/family-store';

/** 撤销成员后未轮换 → 必须强提示（ADR-0010） */
const WARN_COLOR = '#DC2626';

export default function FamilyScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const family = useFamilyStore((s) => s.family);
  const members = useFamilyStore((s) => s.members);
  const rotationPending = useFamilyStore((s) => s.rotationPending);
  const activeInvite = useFamilyStore((s) => s.activeInvite);
  const notice = useFamilyStore((s) => s.notice);
  const error = useFamilyStore((s) => s.error);
  const refresh = useFamilyStore((s) => s.refresh);
  const createFamily = useFamilyStore((s) => s.createFamily);
  const makeInvite = useFamilyStore((s) => s.makeInvite);
  const removeMember = useFamilyStore((s) => s.removeMember);
  const rotateNow = useFamilyStore((s) => s.rotateNow);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const myRole = members.find((m) => m.userId === user?.id)?.role ?? 'viewer';
  const activeMembers = members.filter((m) => m.revokedAt === null);
  const revokedMembers = members.filter((m) => m.revokedAt !== null);

  if (!family) {
    return (
      <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ padding: 24, flexGrow: 1 }}>
        <YStack space="$lg" marginTop="$xl">
          <Text fontSize="$6" fontWeight="700" color="$textPrimary">
            家庭共享
          </Text>
          <Text fontSize="$2" color="$textSecondary">
            家庭数据端到端加密：服务端只见密文。邀请成员时，家庭密钥会通过邀请码安全地交到对方手里。
          </Text>
          <Button size="$4" backgroundColor="$primary" color="white" onPress={() => createFamily('我的家庭')}>
            创建家庭
          </Button>
          <Button
            size="$4"
            onPress={() => router.push('/join')}
          >
            输入邀请码加入
          </Button>
          {error ? (
            <Text fontSize="$2" color={WARN_COLOR}>
              {error}
            </Text>
          ) : null}
        </YStack>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ padding: 24 }}>
      <YStack space="$md">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontSize="$6" fontWeight="700" color="$textPrimary">
            {family.name}
          </Text>
          <Text fontSize="$2" color="$primary" onPress={() => router.back()}>
            返回
          </Text>
        </XStack>

        {notice ? (
          <Card padded backgroundColor="$bgPrimary" borderColor={WARN_COLOR} borderWidth={1} borderRadius="$md">
            <Text fontSize="$2" color="$textPrimary">
              {notice}
            </Text>
          </Card>
        ) : null}

        {rotationPending ? (
          <Card padded backgroundColor="$bgPrimary" borderColor={WARN_COLOR} borderWidth={2} borderRadius="$md">
            <Text fontSize="$3" fontWeight="700" color={WARN_COLOR}>
              ⚠ 有成员被移除但密钥尚未轮换
            </Text>
            <Text fontSize="$1" color="$textSecondary" marginTop="$xs">
              被移除的成员将无法读取新数据，但其在撤销前已下载的数据仍可被其解开。轮换后彻底切断。
            </Text>
            {can(myRole, 'rotate_family_key') ? (
              <Button size="$2" backgroundColor={WARN_COLOR} color="white" marginTop="$sm" onPress={rotateNow}>
                立即轮换密钥
              </Button>
            ) : null}
          </Card>
        ) : null}

        <Text fontSize="$4" fontWeight="600" color="$textPrimary">
          成员（{activeMembers.length}）
        </Text>

        {activeMembers.map((m) => (
          <Card key={m.id} padded elevate backgroundColor="$bgPrimary" borderColor="$border" borderWidth={1} borderRadius="$md">
            <XStack justifyContent="space-between" alignItems="center">
              <YStack>
                <Text fontSize="$4" fontWeight="600" color="$textPrimary">
                  {m.displayName}
                  {m.userId === user?.id ? '（我）' : ''}
                </Text>
                <Text fontSize="$1" color="$textSecondary">
                  {ROLE_LABELS[m.role]} · 加入于 {m.joinedAt.slice(0, 10)}
                </Text>
              </YStack>
              {can(myRole, 'remove_member') && m.userId !== user?.id ? (
                <Button size="$2" onPress={() => removeMember(m.userId)}>
                  移除
                </Button>
              ) : null}
            </XStack>
          </Card>
        ))}

        {revokedMembers.length > 0 ? (
          <Text fontSize="$1" color="$textSecondary">
            已移除 {revokedMembers.length} 人（保留记录用于审计）
          </Text>
        ) : null}

        <Text
          fontSize="$2"
          color="$primary"
          marginTop="$sm"
          pressStyle={{ opacity: 0.6 }}
          onPress={() => router.push('/asset/trash')}
        >
          回收站 ›
        </Text>

        <Text fontSize="$4" fontWeight="600" color="$textPrimary" marginTop="$md">
          邀请成员
        </Text>

        {can(myRole, 'invite_member') ? (
          <YStack space="$sm">
            <Text fontSize="$1" color="$textSecondary">
              邀请码 15 分钟内有效、仅可使用一次。生成后请当面或私下告知对方，不要发到群里。
            </Text>
            <Button size="$3" backgroundColor="$primary" color="white" onPress={makeInvite}>
              生成邀请码
            </Button>
            {activeInvite ? (
              <Card padded elevate backgroundColor="$bgPrimary" borderColor="$primary" borderWidth={2} borderRadius="$md">
                <Text fontSize="$1" color="$textSecondary">
                  邀请码（一次性 · {activeInvite.expiresAt.slice(11, 16)} 过期）
                </Text>
                <Text fontSize="$8" fontWeight="700" color="$textPrimary" marginTop="$xs" letterSpacing={2}>
                  {activeInvite.displayCode}
                </Text>
                <Text fontSize="$1" color="$textSecondary" marginTop="$xs">
                  对方在「加入家庭」页输入此码即可获得家庭密钥
                </Text>
              </Card>
            ) : null}
          </YStack>
        ) : (
          <Text fontSize="$1" color="$textSecondary">
            只有管理员可以邀请成员
          </Text>
        )}

        {error ? (
          <Text fontSize="$2" color={WARN_COLOR}>
            {error}
          </Text>
        ) : null}
      </YStack>
    </ScrollView>
  );
}
