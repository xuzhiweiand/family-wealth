/**
 * Auth 服务初始化 + 应用启动
 *
 * mobile 启动时调用本模块：
 * - 注入 AuthClient（mock 或真实 supabase）
 * - 注入 AssetRepository
 * - hydrate 当前会话
 */

import { createClient } from '@supabase/supabase-js';
import { setAuthClient, InMemoryAuthClient, SupabaseAuthClient } from '@family-wealth/api';
import { InMemoryAssetRepository, InMemorySnapshotRepository } from '@family-wealth/db';

let isBootstrapped = false;

export function bootstrap() {
  if (isBootstrapped) return;

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseAnonKey) {
    // 生产路径：真实 Supabase Auth + profiles 表（见 supabase/migrations）
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    setAuthClient(new SupabaseAuthClient(supabase));
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