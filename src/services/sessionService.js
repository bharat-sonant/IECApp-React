const SESSION_STORAGE_KEY = '@iec_app_login_session';

let currentSession = null;

const getAsyncStorage = () => {
  try {
    const mod = require('@react-native-async-storage/async-storage');
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
};

export const setLoginSession = session => {
  currentSession = session ? {...session} : null;
  return currentSession;
};

export const saveLoginSession = async session => {
  const nextSession = setLoginSession(session);
  const asyncStorage = getAsyncStorage();

  if (!asyncStorage?.setItem || !asyncStorage?.removeItem) {
    return nextSession;
  }

  if (nextSession) {
    await asyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
  } else {
    await asyncStorage.removeItem(SESSION_STORAGE_KEY);
  }

  return nextSession;
};

export const loadLoginSession = async () => {
  if (currentSession) {
    return currentSession;
  }

  const asyncStorage = getAsyncStorage();

  if (!asyncStorage?.getItem) {
    return currentSession;
  }

  const rawSession = await asyncStorage.getItem(SESSION_STORAGE_KEY);

  if (!rawSession) {
    currentSession = null;
    return null;
  }

  try {
    currentSession = JSON.parse(rawSession);
  } catch {
    currentSession = null;
  }

  return currentSession;
};

export const getLoginSession = () => currentSession;

export const clearLoginSession = async () => {
  currentSession = null;

  const asyncStorage = getAsyncStorage();
  if (!asyncStorage?.removeItem) {
    return;
  }

  await asyncStorage.removeItem(SESSION_STORAGE_KEY);
};
