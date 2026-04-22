import { useEffect, useRef } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Requests all required runtime permissions at app start (Android only).
 *
 * Order matters:
 *  1. FINE_LOCATION + COARSE_LOCATION + CAMERA (+ POST_NOTIFICATIONS on API 33+) — together
 *  2. ACCESS_BACKGROUND_LOCATION — separately, only after fine location is granted
 *     (Android 11+ enforces this; requesting together silently fails)
 */
export default function usePermissions() {
  const requested = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || requested.current) return;
    requested.current = true;
    requestAll();
  }, []);
}

async function requestAll() {
  try {
    // Step 1: foreground permissions
    const batch = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      PermissionsAndroid.PERMISSIONS.CAMERA,
    ];

    // POST_NOTIFICATIONS required on Android 13+ (API 33) for foreground service notification
    if (Platform.Version >= 33) {
      batch.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }

    const results = await PermissionsAndroid.requestMultiple(batch);

    const fineGranted =
      results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
      PermissionsAndroid.RESULTS.GRANTED;

    // Step 2: background location — must be after fine location
    // Android 10+ (API 29) requires a separate request
    if (fineGranted && Platform.Version >= 29) {
      const bgResult = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
        {
          title: 'Background Location',
          message:
            'This app requires background location permission. Please select "Allow all the time".',
          buttonPositive: 'Allow',
        },
      );

      if (bgResult !== PermissionsAndroid.RESULTS.GRANTED) {
        // App still works — foreground tracking will work, background may stop on some OEMs
      }
    }
  } catch (e) {
  }
}
