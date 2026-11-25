/**
 * Concurrent download queue manager backed by `chrome.downloads` and `chrome.storage.local`.
 */

export const STORAGE_KEY = 'ntulearn_downloaded_v1';

/**
 * Read persisted download history map from `chrome.storage.local`.
 * @returns {Promise<Record<string, { downloadedAt: number, relativePath: string, title?: string }>>}
 */
export async function getDownloadHistory() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const data = result?.[STORAGE_KEY];
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/**
 * Clear persisted download history from `chrome.storage.local`.
 * @returns {Promise<void>}
 */
export async function clearDownloadHistory() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/**
 * Build a Blob object URL for generated `notes` (.html) or `links` (.txt) tasks.
 * Adds UTF-8 BOM for `.txt` so Windows Notepad renders CJK characters cleanly.
 * @param {object} task
 * @returns {{ url: string, isBlob: boolean }}
 */
function resolveTaskDownloadUrl(task) {
  if (task.type === 'links' || (!task.url && String(task.relativePath || '').toLowerCase().endsWith('.txt'))) {
    const text = String(task.content ?? '');
    const blob = new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' });
    return { url: URL.createObjectURL(blob), isBlob: true };
  }

  if (task.type === 'notes' || (!task.url && String(task.relativePath || '').toLowerCase().endsWith('.html'))) {
    const html = String(task.content ?? '');
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    return { url: URL.createObjectURL(blob), isBlob: true };
  }

  return { url: String(task.url || ''), isBlob: false };
}

/**
 * Safely invoke an optional callback without breaking the queue.
 * @param {function|undefined} fn
 * @param {...any} args
 */
function safeCall(fn, ...args) {
  if (typeof fn === 'function') {
    try {
      fn(...args);
    } catch {
      // Ignore UI callback errors
    }
  }
}

/**
 * Run a list of download tasks with bounded concurrency, incremental history persistence,
 * Blob lifecycle cleanup, and AbortSignal cancellation.
 *
 * @param {Array<object>} tasks
 * @param {object} [options={}]
 * @param {number} [options.concurrency=3]
 * @param {boolean} [options.skipDownloaded=true]
 * @param {'uniquify'|'overwrite'|'prompt'} [options.conflictAction='overwrite']
 * @param {object} [callbacks={}]
 * @param {function} [callbacks.onItemStart]
 * @param {function} [callbacks.onItemDone]
 * @param {function} [callbacks.onProgress]
 * @param {AbortSignal|null} [signal=null]
 * @returns {Promise<{ total: number, downloaded: number, skipped: number, failed: number, failedTasks: Array<{ task: object, error: string }> }>}
 */
