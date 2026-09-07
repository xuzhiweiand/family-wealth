# ADR-0009: 主密钥 (UMK) 与家庭密钥 (FDK) 的轮换与生命周期

**状态**: Accepted  
**日期**: 2026-09-07  
**对应技术方案**: §11.5

## 背景

主密钥（UMK）由用户密码派生，家庭密钥（FDK）由 UMK + familyId 派生。两者均有生命周期：

- 用户改密码 → UMK 轮换
- 成员被移除 → FDK 重新分发
- 设备丢失 → UMK 强制失效

## 决策

### 1. UMK 轮换（用户改密码）

**触发**: 用户在「设置 → 修改密码」提交新密码。

**流程**:

```
旧密码 → PBKDF2 → UMK_old → 验证服务端旧 UMK 加密的"密码校验信封"（decrypt 成功即正确）
新密码 → PBKDF2 → UMK_new
UMK_new → HKDF → FDK_new（所有 familyId）
所有 envelope 用 FDK_new 重加密（re-wrap 模式，不重新上传数据）
新 salt（避免旧密码反推）写回服务端
```

**关键原则**: UMK 永不入库，所有 envelope 用 FDK 加密，密码改了只换 FDK。

### 2. FDK 轮换（成员变更）

**触发**: Owner 移除成员 / 主动 rotate。

**流程**:

```
Owner → UMK → HKDF → FDK_new（familyId）
批量重加密所有 envelope（仍是 re-wrap，本地完成）
Owner 用所有当前成员公钥加密 FDK_new 上传服务端
被移除成员的旧公钥加密记录从服务端删除
```

### 3. UMK 强制失效（设备丢失）

**触发**: 用户在另一设备触发"远程登出"。

**流程**:

```
用户在 B 设备改密码 → 旧设备 UMK 无法派生新 FDK
旧设备下次同步时，服务端要求 UMK 重新验证（基于旧设备 salt）
UMK_old 无法 decrypt 服务端重置的"密码校验信封" → 强制用户登出
```

**后备**: 若用户忘记密码，需 Owner 主动重置其 FDK 并分发。

## 4. 盐策略

| 类型 | 来源 | 长度 | 持久化 |
|---|---|---|---|
| PBKDF2 salt | 服务端 per-user 生成 | 16B | 服务端 |
| AES-GCM IV | 每条记录随机生成 | 12B | 与 ciphertext 一起 |
| HKDF salt | UMK 自身（salt=UMK） | — | 派生时使用 |

## 5. 销毁

| 时机 | 销毁内容 |
|---|---|
| App 退到后台 5 分钟 | 内存中 UMK 清零 |
| 用户主动登出 | UMK/FDK 全清、Keychain 项删 |
| 设备丢失 | 服务端强制改密码触发 3 |

## 后果

- ✅ 改密码不重上传数据（re-wrap 本地完成）
- ✅ 成员移除可立即生效
- ⚠️ 用户改密码需要联网一次（首次 verify 旧 UMK）
- ⚠️ 极端场景（用户忘记密码 + Owner 失联）= 数据不可恢复（这是端到端加密的应有代价）

## 验证

- W2 实现 `rotateKeys()` 函数 + 8+ 单测（re-wrap 正确性、AAD 绑定、IV 唯一性）
- W3 写 Playwright e2e：改密码后所有 envelope 仍可解密