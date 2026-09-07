# 家庭资产管理 — Runbook

应急 / 日常运维手册。每月演练一次。

## 一、密钥事件

### 1.1 主密钥（User Master Key）疑似泄露

**触发**：iCloud Keychain 同步异常、用户报告「我的资产数据出现在别人设备」

**行动**：
1. 立即冻结该用户会话（Supabase `auth.users.banned_until = now() + 24h`）
2. 引导用户在另一台可信设备重置密码（PBKDF2 重新派生 UMK，旧 UMK 派生数据需要批量重加密）
3. 通知所有家庭成员：邀请码失效，需重新配对
4. 72h 内提交事故报告到 `docs/ADR/incidents/`

### 1.2 Edge Function secret 轮换

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
# 重启函数
supabase functions deploy create-family
```

## 二、性能事故

### 2.1 趋势图加载超过 3s

- 触发 PagerDuty：on-call 工程师
- 检查项：客户端聚合是否退化（资产数 > 5,000）、Supabase Realtime 频道是否断连、本地 SQLite 是否损坏
- 临时缓解：切换到「最近 30 天」预设；降级到只显示净资产单线

### 2.2 同步队列堆积 > 1,000 条

- 触发原因：长时间离线 / 网络抖动
- 缓解：客户端自动降级到「低带宽模式」（批量 POST，每分钟 1 次）

## 三、上架事故

### 3.1 App Store 审核被拒

- 见《技术方案》§11.2 高频被拒清单
- 24h 内提交申诉或修复后重新提交

## 四、数据恢复

### 4.1 用户误删资产

- 软删除数据保留 90 天
- 用户在「设置 > 数据 > 回收站」可自助恢复
- 超过 90 天需 DBA 介入（PG point-in-time recovery）

## 五、值班

- 工作日 9:00-21:00：主工程师值班
- 周末 / 节假日：on-call 轮值（见 PagerDuty）