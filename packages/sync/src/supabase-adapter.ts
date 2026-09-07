/**
 * Supabase 远端适配器
 *
 * 表 `sync_records`：服务端只见密文 envelope，配合 RLS 限制仅本人可读可写。
 * 建表语句见 supabase/migrations/20260907000002_sync_records.sql
 *
 * ⚠️ 当前 RLS 按 user_id = auth.uid() 限制，即「同一用户的多设备同步」。
 *    跨成员共享（邀请码 + FDK 托管）属 P1，届时需改为按 family_id 授权。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PushAck, RemoteAdapter, RemoteRow, SyncKind } from './types';

export const SYNC_TABLE = 'sync_records';

interface SyncRow {
  record_id: string;
  kind: string;
  updated_at: string;
  deleted_at: string | null;
  envelope: string;
}

function mapRow(row: SyncRow): RemoteRow {
  return {
    id: row.record_id,
    kind: row.kind === 'snapshot' ? 'snapshot' : 'asset',
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    envelope: row.envelope,
  };
}

export class SupabaseRemoteAdapter implements RemoteAdapter {
  constructor(
    private readonly client: SupabaseClient,
    private readonly familyId: string,
    private readonly table: string = SYNC_TABLE,
  ) {}

  async pull(since: string | null, kinds: readonly SyncKind[]): Promise<RemoteRow[]> {
    const base = this.client
      .from(this.table)
      .select('record_id,kind,updated_at,deleted_at,envelope')
      .eq('family_id', this.familyId)
      .in('kind', [...kinds]);

    const { data, error } = since === null ? await base : await base.gt('updated_at', since);
    if (error) throw new Error(`sync pull failed: ${error.message}`);
    return ((data ?? []) as SyncRow[]).map(mapRow);
  }

  async push(rows: readonly RemoteRow[]): Promise<PushAck[]> {
    if (rows.length === 0) return [];
    const payload = rows.map((r) => ({
      family_id: this.familyId,
      record_id: r.id,
      kind: r.kind,
      updated_at: r.updatedAt,
      deleted_at: r.deletedAt,
      envelope: r.envelope,
    }));

    const { error } = await this.client.from(this.table).upsert(payload, { onConflict: 'user_id,record_id' });
    if (error) {
      return rows.map((r) => ({ id: r.id, ok: false, error: error.message }));
    }
    return rows.map((r) => ({ id: r.id, ok: true }));
  }
}
