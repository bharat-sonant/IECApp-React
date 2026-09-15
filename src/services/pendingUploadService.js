import { uploadFileToStorage } from '../firebase/firebaseService';
import { ERROR_CATEGORY, logError } from './errorLogService';

const STORAGE_KEY = '@iec_pending_media_uploads';
let queueLock = Promise.resolve();

const queueListeners = new Set();
const notifyQueueListeners = count => {
  for (const fn of queueListeners) {
    try {
      fn(count);
    } catch {
      // Ignore listener errors
    }
  }
};

export const subscribePendingMediaQueue = listener => {
  if (typeof listener !== 'function') {
    return () => {};
  }
  queueListeners.add(listener);
  return () => {
    queueListeners.delete(listener);
  };
};

export const getPendingMediaUploadsCount = async () => {
  const queue = await readQueue();
  return queue.length;
};

let inFlightPendingByTaskRef = null;
let inFlightClaimedIds = null;

const buildCountsFromQueue = queue => {
  const map = new Map();
  for (const item of queue || []) {
    const ref = String(item?.taskRef || '').trim();
    if (!ref) {
      continue;
    }
    map.set(ref, (map.get(ref) || 0) + 1);
  }
  return map;
};

export const getPendingMediaCountsByTaskRef = async () => {
  const queue = await readQueue();

  if (!inFlightPendingByTaskRef) {
    return buildCountsFromQueue(queue);
  }

  // Items being uploaded right now stay in storage until the flush finishes,
  // so count those from the in-flight map (it shrinks as uploads succeed) and
  // the rest — anything queued mid-flush — straight from storage.
  const counts = buildCountsFromQueue(
    queue.filter(item => !inFlightClaimedIds?.has(item?.id)),
  );

  inFlightPendingByTaskRef.forEach((pending, taskRef) => {
    counts.set(taskRef, (counts.get(taskRef) || 0) + pending);
  });

  return counts;
};
const MAX_IMAGE_UPLOAD_BYTES = 50 * 1024;
const IMAGE_UPLOAD_DIMENSION = 800;
const IMAGE_QUALITY_STEPS = [80, 70, 60, 50, 40, 30];

const asString = value =>
  value === null || value === undefined ? '' : String(value).trim();

const getAsyncStorage = () => {
  try {
    const mod = require('@react-native-async-storage/async-storage');
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
};

const getRNFS = () => require('react-native-fs');

const normalizeQueue = payload => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.filter(Boolean);
};

const readQueue = async () => {
  const asyncStorage = getAsyncStorage();
  if (!asyncStorage?.getItem) {
    return [];
  }

  const raw = await asyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return normalizeQueue(JSON.parse(raw));
  } catch {
    return [];
  }
};

const writeQueue = async queue => {
  const asyncStorage = getAsyncStorage();
  if (!asyncStorage?.setItem) {
    return;
  }

  await asyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
};

const removeQueueItemFile = async localPath => {
  try {
    const RNFS = getRNFS();
    const resolvedPath = asString(localPath);
    if (!resolvedPath) {
      return;
    }

    if (await RNFS.exists(resolvedPath)) {
      await RNFS.unlink(resolvedPath);
    }
  } catch {
    // Ignore cleanup failures.
  }
};

const getFileSize = async path => {
  const RNFS = getRNFS();
  const stats = await RNFS.stat(path);
  return Number(stats?.size ?? 0);
};

const prepareImageForUpload = async sourcePath => {
  let ImageResizer;
  try {
    ImageResizer = require('react-native-image-resizer').default;
  } catch (e) {
    throw new Error('Image resizer library not available');
  }

  const RNFS = getRNFS();
  const rawSourcePath = asString(sourcePath);
  const normalizedSourcePath = rawSourcePath.startsWith('file://')
    ? rawSourcePath.slice(7)
    : rawSourcePath;

  if (!normalizedSourcePath) {
    throw new Error('Missing image source path');
  }

  // Check if file exists first
  const fileExists = await RNFS.exists(normalizedSourcePath);
  if (!fileExists) {
    throw new Error(`Cannot read "${normalizedSourcePath}" - file not found`);
  }

  let bestPath = normalizedSourcePath;
  let bestSize = await getFileSize(normalizedSourcePath);

  if (bestSize <= MAX_IMAGE_UPLOAD_BYTES) {
    return { path: bestPath, cleanupPath: null, size: bestSize };
  }

  for (const quality of IMAGE_QUALITY_STEPS) {
    const resized = await ImageResizer.createResizedImage(
      normalizedSourcePath,
      IMAGE_UPLOAD_DIMENSION,
      IMAGE_UPLOAD_DIMENSION,
      'JPEG',
      quality,
      0,
      undefined,
      false,
      { mode: 'contain', onlyScaleDown: true },
    );

    const resizedPath = asString(resized?.path || resized?.uri || '');
    if (!resizedPath) {
      continue;
    }

    const size = await getFileSize(resizedPath);
    if (size < bestSize) {
      bestPath = resizedPath;
      bestSize = size;
    }

    if (size <= MAX_IMAGE_UPLOAD_BYTES) {
      return {
        path: resizedPath,
        cleanupPath: resizedPath !== normalizedSourcePath ? resizedPath : null,
        size,
      };
    }
  }

  return {
    path: bestPath,
    cleanupPath: bestPath !== normalizedSourcePath ? bestPath : null,
    size: bestSize,
  };
};

const withQueueLock = async handler => {
  const run = queueLock.then(handler, handler);
  queueLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

export const enqueuePendingMediaUpload = async item => {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const nextItem = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      retries: 0,
      ...item,
    };

    queue.push(nextItem);
    await writeQueue(queue);
    notifyQueueListeners(queue.length);
    return nextItem;
  });
};

