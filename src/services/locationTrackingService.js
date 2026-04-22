import { getData, updateData, saveData } from '../firebase/firebaseService';
import { loadLoginSession } from '../services/sessionService';
import {
  setTrackingConfig as nativeSetTrackingConfig,
  startLocationTracking as nativeStartLocationTracking,
  stopLocationTracking as nativeStopLocationTracking,
  requestIgnoreBatteryOptimizations as nativeRequestIgnoreBatteryOptimizations,
  subscribeToLocation,
  subscribeToMinuteSnapshot,
  getPendingSnapshots,
  clearPendingSnapshots,
} from '../NativeModules/LocationTracker';

const asString = value =>
  value === null || value === undefined ? '' : String(value).trim();

const getDateParts = input => {
  const now = input ? new Date(input) : new Date();
  const year = String(now.getFullYear());
  const month = now.toLocaleString('en-US', { month: 'long' });
  const currentDate = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeKey = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return { year, month, currentDate, timeKey };
};

export const getSessionEmpId = session =>
  asString(
    session?.employee?.empId ||
      session?.employee?.id ||
      session?.loginId ||
      session?.employee?.userId ||
      session?.employee?.loginId,
  );

const resolveSnapshotDate = ({ timestamp, date, time }) => {
  if (timestamp) {
    return getDateParts(timestamp);
  }

  if (date) {
    const normalizedTime = String(time || '00:00').includes(':')
      ? String(time || '00:00')
      : `${String(time || '0000').slice(0, 2)}:${String(time || '0000').slice(2, 4)}`;
    const parsed = new Date(`${date}T${normalizedTime}:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return getDateParts(parsed);
    }
  }

  return getDateParts();
};

/**
 * Start location tracking for the current user with default config.
 */
export const startUserLocationTracking = async () => {
  try {
    const session = await loadLoginSession();
    const empId = getSessionEmpId(session);

    if (!empId) {
      throw new Error('User not logged in');
    }

    nativeSetTrackingConfig({
      gpsIntervalMs: 3000,
      accuracyThresholdM: 50,
      minDistanceM: 10,
      snapshotIntervalMs: 60000,
    });

    await nativeRequestIgnoreBatteryOptimizations();
    nativeStartLocationTracking();
    console.log('[LocationService] Tracking started for employee:', empId);
    return { success: true, empId };
  } catch (error) {
    console.log(
      '[LocationService] Failed to start tracking:',
      error?.message || error,
    );
    return { success: false, error: error?.message || error };
  }
};

/**
 * Stop location tracking service.
 */
export const stopUserLocationTracking = () => {
  try {
    nativeStopLocationTracking();
    console.log('[LocationService] Tracking stopped');
    return { success: true };
  } catch (error) {
    console.log(
      '[LocationService] Failed to stop tracking:',
      error?.message || error,
    );
    return { success: false, error: error?.message || error };
  }
};

/**
 * Subscribe to real-time location updates.
 * Returns unsubscribe function.
 */
export const subscribeToUserLocation = callback => {
  return subscribeToLocation(callback);
};

/**
 * Subscribe to minute snapshots (travel history).
 */
export const subscribeToTravelSnapshots = callback => {
  return subscribeToMinuteSnapshot(callback);
};

/**
 * Save a minute snapshot to Firebase.
 * Path: IECData/IECLocationHistory/{empId}/{year}/{month}/{date}/{HHmm}
 */
export const saveLocationSnapshot = async ({
  pathString,
  distanceInMeters,
  timestamp,
  date,
  time,
}) => {
  try {
    const session = await loadLoginSession();
    const empId = getSessionEmpId(session);

    if (!empId) {
      throw new Error('User not logged in');
    }

    const { year, month, currentDate, timeKey } = resolveSnapshotDate({
      timestamp,
      date,
      time,
    });

    const dateRootPath = `IECData/IECLocationHistory/${empId}/${year}/${month}/${currentDate}`;
    const locationPath = `${dateRootPath}/${timeKey}`;

    await saveData(locationPath, {
      'lat-lng': pathString,
      'distance-in-meter': distanceInMeters ?? 0,
    });

    const existingDateRoot = await getData(dateRootPath);
    const previousTotal =
      existingDateRoot && typeof existingDateRoot === 'object'
        ? Number(existingDateRoot.TotalCoveredDistance || 0)
        : 0;
    const nextTotal = previousTotal + (distanceInMeters ?? 0);

    await updateData(dateRootPath, {
      TotalCoveredDistance: nextTotal,
      'last-update-time': timeKey,
    });

    console.log('[LocationService] Snapshot saved:', locationPath);
    return { success: true };
  } catch (error) {
    console.log(
      '[LocationService] Failed to save snapshot:',
      error?.message || error,
    );
    return { success: false, error: error?.message || error };
  }
};

/**
 * Flush pending snapshots from native buffer (app was killed while tracking).
 */
export const flushPendingLocationSnapshots = async () => {
  try {
    const snapshots = await getPendingSnapshots();
    if (!snapshots || !Array.isArray(snapshots) || snapshots.length === 0) {
      return { success: true, flushed: 0 };
    }

    console.log(
      '[LocationService] Flushing',
      snapshots.length,
      'pending snapshots',
    );

    for (const snapshot of snapshots) {
      await saveLocationSnapshot({
        pathString: snapshot.path,
        distanceInMeters: snapshot.distanceInMeters,
        timestamp: snapshot.timestamp,
        date: snapshot.date,
        time: snapshot.time,
      });
    }

    await clearPendingSnapshots();
    console.log('[LocationService] Flushed', snapshots.length, 'snapshots');
    return { success: true, flushed: snapshots.length };
  } catch (error) {
    console.log('[LocationService] Flush failed:', error?.message || error);
    return { success: false, error: error?.message || error };
  }
};

// Re-export raw native functions for direct control
export {
  nativeSetTrackingConfig as setTrackingConfig,
  nativeStartLocationTracking as startLocationTracking,
  nativeStopLocationTracking as stopLocationTracking,
  nativeRequestIgnoreBatteryOptimizations as requestIgnoreBatteryOptimizations,
};
