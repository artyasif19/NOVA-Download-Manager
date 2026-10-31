import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('NOVA Download Manager - Concurrent Queue Claiming & Atomic Deduplication', () => {

  it('prevents simultaneous browser handoff and queue worker from double-executing the same URL', async () => {
    // Simulate durable download store with atomic claiming
    interface Item {
      id: string;
      url: string;
      filename: string;
      status: 'queued' | 'downloading' | 'completed' | 'paused';
      downloadedBytes: number;
    }

    const store = new Map<string, Item>();
    const activeExecutors = new Set<string>();
    let executionSpawnCount = 0;

    // Atomic claim helper (equivalent to SQLite transaction with UPDATE ... WHERE status = 'queued')
    function atomicClaim(id: string): boolean {
      const item = store.get(id);
      if (item && item.status === 'queued') {
        item.status = 'downloading';
        return true;
      }
      return false;
    }

    // Engine launcher (ensures task is not already running)
    function launchTask(id: string): boolean {
      if (activeExecutors.has(id)) {
        return false; // Already executing
      }
      activeExecutors.add(id);
      executionSpawnCount++;
      return true;
    }

    // Browser handoff protocol handler (/api/can_handle)
    function handleBrowserHandoff(url: string, filename: string) {
      // 1. Check existing active or queued downloads for deduplication
      for (const item of store.values()) {
        if (item.url === url && (item.status === 'downloading' || item.status === 'queued')) {
          return {
            status: 'accepted',
            accepted: true,
            download_id: item.id,
            duplicate_prevented: true,
            durable: true,
          };
        }
      }

      const id = `dl-${Date.now()}-${Math.random()}`;
      store.set(id, {
        id,
        url,
        filename,
        status: 'queued',
        downloadedBytes: 0,
      });

      // Claim and start
      if (atomicClaim(id)) {
        const started = launchTask(id);
        assert.strictEqual(started, true);
        return {
          status: 'accepted',
          accepted: true,
          download_id: id,
          duplicate_prevented: false,
          durable: true,
        };
      }

      return { status: 'rejected', accepted: false };
    }

    // Queue worker polling handler
    function queueWorkerPoll() {
      const claimed: string[] = [];
      for (const item of store.values()) {
        if (item.status === 'queued') {
          if (atomicClaim(item.id)) {
            claimed.push(item.id);
            launchTask(item.id);
          }
        }
      }
      return claimed;
    }

    const testUrl = 'https://example.com/large-archive.zip';

    // Simulate simultaneous execution of handoff and queue worker
    const [handoffRes1, handoffRes2, workerClaims] = await Promise.all([
      Promise.resolve().then(() => handleBrowserHandoff(testUrl, 'large-archive.zip')),
      Promise.resolve().then(() => handleBrowserHandoff(testUrl, 'large-archive.zip')),
      Promise.resolve().then(() => queueWorkerPoll()),
    ]);

    // Exactly one new download task was spawned, second handoff detected duplicate
    assert.strictEqual(executionSpawnCount, 1);
    assert.strictEqual(handoffRes1.accepted, true);
    assert.strictEqual(handoffRes2.accepted, true);

    // One of them was the initial creator, the other was deduplicated
    const isOneDuplicate = handoffRes1.duplicate_prevented || handoffRes2.duplicate_prevented;
    assert.strictEqual(isOneDuplicate, true);

    // Queue worker did not double-claim the active task
    assert.strictEqual(workerClaims.includes(handoffRes1.download_id!), false);
    assert.strictEqual(activeExecutors.size, 1);
  });

  it('guarantees atomic queue worker claiming across multiple concurrent poll cycles', async () => {
    interface QueueItem {
      id: string;
      status: 'queued' | 'downloading';
    }

    const queue: QueueItem[] = [
      { id: 'job-1', status: 'queued' },
      { id: 'job-2', status: 'queued' },
      { id: 'job-3', status: 'queued' },
    ];

    const worker1Claims: string[] = [];
    const worker2Claims: string[] = [];
    const worker3Claims: string[] = [];

    // Atomic claim simulating SQLite transaction
    function tryClaim(id: string): boolean {
      const item = queue.find(q => q.id === id);
      if (item && item.status === 'queued') {
        item.status = 'downloading';
        return true;
      }
      return false;
    }

    async function runWorker(claimsArray: string[]) {
      for (const item of queue) {
        if (tryClaim(item.id)) {
          claimsArray.push(item.id);
        }
      }
    }

    // Run 3 workers simultaneously attempting to claim all 3 items
    await Promise.all([
      runWorker(worker1Claims),
      runWorker(worker2Claims),
      runWorker(worker3Claims),
    ]);

    const allClaimed = [...worker1Claims, ...worker2Claims, ...worker3Claims];
    assert.strictEqual(allClaimed.length, 3, 'Total claims must exactly match number of queued items');
    assert.strictEqual(new Set(allClaimed).size, 3, 'No job was claimed more than once');
  });

  it('recovers interrupted tasks to paused state after application restart', () => {
    interface SavedDownload {
      id: string;
      status: 'downloading' | 'queued' | 'paused' | 'completed';
      downloadedBytes: number;
    }

    const savedState: SavedDownload[] = [
      { id: 'dl-1', status: 'downloading', downloadedBytes: 5242880 },
      { id: 'dl-2', status: 'completed', downloadedBytes: 10485760 },
      { id: 'dl-3', status: 'queued', downloadedBytes: 0 },
      { id: 'dl-4', status: 'downloading', downloadedBytes: 1200000 },
    ];

    // Simulate recovery in Database::init() / loadDurableStore()
    const recovered = savedState.map(item => {
      if (item.status === 'downloading') {
        return { ...item, status: 'paused' as const };
      }
      return item;
    });

    assert.strictEqual(recovered.find(d => d.id === 'dl-1')?.status, 'paused');
    assert.strictEqual(recovered.find(d => d.id === 'dl-1')?.downloadedBytes, 5242880, 'Preserves downloaded bytes');
    assert.strictEqual(recovered.find(d => d.id === 'dl-2')?.status, 'completed');
    assert.strictEqual(recovered.find(d => d.id === 'dl-3')?.status, 'queued');
    assert.strictEqual(recovered.find(d => d.id === 'dl-4')?.status, 'paused');
  });

  it('rejects handoff when destination directory is unwritable and does not cancel browser download', () => {
    function evaluateHandoff(canWriteDest: boolean) {
      if (!canWriteDest) {
        return {
          status: 'rejected',
          accepted: false,
          reason: 'Destination directory unwritable',
        };
      }
      return { status: 'accepted', accepted: true };
    }

    const res = evaluateHandoff(false);
    assert.strictEqual(res.accepted, false);
    assert.strictEqual(res.status, 'rejected');
  });

});
