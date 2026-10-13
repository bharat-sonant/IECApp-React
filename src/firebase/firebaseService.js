import {FIREBASE_CONFIG} from './firebaseConfig';

// initializeApp() without a name creates the app under this name.
const DEFAULT_APP_NAME = '[DEFAULT]';

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
    const {getApps, initializeApp} = require('@react-native-firebase/app');

    // This project ships no google-services.json, so there is no [DEFAULT]
    // app until we create one here. getApps() can still come back non-empty
    // without holding [DEFAULT], and a bare getApp() then throws
    //   "No Firebase App '[DEFAULT]' has been created"
    // leaving the app with no Firebase at all for the rest of the session.
    // So the app is looked up BY NAME and created when it is absent.
    const findDefault = () =>
      getApps().find(app => app?.name === DEFAULT_APP_NAME) || null;

    const alreadyCreated = findDefault();
    if (alreadyCreated) {
      _rnApp = alreadyCreated;
      return _rnApp;
    }

    try {
      _rnApp = await initializeApp({
        apiKey: FIREBASE_CONFIG.apiKey,
        appId: FIREBASE_CONFIG.appId,
        projectId: FIREBASE_CONFIG.projectId,
        databaseURL: FIREBASE_CONFIG.databaseURL,
        storageBucket: FIREBASE_CONFIG.storageBucket,
        messagingSenderId: FIREBASE_CONFIG.messagingSenderId,
      });
    } catch (error) {
      // Someone else won the race and created it between the two calls —
      // take theirs instead of failing.
      const created = findDefault();
      if (!created) {
        throw error;
      }
      _rnApp = created;
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
  try {
    const {getDatabase, get, ref} = require('@react-native-firebase/database');
    const app = await ensureApp();
    const db = getDatabase(app, FIREBASE_CONFIG?.databaseURL);
    const snapshot = await get(ref(db, path));
    const exists = snapshot.exists();
    const value = exists ? snapshot.val() : null;
    return value;
  } catch (error) {
    return null;
  }
};

export const pushData = async (path, data) => {
  const {getDatabase, ref, push, set} = require('@react-native-firebase/database');
  const db = getDatabase(await ensureApp(), FIREBASE_CONFIG?.databaseURL);
  const entryRef = push(ref(db, path));
  await set(entryRef, data);
  return entryRef.key;
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

    const {getStorage, ref, putFile} = require('@react-native-firebase/storage');
    const rawPath = String(localFilePath);
    const normalizedPath = rawPath.startsWith('file://') ? rawPath.slice(7) : rawPath;

    const storage = getStorage(await ensureApp());
    const fileRef = ref(storage, storagePath);

    try {
      await putFile(fileRef, normalizedPath, {contentType});
    } catch (firstError) {
      // Fallback: try with raw path (some platforms need file:// prefix)
      try {
        await putFile(fileRef, rawPath, {contentType});
      } catch (secondError) {
        return {
          success: false,
          error:
            secondError?.message ||
            firstError?.message ||
            'Upload failed',
        };
      }
    }

    return {success: true};
  } catch (error) {
    return {success: false, error: error?.message || String(error)};
  }
};
