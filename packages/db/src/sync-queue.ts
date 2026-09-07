/**
 * 同步队列（W2 占位，W3 接入 WatermelonDB 真实同步）
 */

export interface SyncQueueEntry<T = unknown> {
  id: string;
  table: string;
  recordId: string;
  op: 'upsert' | 'delete';
  payload: T;
  /** 客户端时钟，用于冲突解决时的"最后写胜" */
  createdAt: string;
  /** 重试次数 */
  retries: number;
}

export class InMemorySyncQueue {
  private queue: SyncQueueEntry[] = [];

  enqueue(entry: Omit<SyncQueueEntry, 'id' | 'retries'>): SyncQueueEntry {
    const e: SyncQueueEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      retries: 0,
      ...entry,
    };
    this.queue.push(e);
    return e;
  }

  pending(): SyncQueueEntry[] {
    return this.queue.filter((e) => e.retries < 5);
  }

  markFailed(id: string): void {
    const e = this.queue.find((x) => x.id === id);
    if (e) e.retries += 1;
  }

  markDone(id: string): void {
    this.queue = this.queue.filter((e) => e.id !== id);
  }
}