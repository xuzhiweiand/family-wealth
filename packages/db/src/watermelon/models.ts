/**
 * WatermelonDB Model 类（active record，ADR-0007）
 *
 * ⚠️ 依赖 @nozbe/watermelondb（native），本机沙箱无法安装，未纳入 typecheck。
 *    需在真机 prebuild 后验证。
 */

import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

export class AssetModel extends Model {
  static table = 'assets';

  @text('family_id') familyId!: string;
  @text('owner_id') ownerId!: string;
  @text('type') type!: string;
  @text('name') name!: string;
  @field('current_amount') currentAmount!: number;
  @text('currency') currency!: string;
  @text('visibility') visibility!: string;
  @text('details') details!: string;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
  @field('deleted_at') deletedAt!: number | null;
}

export class AssetSnapshotModel extends Model {
  static table = 'asset_snapshots';

  @text('asset_id') assetId!: string;
  @text('family_id') familyId!: string;
  @field('amount') amount!: number;
  @text('currency') currency!: string;
  @field('captured_at') capturedAt!: number;
  @text('source') source!: string;
}
