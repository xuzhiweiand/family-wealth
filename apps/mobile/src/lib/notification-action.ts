/**
 * 通知点击动作队列（P0-1）。
 *
 * 通知被点击时可能处于三种状态：App 未启动（冷启动）、在前台、在后台。
 * 统一入队，待 navigationRef ready 且已登录后消费 → 直达录入页。
 */

import { navigationRef } from './navigation';
import { useAuthStore } from '../stores/auth-store';

let pendingOpenAssetNew = false;

/** 通知点击：请求跳转到录入页（可能在登录前，先挂起） */
export function queueOpenAssetNew(): void {
  pendingOpenAssetNew = true;
  consumePendingNavigation();
}

/** 在导航就绪 / 登录态变化后调用，消费挂起的跳转 */
export function consumePendingNavigation(): void {
  if (!pendingOpenAssetNew) return;
  if (!navigationRef.isReady()) return;
  if (useAuthStore.getState().status !== 'authenticated') return;
  pendingOpenAssetNew = false;
  navigationRef.navigate('AssetNew' as never);
}
