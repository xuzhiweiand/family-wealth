/**
 * Auth 服务初始化 + 应用启动
 *
 * mobile 启动时调用本模块：
 * - 注入 AuthClient（mock 或真实 supabase）
 * - 注入 AssetRepository
 * - hydrate 当前会话
 */

import { setAuthClient, InMemoryAuthClient } from '@family-wealth/api';
import { InMemoryAssetRepository, InMemorySnapshotRepository } from '@family-wealth/db';

let isBootstrapped = false;

export function bootstrap() {
  if (isBootstrapped) return;
  setAuthClient(new InMemoryAuthClient());
  isBootstrapped = true;
}

/** 全局仓储单例（mobile 端应用生命周期内复用） */
export const assetRepository = new InMemoryAssetRepository();
export const snapshotRepository = new InMemorySnapshotRepository();