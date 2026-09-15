import AsyncStorage from '@react-native-async-storage/async-storage';
import {Platform} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import {FIREBASE_CONFIG} from '../firebase/firebaseConfig';
import {pushData} from '../firebase/firebaseService';
import {getLoginSession} from './sessionService';

/**
 * Error logs are written in the same shape the web app uses for action history:
 *
 *   IECAppErrorLogs/<Category>/<YYYY-MM-DD>/<pushId>
 *     _at   : "2026-08-26 14:29:18"
 *     _by   : "4"              // logged in employee id ("guest" before login)
 *     _city : "devtest"
 *     data  : { ...error details }
 *
 * Nothing in this file is allowed to throw or to block the caller — a failing
 * logger must never be the reason the app breaks.
 */
export const ERROR_LOG_ROOT = 'IECAppErrorLogs';

export const ERROR_CATEGORY = {
  Startup: 'Startup',
  VersionCheck: 'VersionCheck',
  RenderCrash: 'RenderCrash',
  UnhandledJs: 'UnhandledJs',
  UnhandledPromise: 'UnhandledPromise',
  OtaUpdate: 'OtaUpdate',
  BundleRollback: 'BundleRollback',
  MediaUpload: 'MediaUpload',
  TaskSubmit: 'TaskSubmit',
};

const PENDING_LOGS_KEY = '@iec_app_pending_error_logs';
const MAX_PENDING_LOGS = 50;
const WRITE_TIMEOUT_MS = 8000;
const DUPLICATE_WINDOW_MS = 60000;

const recentSignatures = new Map();
let isFlushing = false;

const pad = value => String(value).padStart(2, '0');

const getDayKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const getTimestamp = (date = new Date()) =>
  `${getDayKey(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;

const withTimeout = (promise, timeoutMs) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Error log write timed out')),
      timeoutMs,
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const safeString = (value, maxLength = 2000) => {
  if (value === null || value === undefined) {
    return '';
  }
  const text = typeof value === 'string' ? value : String(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

/** Firebase rejects undefined values, so every payload is flattened first. */
const sanitize = value => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return safeString(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitize);
  }

  if (typeof value === 'object') {
    const result = {};
    Object.keys(value)
      .slice(0, 30)
      .forEach(key => {
        const sanitized = sanitize(value[key]);
        if (sanitized !== null) {
          result[key] = sanitized;
        }
      });
    return Object.keys(result).length ? result : null;
  }

  return safeString(value);
};

const resolveEmpId = () => {
  try {
    const session = getLoginSession();
    return (
      safeString(
        session?.employee?.empId ||
          session?.employee?.id ||
          session?.loginId ||
          session?.employee?.userId ||
          session?.employee?.loginId,
        60,
      ) || 'guest'
    );
  } catch (_error) {
    return 'guest';
  }
};

const resolveDeviceInfo = () => {
  try {
    return {
      appVersion: safeString(DeviceInfo.getVersion(), 40),
      buildNumber: safeString(DeviceInfo.getBuildNumber(), 40),
      brand: safeString(DeviceInfo.getBrand(), 60),
      model: safeString(DeviceInfo.getModel(), 60),
      platform: Platform.OS,
      osVersion: safeString(Platform.Version, 20),
    };
  } catch (_error) {
    return {platform: Platform.OS, osVersion: safeString(Platform.Version, 20)};
  }
};

const normalizeError = error => {
  if (!error) {
    return {message: 'Unknown error'};
  }

  if (typeof error === 'string') {
    return {message: safeString(error)};
  }

  return {
    message: safeString(error.message || String(error)),
    stack: safeString(error.stack, 4000),
    code: safeString(error.code, 120),
  };
};

const isDuplicate = signature => {
  const now = Date.now();

  recentSignatures.forEach((seenAt, key) => {
    if (now - seenAt > DUPLICATE_WINDOW_MS) {
      recentSignatures.delete(key);
    }
  });

  if (recentSignatures.has(signature)) {
    return true;
  }

  recentSignatures.set(signature, now);
  return false;
};

const buildEntry = (category, error, context) => {
  const normalized = normalizeError(error);

  return {
    category: safeString(category, 60) || 'Unknown',
    dayKey: getDayKey(),
    payload: {
      _at: getTimestamp(),
      _by: resolveEmpId(),
      _city: safeString(FIREBASE_CONFIG?.city, 60),
      data:
        sanitize({
          ...normalized,
          ...resolveDeviceInfo(),
          ...(context || {}),
        }) || {message: 'Unknown error'},
    },
  };
};

const queuePendingEntry = async entry => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_LOGS_KEY);
    const pending = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(pending) ? pending : [];
    next.push(entry);
    await AsyncStorage.setItem(
      PENDING_LOGS_KEY,
      JSON.stringify(next.slice(-MAX_PENDING_LOGS)),
    );
  } catch (_error) {}
};

const writeEntry = async entry =>
  withTimeout(
    pushData(`${ERROR_LOG_ROOT}/${entry.category}/${entry.dayKey}`, entry.payload),
    WRITE_TIMEOUT_MS,
  );

/**
 * Fire-and-forget error logger. Awaiting it is optional and never required.
 */
export const logError = async (category, error, context = {}) => {
  try {
    const entry = buildEntry(category, error, context);
    const signature = `${entry.category}|${entry.payload.data?.message || ''}`;

    if (isDuplicate(signature)) {
      return false;
    }

    try {
      await writeEntry(entry);
      return true;
    } catch (_writeError) {
      // Offline / Firebase unreachable — keep it and retry on a later launch.
      await queuePendingEntry(entry);
      return false;
    }
  } catch (_error) {
    return false;
  }
};

/**
 * Pushes logs that could not be written earlier (typically the startup
 * failures we most need to see). Safe to call on every launch.
 */
export const flushPendingErrorLogs = async () => {
  if (isFlushing) {
    return;
  }
  isFlushing = true;

  try {
    const raw = await AsyncStorage.getItem(PENDING_LOGS_KEY);
    if (!raw) {
      return;
    }

    const pending = JSON.parse(raw);
    if (!Array.isArray(pending) || !pending.length) {
      await AsyncStorage.removeItem(PENDING_LOGS_KEY);
      return;
    }

    const failed = [];
    for (const entry of pending) {
      try {
        await writeEntry(entry);
      } catch (_error) {
        failed.push(entry);
      }
    }

    if (failed.length) {
      await AsyncStorage.setItem(PENDING_LOGS_KEY, JSON.stringify(failed));
    } else {
      await AsyncStorage.removeItem(PENDING_LOGS_KEY);
    }
  } catch (_error) {
  } finally {
    isFlushing = false;
  }
};
