/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { installGlobalErrorHandler } from './src/services/globalErrorHandler';
import App from './App';
import { name as appName } from './app.json';

// Installed first so errors thrown while the app boots are reported too.
installGlobalErrorHandler();

AppRegistry.registerComponent(appName, () => App);
