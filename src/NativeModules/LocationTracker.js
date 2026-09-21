import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { LocationTracker } = NativeModules;

// Only available on Android
const emitter =
  Platform.OS === 'android' ? new NativeEventEmitter(LocationTracker) : null;

/**
 * Save tracking config to native SharedPreferences.
 * Must be called BEFORE startLocationTracking().
 *   gpsIntervalMs       — GPS polling interval in ms       (default: 3000)
 *   accuracyThresholdM  — max accuracy for snapshot points (default: 50)
 *   minDistanceM        — minimum distance between points   (default: 10)
 *   snapshotIntervalMs  — how often to flush snapshot      (default: 60000)
 */
export const setTrackingConfig = config => {
  if (
    Platform.OS === 'android' &&
    config &&
    LocationTracker.setTrackingConfig
  ) {
    LocationTracker.setTrackingConfig(config);
  }
};

/**
 * Not Approved task alerts (phone notification from the tracking service).
 * config: { empId, apiKey, appId, projectId, databaseURL }.
 * Must be called BEFORE startLocationTracking().
 */
export const setTaskAlertConfig = config => {
  if (Platform.OS === 'android' && config && LocationTracker?.setTaskAlertConfig) {
    LocationTracker.setTaskAlertConfig(config);
  }
};

/** Logout — stop task alerts for this executive on this phone. */
export const clearTaskAlertConfig = () => {
  if (Platform.OS === 'android' && LocationTracker?.clearTaskAlertConfig) {
    LocationTracker.clearTaskAlertConfig();
  }
};

/**
 * Opens the system battery optimization exemption screen.
 */
export const requestIgnoreBatteryOptimizations = async () => {
  if (Platform.OS !== 'android' || !LocationTracker?.requestIgnoreBatteryOptimizations) {
    return false;
  }
  try {
    return await LocationTracker.requestIgnoreBatteryOptimizations();
  } catch {
    return false;
  }
};

/**
 * Checks if the app is already exempt from battery optimizations.
 */
export const isIgnoringBatteryOptimizations = async () => {
  if (Platform.OS !== 'android' || !LocationTracker?.isIgnoringBatteryOptimizations) {
    return false;
  }
  try {
    return await LocationTracker.isIgnoringBatteryOptimizations();
  } catch {
    return false;
  }
};

/**
 * Start foreground location tracking service.
 * Call setTrackingConfig() first if you want custom intervals.
 */
export const startLocationTracking = () => {
  if (Platform.OS === 'android') {
    LocationTracker.clearTrackingStopFlags?.();
    LocationTracker.startTracking();
  }
};

/**
 * Stop foreground location tracking service.
 * Call this on logout or end duty.
 */
export const stopLocationTracking = () => {
  if (Platform.OS === 'android') {
    LocationTracker.markManualStop?.();
    LocationTracker.stopTracking();
  }
};

/**
 * Subscribe to real-time location updates.
 * Uses a simple queue so map marker moves smoothly — no jumps.
 *
 * callback({ latitude, longitude, accuracy, speed })
 * Returns unsubscribe function.
 */
export const subscribeToLocation = callback => {
  if (!emitter) return () => {};
  const sub = emitter.addListener('onLocationUpdate', loc => {
    callback(loc);
  });
  return () => sub.remove();
};

/**
 * Reads location snapshots buffered in native SharedPreferences while the JS bridge
 * was dead (app was killed). Clears the buffer after reading.
 * Returns Promise<Array<{ path, distanceInMeters, time, date }>>.
 */
export const getPendingSnapshots = () => {
  if (Platform.OS !== 'android') return Promise.resolve([]);
  return LocationTracker.getPendingSnapshots();
};

/**
 * Clears the native location buffer after JS has successfully saved all items to Firebase.
 */
export const clearPendingSnapshots = () => {
  if (Platform.OS === 'android' && LocationTracker?.clearPendingSnapshots) {
    LocationTracker.clearPendingSnapshots();
  }
};

/**
 * Subscribe to per-minute travel snapshots.
 * callback({ path: "(lat,lng)~(lat,lng)~...", distanceInMeters, timestamp, date, time })
 * Returns unsubscribe function.
 */
export const subscribeToMinuteSnapshot = callback => {
  if (!emitter) return () => {};
  const sub = emitter.addListener('onMinuteSnapshot', snapshot => {
    const pointCount = snapshot.path ? snapshot.path.split('~').length : 0;
    callback(snapshot);
  });
  return () => sub.remove();
};

/**
 * Fast one-off location fix for task submit — last known fix first, one fresh
 * high-accuracy fix only if that is missing/stale. Never waits on the live
 * tracking stream. Resolves { latitude, longitude, accuracy, speed } or null.
 */
export const getCurrentLocation = (timeoutMs = 6000) => {
  if (Platform.OS !== 'android' || !LocationTracker?.getCurrentLocation) {
    return Promise.resolve(null);
  }
  return Promise.race([
    LocationTracker.getCurrentLocation().catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ]);
};

export const getLocalityFromLatLng = async (latitude, longitude) => {
  if (Platform.OS !== 'android') return '';
  if (!LocationTracker?.getLocalityFromLatLng) return '';
  try {
    const locality = await LocationTracker.getLocalityFromLatLng(
      Number(latitude),
      Number(longitude),
    );
    return String(locality || '');
  } catch {
    return '';
  }
};
