/**
 * 华为账号登录 TurboModule（ArkTS 侧，Account Kit 授权登录）
 *
 * 拉起华为账号授权页，拿到 authorizationCode + state 后原样返回 JS；
 * code 只由后端 huawei-auth Edge Function 兑换 token，App Secret 不下发。
 *
 * 模块名 HuaweiAccount：JS 侧 TurboModuleRegistry、本文件、
 * C++ HuaweiAccountPackage.h 三处必须一致。
 */

import { TurboModule, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { authentication } from '@kit.AccountKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';

const TAG = 'HuaweiAccount';

/** Account Kit 错误码（鸿蒙 NEXT） */
const ERROR_USER_CANCEL = 1001502012;
const ERROR_LOGIN_OUT = 1001502001;

interface LoginResult {
  authorizationCode?: string;
  state?: string;
  errorCode?: number;
  errorMessage?: string;
}

export class HuaweiAccountTurboModule extends TurboModule {
  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  /**
   * 拉起系统账号授权页
   *
   * @returns JSON 串；成功 {"authorizationCode": "...", "state": "..."}，
   *          失败 {"errorCode": 1001502012, "errorMessage": "..."}
   */
  async login(): Promise<string> {
    try {
      const loginRequest = new authentication.HuaweiIDProvider().createLoginWithHuaweiIDRequest();
      // true：用户未登录或未授权时拉起登录/授权页
      loginRequest.forceLogin = true;
      loginRequest.state = util.generateRandomUUID();

      const controller = new authentication.AuthenticationController(
        this.ctx.uiAbilityContext as common.Context,
      );
      const response = await controller.executeRequest(loginRequest);
      const loginResponse = response as authentication.LoginWithHuaweiIDResponse;

      const requestState = loginRequest.state || '';
      const responseState = loginResponse.state || '';
      if (requestState !== responseState) {
        console.error(`${TAG}: state mismatch`);
        const result: LoginResult = {
          errorCode: -1,
          errorMessage: '授权校验失败（state 不一致），请重试',
        };
        return JSON.stringify(result);
      }

      const authorizationCode = loginResponse.data?.authorizationCode;
      if (!authorizationCode) {
        const result: LoginResult = {
          errorCode: -1,
          errorMessage: '未获取到授权码，请重试',
        };
        return JSON.stringify(result);
      }

      const ok: LoginResult = {
        authorizationCode: authorizationCode,
        state: responseState,
      };
      return JSON.stringify(ok);
    } catch (err) {
      const error = err as BusinessError;
      console.error(`${TAG}: login failed, code=${error.code}, message=${error.message}`);
      const result: LoginResult = {
        errorCode: error.code,
        errorMessage: this.describeError(error.code, error.message),
      };
      return JSON.stringify(result);
    }
  }

  private describeError(code: number, message: string): string {
    if (code === ERROR_USER_CANCEL) return '已取消华为账号授权';
    if (code === ERROR_LOGIN_OUT) return '请先在系统设置中登录华为账号';
    return message || '华为账号授权失败';
  }
}
