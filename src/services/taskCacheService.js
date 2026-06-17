import { getData, initializeFirebaseApp } from '../firebase/firebaseService';
import { FIREBASE_CONFIG } from '../firebase/firebaseConfig';
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

const catalogListeners = new Set();
let activeCatalogUnsub = null;
let liveCatalog = null;
let syncStarting = false;

const notifyCatalogListeners = () => {
  for (const fn of catalogListeners) {
    try {
      fn(liveCatalog);
    } catch {
      // Ignore listener errors
    }
  }
};

const startCatalogSync = async () => {
  if (activeCatalogUnsub || syncStarting) {
    return;
  }
  syncStarting = true;
  try {
    const {
      getDatabase,
      ref,
      onChildAdded,
      onChildChanged,
      onChildRemoved,
    } = require('@react-native-firebase/database');

    const cached = await readTaskCatalogCache();
    liveCatalog =
      cached && typeof cached === 'object' && !Array.isArray(cached)
        ? { ...cached }
        : {};

    const app = await initializeFirebaseApp();
    const db = getDatabase(app, FIREBASE_CONFIG?.databaseURL);
    const tasksRef = ref(db, 'IECData/Tasks');

    const persistAndNotify = () => {
      saveTaskCatalogCache(liveCatalog).catch(() => {});
      notifyCatalogListeners();
    };

    const addedUnsub = onChildAdded(tasksRef, snapshot => {
      const key = snapshot.key;
      if (!key) {
        return;
      }
      if (liveCatalog && Object.prototype.hasOwnProperty.call(liveCatalog, key)) {
        return;
      }
      if (!liveCatalog) {
        liveCatalog = {};
      }
      liveCatalog[key] = snapshot.val();
      persistAndNotify();
    });

    const changedUnsub = onChildChanged(tasksRef, snapshot => {
      const key = snapshot.key;
      if (!key) {
        return;
      }
      if (!liveCatalog) {
        liveCatalog = {};
      }
      liveCatalog[key] = snapshot.val();
      persistAndNotify();
    });

    const removedUnsub = onChildRemoved(tasksRef, snapshot => {
      const key = snapshot.key;
      if (!key || !liveCatalog || !(key in liveCatalog)) {
        return;
      }
      delete liveCatalog[key];
      persistAndNotify();
    });

    activeCatalogUnsub = () => {
      try {
        addedUnsub();
      } catch {
        // ignore
      }
      try {
        changedUnsub();
      } catch {
        // ignore
      }
      try {
        removedUnsub();
      } catch {
        // ignore
      }
      activeCatalogUnsub = null;
    };
  } catch {
    // ignore — listener attach failed (offline, missing native module, etc.)
  } finally {
    syncStarting = false;
  }
};

const stopCatalogSync = () => {
  if (activeCatalogUnsub) {
    activeCatalogUnsub();
  }
  liveCatalog = null;
};

const subscribeTaskCatalog = listener => {
  if (typeof listener !== 'function') {
    return () => {};
  }
  catalogListeners.add(listener);
  startCatalogSync();
  return () => {
    catalogListeners.delete(listener);
    if (catalogListeners.size === 0) {
      stopCatalogSync();
    }
  };
};

export {
  buildDashboardTaskCacheKey,
  readDashboardTaskCache,
  saveDashboardTaskCache,
  readTaskCatalogCache,
  saveTaskCatalogCache,
  getTaskCatalog,
  clearTaskCache,
  subscribeTaskCatalog,
};
