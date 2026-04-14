import {FIREBASE_CONFIG} from './firebaseConfig';

let _rnApp = null;

const ensureApp = () => {
  if (_rnApp) return _rnApp;

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
};

export const getData = async path => {
  const {getDatabase} = require('@react-native-firebase/database');
  const snapshot = await getDatabase(ensureApp()).ref(path).once('value');
  return snapshot.exists() ? snapshot.val() : null;
};

export const saveData = async (path, data) => {
  const {getDatabase} = require('@react-native-firebase/database');
  await getDatabase(ensureApp()).ref(path).set(data);
};

export const updateData = async (path, data) => {
  const {getDatabase} = require('@react-native-firebase/database');
  await getDatabase(ensureApp()).ref(path).update(data);
};

export const removeData = async path => {
  const {getDatabase} = require('@react-native-firebase/database');
  await getDatabase(ensureApp()).ref(path).remove();
};

export const uploadFileToStorage = async (storagePath, localFilePath, contentType = 'image/jpeg') => {
  try {
    if (!storagePath || !localFilePath) {
      return {success: false, error: 'Missing storagePath/localFilePath'};
    }

    const {getStorage} = require('@react-native-firebase/storage');
    const rawPath = String(localFilePath);
    const normalizedPath = rawPath.startsWith('file://') ? rawPath.slice(7) : rawPath;

    const fileRef = getStorage(ensureApp()).ref(storagePath);
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

export const getDownloadUrl = async storagePath => {
  const {getStorage} = require('@react-native-firebase/storage');
  return getStorage(ensureApp()).ref(storagePath).getDownloadURL();
};
