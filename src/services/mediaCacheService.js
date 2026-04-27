import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MEDIA_CACHE_DIR = `${RNFS.DocumentDirectoryPath}/media_cache`;
const CACHE_INDEX_KEY = 'media_cache_index';

const getCacheDir = async () => {
  const exists = await RNFS.exists(MEDIA_CACHE_DIR);
  if (!exists) {
    await RNFS.mkdir(MEDIA_CACHE_DIR);
  }
  return MEDIA_CACHE_DIR;
};

const getHash = url => {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
};

const getCacheIndex = async () => {
  try {
    const data = await AsyncStorage.getItem(CACHE_INDEX_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

const setCacheIndex = async index => {
  await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
};

export const isMediaCached = async url => {
  try {
    const hash = getHash(url);
    const ext = url.includes('.mp4') ? 'mp4' : 'jpg';
    const cachedPath = `${MEDIA_CACHE_DIR}/${hash}.${ext}`;
    const exists = await RNFS.exists(cachedPath);
    return exists ? cachedPath : null;
  } catch {
    return null;
  }
};

export const cacheMedia = async (url, onProgress) => {
  try {
    const hash = getHash(url);
    const ext = url.includes('.mp4') ? 'mp4' : 'jpg';
    const cachedPath = `${MEDIA_CACHE_DIR}/${hash}.${ext}`;
    const exists = await RNFS.exists(cachedPath);
    if (exists) {
      return cachedPath;
    }

    const index = await getCacheIndex();
    index[url] = cachedPath;
    await setCacheIndex(index);

    const options = {
      fromUrl: url,
      toFile: cachedPath,
      progress: res => {
        const pct = ((res.bytesWritten / res.contentLength) * 100).toFixed(0);
        onProgress?.(parseInt(pct, 10));
      },
    };

    const result = await RNFS.downloadFile(options).promise;
    if (result.statusCode === 200) {
      return cachedPath;
    }
    return null;
  } catch {
    return null;
  }
};

export const cacheAllMedia = async (images, videos, onProgress) => {
  const results = {
    images: [],
    videos: [],
    done: 0,
    total: images.length + videos.length,
  };

  const allUrls = [
    ...images.map((url, i) => ({ url, type: 'image', index: i })),
    ...videos.map((url, i) => ({ url, type: 'video', index: i })),
  ];

  for (const item of allUrls) {
    const cached = await cacheMedia(item.url, progress => {
      const overallPct = Math.round(
        ((results.done + progress / 100) / results.total) * 100,
      );
      onProgress?.(overallPct);
    });

    if (item.type === 'image') {
      results.images[item.index] = cached || item.url;
    } else {
      results.videos[item.index] = cached || item.url;
    }
    results.done++;
  }

  return results;
};

export const clearOldCache = async (maxSizeMB = 200) => {
  try {
    const stat = await RNFS.stat(MEDIA_CACHE_DIR);
    const files = await RNFS.readDir(MEDIA_CACHE_DIR);
    let totalSize = 0;
    files.forEach(f => (totalSize += parseInt(f.size, 10)));
    const totalSizeMB = totalSize / (1024 * 1024);

    if (totalSizeMB > maxSizeMB) {
      const sorted = files.sort(
        (a, b) => parseInt(a.ctime, 10) - parseInt(b.ctime, 10),
      );
      let freed = 0;
      const targetFree = totalSizeMB - maxSizeMB + 50;

      for (const file of sorted) {
        if (freed >= targetFree) break;
        await RNFS.unlink(file.path);
        freed += parseInt(file.size, 10) / (1024 * 1024);
      }
    }
  } catch {}
};

export const clearMediaCache = async () => {
  try {
    const files = await RNFS.readDir(MEDIA_CACHE_DIR);
    for (const file of files) {
      await RNFS.unlink(file.path);
    }
    await AsyncStorage.removeItem(CACHE_INDEX_KEY);
  } catch {}
};
