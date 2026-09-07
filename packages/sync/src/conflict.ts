/**
 * 冲突裁决（纯函数，无 IO，可单测）
 *
 * 家庭财务场景的两条硬约束：
 * 1. **软删优先保留** —— 财务数据删错了找回成本极高，宁可多留不可误删；
 *    同时"删除"通常是用户在某台设备上做出的明确决定，优先级高于时间戳。
 * 2. **最后写胜（LWW）** —— 其余情况比 updatedAt，严格相等时保留本地，
 *    避免同毫秒下无意义的来回覆盖造成 UI 抖动。
 */

export type ConflictWinner = 'local' | 'remote';

export interface ConflictSide {
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * 裁决本地与远端谁赢。
 *
 * @param local 本地现有记录；为 null（本地还没有）时一律取远端
 */
export function resolveConflict(local: ConflictSide | null, remote: ConflictSide): ConflictWinner {
  if (local === null) return 'remote';

  // 1. 软删优先保留
  if (local.deletedAt !== null && remote.deletedAt === null) return 'local';
  if (remote.deletedAt !== null && local.deletedAt === null) return 'remote';

  // 2. 最后写胜
  if (remote.updatedAt > local.updatedAt) return 'remote';
  if (remote.updatedAt < local.updatedAt) return 'local';

  // 3. 时间戳完全相同 → 保留本地，避免抖动
  return 'local';
}

/**
 * 推进增量同步游标：取本批（含历史）最大的 updatedAt。
 * 用「最大值」而非「最后一条」，因为远端返回顺序不保证。
 */
export function computeNextCursor(
  rows: readonly { updatedAt: string }[],
  previous: string | null = null,
): string | null {
  let max = previous;
  for (const row of rows) {
    if (max === null || row.updatedAt > max) max = row.updatedAt;
  }
  return max;
}
