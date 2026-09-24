/**
 * Supabase 客户端单例
 *
 * - 配置了 EXPO_PUBLIC_SUPABASE_URL / ANON_KEY 时创建真实客户端
 *   （腾讯云 CVM 自托管地址形如 http://<公网IP>:8000）
 * - 未配置时为 null：上层（auth 走 InMemory、sync 整体 no-op）
 *
 * 注意：必须在任何用到 @noble/hashes 的模块求值前由 bootstrap
 * 引用链间接加载，entry.js 已保证 react-native-get-random-values 最先执行。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'];
const supabaseAnonKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'];

export const isCloudEnabled = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
