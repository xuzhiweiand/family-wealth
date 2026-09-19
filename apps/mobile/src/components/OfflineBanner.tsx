/**
 * 离线状态条（技术方案 §13.2）
 *
 * 无网络时在内容顶部显示黄条：「离线模式 · 变更将在联网后同步」。
 * 本地优先架构下录入/查看不受影响，云端同步延后。
 */

import { XStack, Text } from 'tamagui';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export interface OfflineBannerProps {
  /** 为 true 时即使在线也不渲染（默认 false） */
  hidden?: boolean;
}

export function OfflineBanner({ hidden = false }: OfflineBannerProps) {
  const { isConnected } = useNetworkStatus();
  if (hidden || isConnected) return null;
  return (
    <XStack
      backgroundColor="#FEF3C7"
      borderBottomColor="#FDE68A"
      borderBottomWidth={1}
      paddingVertical="$xs"
      paddingHorizontal="$md"
      alignItems="center"
      space="$xs"
    >
      <Text fontSize="$1" color="#92400E">●</Text>
      <Text fontSize="$1" color="#92400E" fontWeight="600">
        离线模式 · 变更将在联网后同步
      </Text>
    </XStack>
  );
}
