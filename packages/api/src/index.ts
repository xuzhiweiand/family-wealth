/**
 * Auth Service 工厂 + 全局依赖注入
 *
 * mobile app 启动时调用 setAuthClient() 注入具体实现
 */

import type { AuthClient } from './types';

let client: AuthClient | null = null;

export function setAuthClient(c: AuthClient): void {
  client = c;
}

export function getAuthClient(): AuthClient {
  if (!client) throw new Error('AuthClient not initialized. Call setAuthClient() at app startup.');
  return client;
}

export * from './types';
export * from './in-memory';