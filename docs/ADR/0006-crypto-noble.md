# ADR-0006: 端到端加密采用 @noble/ciphers + @noble/hashes

**状态**: Accepted  
**日期**: 2026-09-07  
**对应技术方案**: §11、§21 D2

## 背景

家庭资产金额必须端到端加密（连服务端都看不到明文）。RN 端需要：
- 对称加密（AES-256-GCM 信封加密金额字段）
- 密码学安全哈希（PBKDF2/HKDF/SHA-256）
- 可审计、广泛验证、不依赖系统 API

## 决策

MVP 用 `@noble/ciphers` + `@noble/hashes`，预留抽象接口便于未来切换 native。

## 评估

| 候选 | 优点 | 缺点 |
|---|---|---|
| **@noble/ciphers + hashes** | 纯 JS 审计率高、Paul Miller 维护、跨平台、tree-shake 友好 | RN 端 JS 性能弱于 native |
| react-native-quick-crypto | 性能接近 native | 依赖 OpenSSL 二进制、版本兼容性是坑 |
| expo-crypto | 系统 API、稳定性好 | 抽象层次低、组合 PBKDF2+HKDF+AES 需自行拼装 |

## 理由

1. **MVP 阶段数据量小**——单家庭 < 5,000 资产、< 100 万快照，JS 加密耗时（每条 < 8ms，见技术方案 §3）完全在预算内
2. **审计率更高**——@noble 库是已知安全的纯 JS 实现，便于做安全审计
3. **跨平台一致**——同一套代码 iOS / Android / 未来 web / 鸿蒙（ArkTS 移植层）通用
4. **接口隔离**——包一层 `EnvelopeCipher` 接口，后续若发现性能瓶颈可换 native 而不动业务代码

## 抽象接口

```ts
// packages/crypto/src/envelope.ts
export interface EnvelopeCipher {
  encrypt(plaintext: Uint8Array, aad?: Uint8Array): Promise<EncryptedRecord>;
  decrypt(record: EncryptedRecord, aad?: Uint8Array): Promise<Uint8Array>;
}

export interface EncryptedRecord {
  ciphertext: Uint8Array;
  iv: Uint8Array;       // 12 bytes
  authTag: Uint8Array;  // 16 bytes
  version: 1;
}
```

## 密钥层级

```
password → PBKDF2-SHA256(310k iter, salt 16B) → UMK (32B)
       → HKDF-SHA256(info: "fdk"|familyId, salt: UMK) → FDK (32B)
```

- UMK 不持久化，每次解锁由用户密码 + 服务端 salt 重新派生
- FDK 加密后存服务端，新成员加入由 Owner 用其公钥加密分发

## 后果

- ✅ 纯 JS 跨平台、易审计
- ⚠️ 极端性能场景（如批量导入 10 万条）需测耗时，可能需后续切换 native
- ⚠️ 需自己实现 AAD 绑定（familyId 等）防止跨家庭重放

## 验证

- W2 实现 `envelope.ts` + `kdf.ts` + 15+ 单测（RFC 8439 / NIST SP 800-108 / 边界值）