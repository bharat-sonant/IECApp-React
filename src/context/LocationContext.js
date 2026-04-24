import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import usePermissions from '../hooks/usePermissions';
import {
  startLocationTracking,
  stopLocationTracking,
  setTrackingConfig,
  requestIgnoreBatteryOptimizations,
  subscribeToUserLocation,
  subscribeToTravelSnapshots,
  flushPendingLocationSnapshots,
  isIgnoringBatteryOptimizations,
  saveLocationSnapshot,
  getSessionEmpId,
} from '../services/locationTrackingService';
import { loadLoginSession } from '../services/sessionService';

const LocationContext = createContext(null);

export const useLocation = () => {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used within LocationProvider');
  return ctx;
};

export const LocationProvider = ({ children }) => {
  usePermissions(); // Requests on mount
  const [isTracking, setIsTracking] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null); // { latitude, longitude, accuracy, speed }
  const [error, setError] = useState(null);
  const isStartingRef = useRef(false);
  const isTrackingRef = useRef(false);
  const stopTrackingRef = useRef(null);

  // Start tracking (call after login)
  const startTracking = useCallback(async () => {
    if (isStartingRef.current || isTrackingRef.current) return true;
    isStartingRef.current = true;
    isTrackingRef.current = true;
    setIsTracking(true);
    try {
      const session = await loadLoginSession();
      const empId = getSessionEmpId(session);

      if (!empId) {
        throw new Error('User not logged in');
      }

      // Set up listeners FIRST before starting native tracking
      const unsubLocation = subscribeToUserLocation(loc => {
        setCurrentLocation(loc);
      });

      const unsubSnapshots = subscribeToTravelSnapshots(async snapshot => {
        await saveLocationSnapshot({
          pathString: snapshot.path,
          distanceInMeters: snapshot.distanceInMeters,
          timestamp: snapshot.timestamp,
          date: snapshot.date,
          time: snapshot.time,
        });
      });

      // Flush any old pending snapshots from previous sessions
      await flushPendingLocationSnapshots();

      // Configure tracking parameters
      setTrackingConfig({
        gpsIntervalMs: 10000,
        accuracyThresholdM: 50,
        minDistanceM: 10,
        snapshotIntervalMs: 60000,
        stillIntervalMs: 30000, // Drop to 30s when stationary
        stillSpeedKmh: 3.0,     // Switch if < 3km/h (walking is ~5km/h)
        stillFixCount: 3,       // Wait 3 fixes before dropping
        moveFixCount: 2         // Wait 2 fixes before restoring
      });

      // start native tracking - listeners are already listening
      startLocationTracking();
      console.log('[LocationService] Tracking started for employee:', empId);

      stopTrackingRef.current = () => {
        unsubLocation();
        unsubSnapshots();
        stopLocationTracking();
      };

      return true;
    } catch (err) {
      setIsTracking(false);
      isTrackingRef.current = false;
      setError(err?.message || err);
      return false;
    } finally {
      isStartingRef.current = false;
    }
  }, []);

  // Stop tracking (call on logout)
  const stopTracking = useCallback(() => {
    if (stopTrackingRef.current) {
      stopTrackingRef.current();
      stopTrackingRef.current = null;
    } else {
      stopLocationTracking();
    }
    isStartingRef.current = false;
    isTrackingRef.current = false;
    setIsTracking(false);
    setCurrentLocation(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopLocationTracking();
    };
  }, []);

  return (
    <LocationContext.Provider
      value={{
        isTracking,
        currentLocation,
        error,
        startTracking,
        stopTracking,
        isIgnoringBatteryOptimizations,
        requestIgnoreBatteryOptimizations,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
};
