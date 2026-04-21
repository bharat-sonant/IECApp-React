import {FIREBASE_CONFIG} from './firebaseConfig';

let _rnApp = null;
let _initPromise = null;

export const initializeFirebaseApp = async () => {
  if (_rnApp) {
    return _rnApp;
  }

  if (_initPromise) {
    return _initPromise;
  }

  _initPromise = (async () => {
    const {getApp, getApps, initializeApp} = require('@react-native-firebase/app');
    const existingApps = getApps();
    if (existingApps.length > 0) {
      _rnApp = getApp();
    } else {
      _rnApp = initializeApp({
        apiKey: FIREBASE_CONFIG.apiKey,
        appId: FIREBASE_CONFIG.appId,
        projectId: FIREBASE_CONFIG.projectId,
        databaseURL: FIREBASE_CONFIG.databaseURL,
        storageBucket: FIREBASE_CONFIG.storageBucket,
        messagingSenderId: FIREBASE_CONFIG.messagingSenderId,
      });
    }

    return _rnApp;
  })();

  try {
    return await _initPromise;
  } finally {
    _initPromise = null;
  }
};

const ensureApp = async () => {
  if (_rnApp) return _rnApp;
  return initializeFirebaseApp();
};

export const getData = async path => {
  const {getDatabase, get, ref} = require('@react-native-firebase/database');
  const app = await ensureApp();
  const db = getDatabase(app, FIREBASE_CONFIG?.databaseURL);
  const snapshot = await get(ref(db, path));
  const exists = snapshot.exists();
  const value = exists ? snapshot.val() : null;
  return value;
};

export const saveData = async (path, data) => {
  const {getDatabase, ref, set} = require('@react-native-firebase/database');
  const db = getDatabase(await ensureApp(), FIREBASE_CONFIG?.databaseURL);
  await set(ref(db, path), data);
};

export const updateData = async (path, data) => {
  const {getDatabase, ref, update} = require('@react-native-firebase/database');
  const db = getDatabase(await ensureApp(), FIREBASE_CONFIG?.databaseURL);
  await update(ref(db, path), data);
};

export const removeData = async path => {
  const {getDatabase, ref, remove} = require('@react-native-firebase/database');
  const db = getDatabase(await ensureApp(), FIREBASE_CONFIG?.databaseURL);
  await remove(ref(db, path));
};

export const uploadFileToStorage = async (storagePath, localFilePath, contentType = 'image/jpeg') => {
  try {
    if (!storagePath || !localFilePath) {
      return {success: false, error: 'Missing storagePath/localFilePath'};
    }

    const {getStorage} = require('@react-native-firebase/storage');
    const rawPath = String(localFilePath);
    const normalizedPath = rawPath.startsWith('file://') ? rawPath.slice(7) : rawPath;

    const fileRef = getStorage(await ensureApp()).ref(storagePath);
    try {
      await fileRef.putFile(normalizedPath, {contentType});
    } catch {
      await fileRef.putFile(rawPath, {contentType});
    }

    const directUrl = await fileRef.getDownloadURL();
    return {success: true, data: directUrl};
  } catch (error) {
    return {success: false, error: error?.message || String(error)};
  }
};
