/**
 * Auth 服务初始化 + 应用启动
 *
 * mobile 启动时调用本模块：
 * - 注入 AuthClient（内存兜底 或 真实 supabase）
 * - 导出本地仓储单例（资产 / 快照）
 *
 * 云端同步不在本模块接线（避免与仓储单例形成循环依赖）：
 * 见 services/sync.ts，由 asset-store 在变更/加载时驱动。
 */

import { setAuthClient, InMemoryAuthClient, SupabaseAuthClient, type SupabaseLike } from '@family-wealth/api';
import { InMemoryAssetRepository, InMemorySnapshotRepository } from '@family-wealth/db';
import { supabase } from './supabase';

let isBootstrapped = false;

export function bootstrap() {
  if (isBootstrapped) return;

  if (supabase) {
    // 生产路径：真实 Supabase Auth + profiles 表（见 supabase/migrations）
    // 全应用内唯一一次 SDK 类型断言：之后一律走 SupabaseLike 最小接口
    setAuthClient(new SupabaseAuthClient(supabase as unknown as SupabaseLike));
  } else {
    // 开发兜底：无 env 配置时用内存 mock，便于 UI 联调
    console.warn('[bootstrap] 未配置 EXPO_PUBLIC_SUPABASE_URL/ANON_KEY，使用 InMemoryAuthClient');
    setAuthClient(new InMemoryAuthClient());
  }

  isBootstrapped = true;
}

/** 全局仓储单例（mobile 端应用生命周期内复用） */
export const assetRepository = new InMemoryAssetRepository();
export const snapshotRepository = new InMemorySnapshotRepository();
