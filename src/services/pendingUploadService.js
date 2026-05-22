import { uploadFileToStorage } from '../firebase/firebaseService';

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
  if (inFlightPendingByTaskRef) {
    return new Map(inFlightPendingByTaskRef);
  }
  const queue = await readQueue();
  return buildCountsFromQueue(queue);
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
      const prepared = await prepareImageForUpload(localPath);
      uploadPath = prepared.path;
      cleanupPath = prepared.cleanupPath;
    }

    const uploadResult = await uploadFileToStorage(
      storagePath,
      uploadPath,
      contentType,
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
  } catch {
    return {
      ok: false,
      retryItem: { ...item, retries: Number(item?.retries || 0) + 1 },
    };
  }
};

export const flushPendingMediaUploads = async () => {
  return withQueueLock(async () => {
    const queue = await readQueue();
    if (!queue.length) {
      inFlightPendingByTaskRef = null;
      return { processed: 0, succeeded: 0, failed: 0, remaining: 0 };
    }

    const nextQueue = [];
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    // Initialize in-flight pending state (fresh snapshot of queue)
    inFlightPendingByTaskRef = buildCountsFromQueue(queue);

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
    for (let i = 0; i < queue.length; i += UPLOAD_CONCURRENCY) {
      const batch = queue.slice(i, i + UPLOAD_CONCURRENCY);
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
            nextQueue.push(result.retryItem);
          } else {
            decrementInFlight(item);
          }
        }
        const remainingNow = queue.length - processed + nextQueue.length;
        notifyQueueListeners(remainingNow);
      }
    }

    await writeQueue(nextQueue);
    inFlightPendingByTaskRef = null;
    notifyQueueListeners(nextQueue.length);
    return {
      processed,
      succeeded,
      failed,
      remaining: nextQueue.length,
    };
  });
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
