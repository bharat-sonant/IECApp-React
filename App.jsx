import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, StatusBar, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  AppFeedbackProvider,
  useAppFeedback,
} from './src/components/AppFeedback';
import { LocationProvider } from './src/context/LocationContext';
import CommonLoader from './src/components/CommonLoader';
import LauncherScreen from './src/screens/LauncherScreen';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import TaskMonitoringScreen from './src/screens/TaskMonitoringScreen';
import appTheme from './src/theme/appTheme';
import { validateAppVersion } from './src/services/loginService';
import { initializeFirebaseApp } from './src/firebase/firebaseService';
import { flushPendingMediaUploads } from './src/services/pendingUploadService';
import { ensureSharedMediaCleanup } from './src/services/sharedMediaService';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  getAppStateSuppressionRemainingMs,
  isAppStateSuppressed,
} from './src/services/appStateGuard';
import ErrorBoundary from './src/components/ErrorBoundary';
import {
  ERROR_CATEGORY,
  flushPendingErrorLogs,
  logError,
} from './src/services/errorLogService';
import {
  markBundleBootSuccessful,
  reportBundleRollback,
} from './src/services/otaService';

const Stack = createNativeStackNavigator();

/**
 * Firebase Realtime Database calls have no timeout of their own. On a device
 * that cannot reach the database the version check never settles, so without
 * this cap the app would sit on an empty screen forever.
 */
const VERSION_CHECK_TIMEOUT_MS = 8000;

/**
 * How long the bundle has to stay alive before we tell the native guard this
 * boot was a good one. If the app dies before that, the next launch falls back
 * to the bundle shipped inside the APK.
 */
const BOOT_CONFIRMATION_DELAY_MS = 2500;

const VersionGate = ({ onReady }) => {
  const { showAlert, dismissAlert } = useAppFeedback();
  const versionAlertShownRef = useRef(false);
  const [isCheckingVersion, setIsCheckingVersion] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const checkVersion = async (reason = 'mount') => {
      setIsCheckingVersion(true);
      try {
        // The timeout has to cover the Firebase init too — if that call hangs,
        // racing only the version lookup would still leave the app stuck here.
        const result = await Promise.race([
          (async () => {
            await initializeFirebaseApp();
            return validateAppVersion();
          })(),
          new Promise(resolve =>
            setTimeout(
              () => resolve({ ok: true, timedOut: true }),
              VERSION_CHECK_TIMEOUT_MS,
            ),
          ),
        ]);

        if (!isMounted) {
          return;
        }

        if (result.timedOut) {
          logError(
            ERROR_CATEGORY.VersionCheck,
            new Error('Version check timed out'),
            { timeoutMs: VERSION_CHECK_TIMEOUT_MS, reason },
          );
        }

        if (result.ok) {
          versionAlertShownRef.current = false;
          dismissAlert();
          onReady?.();
          return;
        }

        if (versionAlertShownRef.current) {
          return;
        }

        versionAlertShownRef.current = true;
        showAlert({
          title: 'Version Expired',
          message: 'Version Expired',
          variant: 'error',
          dismissible: false,
          buttons: [
            {
              text: 'OK',
              onPress: () => {
                BackHandler.exitApp();
              },
            },
          ],
        });
      } catch (error) {
        // A failing version check must never strand the user on a blank
        // screen — report it and let the app carry on to the login flow.
        logError(ERROR_CATEGORY.Startup, error, { step: 'versionGate', reason });
        if (isMounted) {
          onReady?.();
        }
      } finally {
        if (isMounted) {
          setIsCheckingVersion(false);
        }
      }
    };

    checkVersion('mount');

    return () => {
      isMounted = false;
    };
  }, [dismissAlert, onReady, showAlert]);

  return (
    <View style={styles.gate}>
      <CommonLoader
        visible={isCheckingVersion}
        message="Checking app version..."
      />
    </View>
  );
};

