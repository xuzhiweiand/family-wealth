/**
 * 原生 PBKDF2 TurboModule（ArkTS 侧）。
 *
 * 背景：鸿蒙 Hermes 无 JIT，@noble/hashes 纯 JS 跑 PBKDF2-SHA256
 * 100k 迭代实测 76 秒并冻结 JS 线程。下沉到 cryptoFramework
 * （系统原生实现，API 11+）后为毫秒级，且在系统线程执行、不阻塞 JS。
 *
 * 模块名 CryptoPbkdf2：JS 侧 TurboModuleRegistry、本文件、
 * C++ CryptoPbkdf2Package.h 三处必须一致。
 */
import { TurboModule, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { util } from '@kit.ArkTS';

export class CryptoPbkdf2TurboModule extends TurboModule {
  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  /**
   * PBKDF2-SHA256 派生。
   * @param password 明文密码（UTF-8，cryptoFramework 直接按原文编码，
   *                 与 JS TextEncoder.encode(password) 口径一致）
   * @param saltBase64 salt 的 Base64
   * @param iterations 迭代次数
   * @param keySize 输出密钥字节数
   * @returns 派生密钥的 Base64
   */
  async derive(
    password: string,
    saltBase64: string,
    iterations: number,
    keySize: number,
  ): Promise<string> {
    const salt: Uint8Array = new util.Base64Helper().decodeSync(saltBase64);
    const spec: cryptoFramework.PBKDF2Spec = {
      algName: 'PBKDF2',
      password,
      salt,
      iterations,
      keySize,
    };
    const kdf = cryptoFramework.createKdf('PBKDF2|SHA256');
    const secret = await kdf.generateSecret(spec);
    return new util.Base64Helper().encodeToStringSync(secret.data);
  }
}
