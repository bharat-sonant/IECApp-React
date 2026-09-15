import {ERROR_CATEGORY, logError} from './errorLogService';

let isInstalled = false;

/**
 * Catches JS errors that escape React (native module callbacks, timers,
 * unhandled promise rejections) and records them in IECAppErrorLogs.
 *
 * The previous handler is always chained so the dev red box keeps working.
 */
export const installGlobalErrorHandler = () => {
  if (isInstalled) {
    return;
  }
  isInstalled = true;

  try {
    const errorUtils = global?.ErrorUtils;
    const previousHandler = errorUtils?.getGlobalHandler?.();

    errorUtils?.setGlobalHandler?.((error, isFatal) => {
      logError(ERROR_CATEGORY.UnhandledJs, error, {
        isFatal: Boolean(isFatal),
        source: 'ErrorUtils',
      });

      previousHandler?.(error, isFatal);
    });
  } catch (_error) {}

  if (__DEV__) {
    // Leave promise rejection reporting to Metro/red box in development.
    return;
  }

  try {
    const tracker = global?.HermesInternal?.enablePromiseRejectionTracker;

    if (typeof tracker === 'function') {
      tracker({
        allRejections: true,
        onUnhandled: (id, rejection) => {
          logError(ERROR_CATEGORY.UnhandledPromise, rejection, {
            source: 'HermesPromiseRejection',
            rejectionId: String(id),
          });
        },
        onHandled: () => {},
      });
    }
  } catch (_error) {}
};
