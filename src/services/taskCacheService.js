import { getData } from '../firebase/firebaseService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TASK_CACHE_PREFIX = 'dashboard_tasks_cache';

const buildDashboardTaskCacheKey = (loginId, dateKey = 'latest') =>
  `${TASK_CACHE_PREFIX}:${String(loginId || '').trim()}:${String(dateKey).trim()}`;

const readDashboardTaskCache = async (loginId, dateKey = 'latest') => {
  const key = buildDashboardTaskCacheKey(loginId, dateKey);
  const raw = await AsyncStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      return null;
    }

    return parsed;
  } catch (error) {
    return null;
  }
};

const saveDashboardTaskCache = async (loginId, dateKey, tasks) => {
  const key = buildDashboardTaskCacheKey(loginId, dateKey);
  const payload = {
    savedAt: new Date().toISOString(),
    tasks: Array.isArray(tasks) ? tasks : [],
  };
  await AsyncStorage.setItem(key, JSON.stringify(payload));
  return payload;
};

const CATALOG_CACHE_KEY = 'task_catalog_cache';

const readTaskCatalogCache = async () => {
  try {
    const raw = await AsyncStorage.getItem(CATALOG_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

const saveTaskCatalogCache = async catalog => {
  if (!catalog || typeof catalog !== 'object') {
    return;
  }
  await AsyncStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(catalog));
};

const getTaskCatalog = async () => {
  const cached = await readTaskCatalogCache();
  if (cached) {
    return cached;
  }
  const fresh = await getData('IECData/Tasks');
  if (fresh && typeof fresh === 'object') {
    await saveTaskCatalogCache(fresh);
    return fresh;
  }
  return cached || {};
};

const clearTaskCache = async () => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const taskKeys = allKeys.filter(
      key => key.startsWith(TASK_CACHE_PREFIX) || key === CATALOG_CACHE_KEY,
    );
    if (taskKeys.length > 0) {
      await AsyncStorage.multiRemove(taskKeys);
    }
  } catch (error) {
  }
};

export {
  buildDashboardTaskCacheKey,
  readDashboardTaskCache,
  saveDashboardTaskCache,
  readTaskCatalogCache,
  saveTaskCatalogCache,
  getTaskCatalog,
  clearTaskCache,
};