export const getPendingMediaUploads = async () => readQueue();

export const removePendingMediaUpload = async id => {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const nextQueue = queue.filter(item => item?.id !== id);
    await writeQueue(nextQueue);
    notifyQueueListeners(nextQueue.length);
  });
};

const UPLOAD_CONCURRENCY = 2;

/**
 * Firebase Storage uploads and the image resizer have no timeout of their own.
 * One stuck file must not stall the whole queue, so every step is capped.
 */
const IMAGE_PREPARE_TIMEOUT_MS = 60000;
const UPLOAD_TIMEOUT_MS = 180000;

/** Number of failed attempts before a stuck item is reported. */
const REPORT_AFTER_RETRIES = 3;

const withStepTimeout = (promise, timeoutMs, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const processQueueItem = async item => {
  const localPath = asString(item?.localPath);
  const storagePath = asString(item?.storagePath);
  const contentType = asString(item?.contentType) || 'image/jpeg';

  if (!localPath || !storagePath) {
    return { ok: false, retryItem: item };
  }

  try {
    let uploadPath = localPath;
    let cleanupPath = null;

    if (contentType.startsWith('image/')) {
      const prepared = await withStepTimeout(
        prepareImageForUpload(localPath),
        IMAGE_PREPARE_TIMEOUT_MS,
        'Image preparation',
      );
      uploadPath = prepared.path;
      cleanupPath = prepared.cleanupPath;
    }

    const uploadResult = await withStepTimeout(
      uploadFileToStorage(storagePath, uploadPath, contentType),
      UPLOAD_TIMEOUT_MS,
      `Upload of ${storagePath}`,
    );
    if (!uploadResult || uploadResult.success !== true) {
      throw new Error(
        uploadResult?.error || `Upload failed for ${storagePath}`,
      );
    }
    if (cleanupPath) {
      await removeQueueItemFile(cleanupPath);
    }
    return { ok: true };
  } catch (error) {
    const retries = Number(item?.retries || 0) + 1;

    if (retries >= REPORT_AFTER_RETRIES) {
      logError(ERROR_CATEGORY.MediaUpload, error, {
        storagePath,
        contentType,
        taskRef: asString(item?.taskRef),
        retries,
      });
    }

    return { ok: false, retryItem: { ...item, retries } };
  }
};

let isFlushing = false;

/**
 * Uploads every queued file.
 *
 * The queue lock is held only while claiming the work and while writing the
 * result back — never during the uploads themselves. Holding it across the
 * network calls made `enqueuePendingMediaUpload` wait behind a slow upload,
 * which left the "Saving task..." spinner on screen long after the task had
 * already been written to the database.
 */
export const flushPendingMediaUploads = async () => {
  if (isFlushing) {
    return { processed: 0, succeeded: 0, failed: 0, remaining: 0, skipped: true };
  }
  isFlushing = true;

  try {
    const claimed = await withQueueLock(async () => {
      const queue = await readQueue();
      if (!queue.length) {
        inFlightPendingByTaskRef = null;
        inFlightClaimedIds = null;
        return [];
      }

      inFlightPendingByTaskRef = buildCountsFromQueue(queue);
      inFlightClaimedIds = new Set(queue.map(item => item?.id).filter(Boolean));
      return queue;
    });

    if (!claimed.length) {
      return { processed: 0, succeeded: 0, failed: 0, remaining: 0 };
    }

    const retryItems = [];
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    const decrementInFlight = item => {
      const ref = String(item?.taskRef || '').trim();
      if (!ref || !inFlightPendingByTaskRef) {
        return;
      }
      const cur = inFlightPendingByTaskRef.get(ref) || 0;
      if (cur <= 1) {
        inFlightPendingByTaskRef.delete(ref);
      } else {
        inFlightPendingByTaskRef.set(ref, cur - 1);
      }
    };

    // Process in concurrent batches of UPLOAD_CONCURRENCY
    for (let i = 0; i < claimed.length; i += UPLOAD_CONCURRENCY) {
      const batch = claimed.slice(i, i + UPLOAD_CONCURRENCY);
      const results = await Promise.all(batch.map(processQueueItem));

      for (let idx = 0; idx < results.length; idx += 1) {
        const result = results[idx];
        const item = batch[idx];
        processed += 1;
        if (result.ok) {
          succeeded += 1;
          decrementInFlight(item);
        } else {
          failed += 1;
          if (result.retryItem) {
            retryItems.push(result.retryItem);
          } else {
            decrementInFlight(item);
          }
        }
        notifyQueueListeners(claimed.length - processed + retryItems.length);
      }
    }

    // Merge back under the lock so anything enqueued mid-flush survives.
    const remaining = await withQueueLock(async () => {
      const latest = await readQueue();
      const queuedMeanwhile = latest.filter(
        item => !inFlightClaimedIds?.has(item?.id),
      );
      const nextQueue = [...retryItems, ...queuedMeanwhile];

      await writeQueue(nextQueue);
      inFlightPendingByTaskRef = null;
      inFlightClaimedIds = null;
      notifyQueueListeners(nextQueue.length);
      return nextQueue.length;
    });

    return { processed, succeeded, failed, remaining };
  } finally {
    isFlushing = false;
  }
};

export const buildPendingMediaPath = ({
  userId,
  cityName,
  city,
  year,
  month,
  currentDate,
  taskKey,
  fileName,
}) =>
  `${cityName || city ? `${cityName || city}/` : ''}IECData/IECTasksImages/${userId}/${year}/${month}/${currentDate}/${taskKey}/${fileName}`;
