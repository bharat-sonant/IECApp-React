import React, { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, StatusBar, View } from 'react-native';
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
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  getAppStateSuppressionRemainingMs,
  isAppStateSuppressed,
} from './src/services/appStateGuard';

const Stack = createNativeStackNavigator();

const VersionGate = ({ onReady }) => {
  const { showAlert, dismissAlert } = useAppFeedback();
  const versionAlertShownRef = useRef(false);
  const [isCheckingVersion, setIsCheckingVersion] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const checkVersion = async (reason = 'mount') => {
      setIsCheckingVersion(true);
      try {
        console.log('[VersionGate] check start', { reason });
        await initializeFirebaseApp();
        const result = await validateAppVersion();
        if (!isMounted) {
          return;
        }

        console.log('[VersionGate] check result', {
          reason,
          ok: Boolean(result?.ok),
        });

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
        console.log('[VersionGate] check failed', {
          reason,
          message: error?.message || '(no message)',
        });
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
    <View pointerEvents="none">
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

  useEffect(() => {
    if (!isVersionReady) {
      return undefined;
    }

    let isMounted = true;
    let activeWorkTimer = null;
    let lastRunAt = 0;

    const runAppStateWork = async reason => {
      try {
        console.log('[AppState] work start', { reason });
        await initializeFirebaseApp();
        await Promise.all([validateAppVersion(), flushPendingMediaUploads()]);
        console.log('[AppState] work complete', { reason });
      } catch (error) {
        console.log('[AppState] work failed', {
          reason,
          message: error?.message || '(no message)',
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
      console.log('[AppState] work scheduled', {
        reason,
        suppressed,
        finalDelay,
      });

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
      console.log('[AppState] listener cleanup');
    };
  }, [isVersionReady]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppFeedbackProvider>
          <LocationProvider>
            <StatusBar
              barStyle="light-content"
              backgroundColor={appTheme.colors.brand.primaryDark}
            />
            {!isVersionReady ? (
              <VersionGate
                onReady={() => {
                  console.log('[App] version gate ready');
                  setIsVersionReady(true);
                }}
              />
            ) : (
              <NavigationContainer
                ref={navigationRef}
                onReady={() => {
                  const currentRoute =
                    navigationRef.current?.getCurrentRoute?.()?.name ?? '';
                  routeNameRef.current = currentRoute;
                  console.log('[Navigator] ready', {
                    route: currentRoute || '(none)',
                  });
                }}
                onStateChange={() => {
                  const currentRoute =
                    navigationRef.current?.getCurrentRoute?.()?.name ?? '';
                  if (currentRoute && routeNameRef.current !== currentRoute) {
                    console.log('[Navigator] route changed', {
                      from: routeNameRef.current || '(none)',
                      to: currentRoute,
                    });
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
                  <Stack.Screen name="Dashboard" component={DashboardScreen} />
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
  );
}
