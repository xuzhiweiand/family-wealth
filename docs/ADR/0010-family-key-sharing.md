# ADR-0010: 家庭密钥分发与邀请码安全模型

**状态**: Accepted
**日期**: 2026-09-08
**关联**: ADR-0006（端到端加密）、ADR-0009（密钥轮换）

## 背景

W2/W3 的实现是 `FDK = HKDF(UMK, familyId)`。单用户多设备没问题，
但 W5 引入多成员后它直接崩坏：每个成员的 UMK 由「自己的密码 + 自己的 salt」
派生，互不相同 → 派生出的 FDK 互不相同 → 谁也解不开谁的数据。

多成员要求：**同一家庭的所有成员持有同一个 FDK**，且：

- 成员改自己的密码，不能影响其他成员（不该 re-wrap 全家数据）
- 撤销成员后，被撤销者拿不到新数据
- 服务端全程只见密文

## 决策

### 1. FDK 改为家庭级随机密钥（不再从 UMK 派生）

```
创建家庭：FDK = random(32B)                    ← 只发生一次，与任何人的密码无关
成员副本：wrapped_fdk = AES-GCM(FDK, 成员UMK, aad=`member:${userId}:${familyId}`)
```

每个成员存一份用自己的 UMK 加密的副本（`family_members.wrapped_fdk`）。
改密码只需重写自己那份副本。`crypto/deriveFDK()` 标记为 deprecated，
保留仅为兼容单用户遗留路径。

### 2. 邀请码 = FDK 的交接通道

```
KEK = HKDF-SHA256(ikm=邀请码, salt=invite_salt, info=`invite-kek:${inviteId}`)
invites.wrapped_fdk = AES-GCM(FDK, KEK, aad=`invite:${inviteId}`)
```

被邀请者凭码解出 FDK 后，**立即**用自己的 UMK 重新包裹存为成员副本，
短码从此作废（`markClaimed`）。

### 3. 威胁模型（诚实版）

**短码扛不住离线爆破。** 8 位 31 进制 ≈ 39 bit 熵，而 wrapped_fdk 与 salt
都在服务端——服务端管理员或拿到 DB 的人可以枚举全部 39 bit 空间。
这是「人类可手抄的码」的固有代价，不因为哈希存储而消失
（hash 只是不存明文，不增加熵）。

因此真正的防线是**把爆破窗口压到最小**：

| 防线 | 值 | 实现位置 |
|---|---|---|
| 码长 | 8 字符（≈39 bit） | `INVITE_CODE_LENGTH` |
| 有效期 | 15 分钟 | `INVITE_TTL_MS` + invites.expires_at |
| 一次性 | 领取即 claimed | `markClaimed` + 唯一索引 |
| 尝试上限 | 10 次 → locked | DB trigger `enforce_invite_attempts` |
| 存储形态 | 只存 SHA256(code) | `hashInviteCode` |

超过 10 次失败或过期后，攻击者必须让 owner 重新生成邀请——而 owner
每次都会看到新的码并亲手分发，这本身就是一道社交防线。

**P1 升级路径**：扫码加入（二维码承载 128 bit token，不入口令），
配合 X25519 sealed box 分发 FDK，彻底消除短码熵问题。

### 4. 撤销成员

1. 服务端删其 `family_members` 行 + 切断 RLS → **新数据立即不可见**
2. Owner 生成 `FDK_new`，用 `FDK_old` 加密存入 `family_key_rotations`
3. 剩余成员各自：FDK_old 解出 FDK_new → 用自己 UMK 重写副本 → 标记已领
4. 全员领完（`computeRotationProgress().complete`）后旧 FDK 废弃

**已知残余风险（必须写进产品文案）**：被撤销成员**已经下载到本地的旧密文**
仍可被其解开。端到端加密下服务端无法远程擦除他人设备上的数据。
UI 在移除成员后必须强提示「立即轮换密钥」，轮换只保证新数据不可读。

### 5. 权限三级（与 PRD §3.4 对齐）

| | viewer | editor | owner |
|---|---|---|---|
| 看家庭共享资产 | ✓ | ✓ | ✓ |
| 看/编辑他人 private 资产 | ✗ | ✗ | ✓ |
| 创建/编辑资产 | ✗ | ✓ | ✓ |
| 删除他人资产 | ✗ | ✗ | ✓ |
| 邀请/移除成员、改角色、轮换密钥 | ✗ | ✗ | ✓ |

两个反直觉取舍：
- **editor 能改不能删他人资产**：删错要靠软删恢复流程，代价远高于改错
- **只有 owner 能邀请**：防止 editor 把权限扩散出去

## 验证

- `crypto/share.test.ts` 20 用例：跨成员同一 FDK、AAD 错位必失败、
  邀请码差一位必失败、轮换领取链路
- `family/invite.test.ts`：落库行不含码明文、过期/锁定/一次性状态机
- `family/permission.test.ts`：三级矩阵 + 防自锁规则
- `family/rotation.test.ts`：excluded 名单、pending 追踪、needsRotation
