import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppFeedbackProvider } from './src/components/AppFeedback';
import LauncherScreen from './src/screens/LauncherScreen';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import TaskMonitoringScreen from './src/screens/TaskMonitoringScreen';
import appTheme from './src/theme/appTheme';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <AppFeedbackProvider>
        <StatusBar
          barStyle="light-content"
          backgroundColor={appTheme.colors.brand.primaryDark}
        />
        <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Launcher"
          screenOptions={{
            headerShown: false,
            animation: 'none',
            contentStyle: {backgroundColor: appTheme.colors.neutral.background},
          }}
        >
          <Stack.Screen name="Launcher" component={LauncherScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
          <Stack.Screen name="TaskMonitoring" component={TaskMonitoringScreen} />
        </Stack.Navigator>
        </NavigationContainer>
      </AppFeedbackProvider>
    </SafeAreaProvider>
  );
}
