/**
 * 家庭资产管理 — 领域类型定义
 * 与《数据模型设计.md》v1.0 对齐
 */

/** 资产大类（11 类，见 PRD v2.1 §3.2） */
export const ASSET_TYPES = [
  'cash', // 现金
  'bank_deposit', // 银行存款
  'stock', // 股票
  'fund', // 基金
  'wealth_management', // 理财
  'real_estate', // 房产
  'vehicle', // 车辆
  'crypto', // 数字货币
  'precious_metal', // 贵金属
  'receivable', // 债权
  'debt', // 债务
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

/**
 * 录入页可选的资产类型（0.1.3 起收敛）。
 * ASSET_TYPES 保留全量用于历史数据展示；房产/车辆/数字货币不再开放新录入。
 */
export const SELECTABLE_ASSET_TYPES = [
  'cash', // 现金
  'bank_deposit', // 银行存款
  'stock', // 股票
  'fund', // 基金
  'wealth_management', // 理财
  'precious_metal', // 贵金属
  'receivable', // 债权
  'debt', // 债务
] as const;

/** 债务类资产（在净资产计算中做减项） */
export const LIABILITY_TYPES: readonly AssetType[] = ['debt'];

/** 家庭成员角色（三级权限，见 PRD v2.1 §3.4） */
export const FAMILY_ROLES = ['owner', 'editor', 'viewer'] as const;
export type FamilyRole = (typeof FAMILY_ROLES)[number];

/** 资产可见性（资产级 ACL，P1） */
export const VISIBILITIES = ['family', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** 资产记录（单表继承：差异字段存 details JSON，端侧加密后为 envelope） */
export interface Asset {
  id: string;
  familyId: string;
  ownerId: string;
  type: AssetType;
  name: string;
  /** 当前金额（分，整数存储；负债为负或由 type=debt 语义决定） */
  currentAmount: number;
  currency: string;
  visibility: Visibility;
  /** 差异字段：地址面积 / 代码数量 / 利率期限等 */
  details: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** 资产快照（趋势图唯一数据源，金额变更即写入） */
export interface AssetSnapshot {
  id: string;
  assetId: string;
  familyId: string;
  amount: number;
  currency: string;
  capturedAt: string;
  source: 'manual' | 'ocr' | 'import' | 'api';
}

/** 趋势聚合点（客户端聚合产物，用于三线图） */
export interface TrendPoint {
  date: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

/** 家庭成员 */
export interface FamilyMember {
  id: string;
  familyId: string;
  userId: string;
  displayName: string;
  role: FamilyRole;
  joinedAt: string;
}

/** 异动提醒规则（P1） */
export interface AlertRule {
  id: string;
  familyId: string;
  assetType: AssetType | 'all';
  thresholdPct: number;
  enabled: boolean;
}
