// Environment configs for IEC app
const DEVTEST_CONFIG = {
  "cityName": "DevTest",
  "city": "devtest",
  "key": "MNZ",
  "dbPath": "https://devtest-62768-default-rtdb.firebaseio.com/",
  "storagePath": "gs://devtest-62768.firebasestorage.app/DevTest",
  "empCode": "DEV",
  "firebaseStoragePath": "https://firebasestorage.googleapis.com/v0/b/devtest-62768.firebasestorage.app/o/",
  "apiKey": "AIzaSyBNHi7UP5nwqLnFU2tuKpArS1MhZDYsiLM",
  "appId": "1:799504409644:android:8ce294ed91867118cedd89",
  "authDomain": "devtest-62768.firebaseapp.com",
  "databaseURL": "https://devtest-62768-default-rtdb.firebaseio.com",
  "projectId": "devtest-62768",
  "storageBucket": "devtest-62768.firebasestorage.app",
  "messagingSenderId": "799504409644",
  "databaseName": "devtest-62768-default-rtdb",
  "isUCCApplied": "yes"
};

export const Jaipur_Office = {
  "cityName": "Jaipur",
  "city": "jaipur-office",
  "key": "JAIO",
  "dbPath": "https://dtdjaipur.firebaseio.com/",
  "storagePath": "gs://dtdnavigator.appspot.com/Jaipur",
  "empCode": "JAI",
  "firebaseStoragePath": "https://firebasestorage.googleapis.com/v0/b/dtdnavigator.appspot.com/o/",
  "apiKey": "AIzaSyBGZ_IB4y5Ov1nuqIhWndGU8hfJadlE85I",
  "appId": "1:381118272786:android:8580682aed749a06ec0fcb",
  "authDomain": "dtdnavigator.firebaseapp.com",
  "databaseURL": "https://dtdjaipur.firebaseio.com",
  "projectId": "dtdnavigator",
  "storageBucket": "dtdnavigator.appspot.com",
  "messagingSenderId": "381118272786",
  "databaseName": "dtdjaipur",
  "isUCCApplied": "no"
};

// Toggle the active Firebase config by commenting/uncommenting one line below.
// export const FIREBASE_CONFIG = DEVTEST_CONFIG;
export const FIREBASE_CONFIG = Jaipur_Office;

export const CITY = FIREBASE_CONFIG;

export const getCityStoragePrefix = (config = FIREBASE_CONFIG) => {
  const cityName = String(config?.cityName || '').trim();
  return cityName ? `${cityName}/` : '';
};

export const FIREBASE_CONFIGS = {
  DEVTEST_CONFIG,
  Jaipur_Office,
};