export default function App() {
  const [isVersionReady, setIsVersionReady] = useState(false);
  const navigationRef = useRef(null);
  const routeNameRef = useRef('');

  const handleVersionReady = useCallback(() => {
    setIsVersionReady(true);
  }, []);

  useEffect(() => {
    // Confirm to the native guard that this JS bundle boots, and push out any
    // startup errors that could not be reported on an earlier launch.
    const bootTimer = setTimeout(() => {
      markBundleBootSuccessful();
    }, BOOT_CONFIRMATION_DELAY_MS);

    reportBundleRollback();

    return () => {
      clearTimeout(bootTimer);
    };
  }, []);

  useEffect(() => {
    if (!isVersionReady) {
      return undefined;
    }

    let isMounted = true;
    let activeWorkTimer = null;
    let lastRunAt = 0;

    const runAppStateWork = async reason => {
      try {
        await initializeFirebaseApp();
        await Promise.all([
          validateAppVersion(),
          flushPendingMediaUploads(),
          ensureSharedMediaCleanup(),
          flushPendingErrorLogs(),
        ]);
      } catch (error) {
        logError(ERROR_CATEGORY.Startup, error, {
          step: 'appStateWork',
          reason,
        });
      }
    };

    const scheduleAppStateWork = reason => {
      if (!isMounted) {
        return;
      }

      if (activeWorkTimer) {
        clearTimeout(activeWorkTimer);
        activeWorkTimer = null;
      }

      const now = Date.now();
      const cooldownMs = 8000;
      const suppressed = isAppStateSuppressed();
      const delay = suppressed
        ? getAppStateSuppressionRemainingMs() + 1200
        : Math.max(0, cooldownMs - (now - lastRunAt)) || 1200;
      const finalDelay = Math.min(Math.max(delay, 400), 15000);

      activeWorkTimer = setTimeout(async () => {
        activeWorkTimer = null;
        if (!isMounted) {
          return;
        }

        lastRunAt = Date.now();
        await runAppStateWork(reason);
      }, finalDelay);
    };

    scheduleAppStateWork('mount');

    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active' && isMounted) {
        scheduleAppStateWork('appstate-active');
      }
    });

    return () => {
      isMounted = false;
      if (activeWorkTimer) {
        clearTimeout(activeWorkTimer);
      }
      subscription.remove();
    };
  }, [isVersionReady]);

  return (
    <ErrorBoundary screenName="App">
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <AppFeedbackProvider>
            <LocationProvider>
              <StatusBar
                barStyle="light-content"
                backgroundColor={appTheme.colors.brand.primaryDark}
              />
              {!isVersionReady ? (
                <VersionGate onReady={handleVersionReady} />
              ) : (
                <NavigationContainer
                  ref={navigationRef}
                  onReady={() => {
                    const currentRoute =
                      navigationRef.current?.getCurrentRoute?.()?.name ?? '';
                    routeNameRef.current = currentRoute;
                  }}
                  onStateChange={() => {
                    const currentRoute =
                      navigationRef.current?.getCurrentRoute?.()?.name ?? '';
                    if (currentRoute && routeNameRef.current !== currentRoute) {
                      routeNameRef.current = currentRoute;
                    }
                  }}
                >
                  <Stack.Navigator
                    initialRouteName="Launcher"
                    detachInactiveScreens
                    screenOptions={{
                      headerShown: false,
                      animation: 'none',
                      freezeOnBlur: true,
                      contentStyle: {
                        backgroundColor: appTheme.colors.neutral.background,
                      },
                    }}
                  >
                    <Stack.Screen name="Launcher" component={LauncherScreen} />
                    <Stack.Screen name="Login" component={LoginScreen} />
                    <Stack.Screen
                      name="Dashboard"
                      component={DashboardScreen}
                    />
                    <Stack.Screen
                      name="TaskMonitoring"
                      component={TaskMonitoringScreen}
                    />
                  </Stack.Navigator>
                </NavigationContainer>
              )}
            </LocationProvider>
          </AppFeedbackProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  gate: {
    flex: 1,
    backgroundColor: appTheme.colors.neutral.background,
  },
});
