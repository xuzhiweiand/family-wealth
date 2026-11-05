/**
 * 鸿蒙华为账号登录（Account Kit 授权登录，非一键登录）
 *
 * 通过自研 HuaweiAccount TurboModule 拉起系统账号授权页，拿到
 * authorizationCode + state；code 交由后端 huawei-auth Edge Function 换取
 * openID 与 Supabase 会话，App Secret 不下发到客户端。
 */

import type {
  HuaweiAuthFailureReason,
  HuaweiAuthResult,
} from './huawei-auth';

interface HuaweiAccountModule {
  /** 返回 JSON 字符串：{ authorizationCode, state } 或 { errorCode, errorMessage } */
  login(): Promise<string>;
}

interface NativeLoginResult {
  authorizationCode?: string;
  state?: string;
  errorCode?: number;
  errorMessage?: string;
}

let module: HuaweiAccountModule | null | undefined;

function getModule(): HuaweiAccountModule | null {
  if (module === undefined) {
    try {
      // 绕过 TS 类型：Platform.OS 不包含 'harmony'
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const rn = require('react-native');
      if (rn.Platform.OS === 'harmony') {
        module = rn.TurboModuleRegistry.getEnforcing('HuaweiAccount') as HuaweiAccountModule;
      } else {
        module = null;
      }
    } catch {
      module = null;
    }
  }
  return module ?? null;
}

export function isHuaweiAccountAvailable(): boolean {
  return getModule() !== null;
}

/** 用户取消授权（Account Kit 错误码 1001502012） */
const ERROR_USER_CANCEL = 1001502012;

function mapFailure(errorCode?: number, errorMessage?: string): HuaweiAuthFailureReason {
  if (errorCode === ERROR_USER_CANCEL) return 'cancelled';
  if (/cancel/i.test(errorMessage ?? '')) return 'cancelled';
  return 'failed';
}

async function execute(raw: Promise<string>): Promise<HuaweiAuthResult> {
  try {
    const parsed = JSON.parse(await raw) as NativeLoginResult;
    if (parsed.authorizationCode && parsed.state) {
      return {
        ok: true,
        data: { authorizationCode: parsed.authorizationCode, state: parsed.state },
      };
    }
    return {
      ok: false,
      reason: mapFailure(parsed.errorCode, parsed.errorMessage),
      message: parsed.errorMessage ?? '华为账号授权失败',
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      message: (err as Error)?.message ?? '华为账号授权失败',
    };
  }
}

export async function requestHuaweiAuthorization(): Promise<HuaweiAuthResult> {
  const m = getModule();
  if (!m) {
    return { ok: false, reason: 'unavailable', message: '当前设备不支持华为账号登录' };
  }
  return execute(m.login());
}
