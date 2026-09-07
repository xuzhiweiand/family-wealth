/**
 * 跨平台 base64 编解码（Node + React Native Hermes 均可运行）
 *
 * 不依赖 Node Buffer（RN 无 Buffer polyfill），基于全局 btoa/atob：
 * - Node >= 16 内置 btoa/atob 全局
 * - Hermes 内置 btoa/atob
 *
 * 说明：本模块针对「原始字节」编解码。base64 的 binary string 与字节值
 * 0-255 一一对应，因此可安全用于 salt / IV / ciphertext 等字节序列。
 */

const CHUNK = 0x2000; // 8192，避免 String.fromCharCode 一次展开过多参数

function bytesToBinary(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return bin;
}

/** Uint8Array → base64 string */
export function toBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes));
}

/** base64 string → Uint8Array */
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
