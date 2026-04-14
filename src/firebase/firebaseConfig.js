// DevTest-only Firebase config for IEC app
const DEVTEST_CONFIG = {
  apiKey: 'AIzaSyBNHi7UP5nwqLnFU2tuKpArS1MhZDYsiLM',
  authDomain: 'devtest-62768.firebaseapp.com',
  databaseURL: 'https://devtest-62768-default-rtdb.firebaseio.com',
  projectId: 'devtest-62768',
  storageBucket: 'devtest-62768.firebasestorage.app',
  messagingSenderId: '799504409644',
  appId: '1:799504409644:android:8ce294ed91867118cedd89',
};

export const CITY = {
  cityName: 'DevTest',
  city: 'devtest',
  key: 'MNZ',
  dbPath: `${DEVTEST_CONFIG.databaseURL}/`,
  empCode: 'DEV',
  storagePath: 'gs://devtest-62768.firebasestorage.app/DevTest',
  firebaseStoragePath: 'https://firebasestorage.googleapis.com/v0/b/devtest-62768.firebasestorage.app/o/',
  apiKey: DEVTEST_CONFIG.apiKey,
  appId: DEVTEST_CONFIG.appId,
  authDomain: DEVTEST_CONFIG.authDomain,
  databaseURL: DEVTEST_CONFIG.databaseURL,
  projectId: DEVTEST_CONFIG.projectId,
  storageBucket: DEVTEST_CONFIG.storageBucket,
  messagingSenderId: DEVTEST_CONFIG.messagingSenderId,
  databaseName: 'devtest-62768-default-rtdb',
  isUCCApplied: 'yes',
};

export const FIREBASE_CONFIG = DEVTEST_CONFIG;