export async function runDownloadQueue(tasks, options = {}, callbacks = {}, signal = null) {
  const list = Array.isArray(tasks) ? tasks : [];
  const total = list.length;

  if (total === 0) {
    return {
      total: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      failedTasks: [],
    };
  }

  const concurrency = Math.max(1, Math.min(10, Number(options?.concurrency) || 3));
  const skipDownloaded = options?.skipDownloaded !== false;
  const conflictAction = options?.conflictAction || 'overwrite';

  const { onItemStart, onItemDone, onProgress } = callbacks || {};

  const history = await getDownloadHistory();
  let saveChain = Promise.resolve();

  /**
   * Persist updated history map incrementally without overlapping writes.
   */
  const persistHistory = () => {
    const snapshot = { ...history };
    saveChain = saveChain
      .then(() => chrome.storage.local.set({ [STORAGE_KEY]: snapshot }))
      .catch(() => {
        // Ignore storage write errors so downloads can continue
      });
  };

  /** @type {Map<number, { resolve: function, reject: function, blobUrl: string|null }>} */
  const pending = new Map();
  /** @type {Map<number, { state: string, error?: string }>} */
  const earlyStates = new Map();

  const settleDownload = (downloadId, state, errorMsg) => {
    const entry = pending.get(downloadId);
    if (!entry) {
      earlyStates.set(downloadId, { state, error: errorMsg });
      return;
    }

    pending.delete(downloadId);
    if (entry.blobUrl) {
      try {
        URL.revokeObjectURL(entry.blobUrl);
      } catch {
        // Ignore revoke error
      }
    }

    if (state === 'complete') {
      entry.resolve();
    } else {
      entry.reject(new Error(errorMsg || 'Download interrupted'));
    }
  };

  const handleDownloadChanged = (delta) => {
    if (!delta || typeof delta.id !== 'number') return;
    const state = delta.state?.current;
    if (state === 'complete') {
      settleDownload(delta.id, 'complete');
    } else if (state === 'interrupted') {
      const reason = delta.error?.current || 'Download interrupted';
      settleDownload(delta.id, 'interrupted', reason);
    }
  };

  chrome.downloads.onChanged.addListener(handleDownloadChanged);

  /**
   * Start a single Chrome download and wait for `complete` or `interrupted`.
   * @param {object} task
   * @returns {Promise<void>}
   */
  const downloadSingleTask = async (task) => {
    const { url, isBlob } = resolveTaskDownloadUrl(task);
    if (!url) {
      throw new Error('Missing download URL');
    }

    const blobUrl = isBlob ? url : null;
    let downloadId;

    try {
      downloadId = await chrome.downloads.download({
        url,
        filename: task.relativePath,
        conflictAction,
        saveAs: false,
      });
    } catch (err) {
      if (blobUrl) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          // Ignore
        }
      }
      throw err;
    }

    if (typeof downloadId !== 'number') {
      if (blobUrl) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          // Ignore
        }
      }
      throw new Error('chrome.downloads.download did not return a download ID');
    }

    return new Promise((resolve, reject) => {
      const early = earlyStates.get(downloadId);
      if (early) {
        earlyStates.delete(downloadId);
        if (blobUrl) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {
            // Ignore
          }
        }
        if (early.state === 'complete') {
          resolve();
        } else {
          reject(new Error(early.error || 'Download interrupted'));
        }
        return;
      }

      pending.set(downloadId, { resolve, reject, blobUrl });
    });
  };

  let cursor = 0;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  const failedTasks = [];

  const emitProgress = (currentTask) => {
    safeCall(onProgress, {
      total,
      completed: downloaded + skipped + failed,
      downloaded,
      skipped,
      failed,
      currentTask,
    });
  };

  const worker = async () => {
    while (true) {
      if (signal?.aborted) {
        break;
      }

      const idx = cursor;
      if (idx >= total) {
        break;
      }
      cursor += 1;

      const task = list[idx];
      if (!task) continue;

      if (skipDownloaded && task.key && history[task.key]) {
        skipped += 1;
        safeCall(onItemDone, task, 'skipped');
        emitProgress(task);
        continue;
      }

      safeCall(onItemStart, task);

      try {
        await downloadSingleTask(task);
        downloaded += 1;
        if (task.key) {
          history[task.key] = {
            downloadedAt: Date.now(),
            relativePath: task.relativePath,
            title: task.title || task.fileName || '',
          };
          persistHistory();
        }
        safeCall(onItemDone, task, 'downloaded');
      } catch (err) {
        const errorMsg = err?.message || String(err);
        failed += 1;
        failedTasks.push(task);
        safeCall(onItemDone, task, 'failed', errorMsg);
      }

      emitProgress(task);
    }
  };

  try {
    const workerCount = Math.min(concurrency, total);
    const workers = [];
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
  } finally {
    chrome.downloads.onChanged.removeListener(handleDownloadChanged);
    // Clean up any stray Blob URLs if anything remained unsettled
    for (const entry of pending.values()) {
      if (entry.blobUrl) {
        try {
          URL.revokeObjectURL(entry.blobUrl);
        } catch {
          // Ignore
        }
      }
    }
    pending.clear();
    earlyStates.clear();
    await saveChain;
  }

  return {
    total,
    downloaded,
    skipped,
    failed,
    failedTasks,
  };
}
