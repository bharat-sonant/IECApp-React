import {BackHandler} from 'react-native';
import RNRestart from 'react-native-restart';

/** Reloads the JS bundle; falls back to closing the app if that is unavailable. */
export const restartApp = () => {
  try {
    if (RNRestart?.Restart) {
      RNRestart.Restart();
      return;
    }

    if (RNRestart?.restart) {
      RNRestart.restart();
      return;
    }
  } catch (_error) {}

  BackHandler.exitApp();
};

export default restartApp;
