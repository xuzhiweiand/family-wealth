/**
 * 华为账号登录（Account Kit 授权登录）
 *
 * 默认平台（Android / iOS / 开发环境）不提供该系统能力，登录页据此隐藏入口。
 * 鸿蒙实现见 huawei-auth.harmony.ts（Account Kit AuthenticationController）。
 */

export interface HuaweiAuthorization {
  authorizationCode: string;
  state: string;
}

export type HuaweiAuthFailureReason = 'unavailable' | 'cancelled' | 'failed';

export type HuaweiAuthResult =
  | { ok: true; data: HuaweiAuthorization }
  | { ok: false; reason: HuaweiAuthFailureReason; message: string };

export function isHuaweiAccountAvailable(): boolean {
  return false;
}

export async function requestHuaweiAuthorization(): Promise<HuaweiAuthResult> {
  return {
    ok: false,
    reason: 'unavailable',
    message: '当前设备不支持华为账号登录',
  };
}
