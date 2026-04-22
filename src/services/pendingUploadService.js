import {uploadFileToStorage} from '../firebase/firebaseService';

const STORAGE_KEY = '@iec_pending_media_uploads';
let queueLock = Promise.resolve();
const MAX_IMAGE_UPLOAD_BYTES = 50 * 1024;
const IMAGE_UPLOAD_DIMENSION = 800;
const IMAGE_QUALITY_STEPS = [80, 70, 60, 50, 40, 30];

const asString = value => (value === null || value === undefined ? '' : String(value).trim());

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
  const ImageResizer = require('react-native-image-resizer').default;
  const rawSourcePath = asString(sourcePath);
  const normalizedSourcePath = rawSourcePath.startsWith('file://') ? rawSourcePath.slice(7) : rawSourcePath;

  if (!normalizedSourcePath) {
    throw new Error('Missing image source path');
  }

  let bestPath = normalizedSourcePath;
  let bestSize = await getFileSize(normalizedSourcePath);

  if (bestSize <= MAX_IMAGE_UPLOAD_BYTES) {
    return {path: bestPath, cleanupPath: null, size: bestSize};
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
      {mode: 'contain', onlyScaleDown: true},
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
    return nextItem;
  });
};

export const getPendingMediaUploads = async () => readQueue();

export const removePendingMediaUpload = async id => {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const nextQueue = queue.filter(item => item?.id !== id);
    await writeQueue(nextQueue);
  });
};

export const flushPendingMediaUploads = async () => {
  return withQueueLock(async () => {
    const queue = await readQueue();
    if (!queue.length) {
      return {processed: 0, succeeded: 0, failed: 0, remaining: 0};
    }

    const nextQueue = [];
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const item of queue) {
      processed += 1;

      const localPath = asString(item?.localPath);
      const storagePath = asString(item?.storagePath);
      const contentType = asString(item?.contentType) || 'image/jpeg';

      if (!localPath || !storagePath) {
        failed += 1;
        nextQueue.push(item);
        continue;
      }

      try {
        let uploadPath = localPath;
        let cleanupPath = null;

        if (contentType.startsWith('image/')) {
          const prepared = await prepareImageForUpload(localPath);
          uploadPath = prepared.path;
          cleanupPath = prepared.cleanupPath;
        }

        await uploadFileToStorage(storagePath, uploadPath, contentType);
        if (cleanupPath) {
          await removeQueueItemFile(cleanupPath);
        }
        succeeded += 1;
      } catch {
        failed += 1;
        nextQueue.push({
          ...item,
          retries: Number(item?.retries || 0) + 1,
        });
      }
    }

    await writeQueue(nextQueue);
    return {
      processed,
      succeeded,
      failed,
      remaining: nextQueue.length,
    };
  });
};

export const buildPendingMediaPath = ({userId, cityName, city, year, month, currentDate, taskKey, taskCount, fileName}) =>
  `${(cityName || city) ? `${cityName || city}/` : ''}IECData/IECTasksImages/${userId}/${year}/${month}/${currentDate}/${taskKey}/${taskCount}/${fileName}`;
