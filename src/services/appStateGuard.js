let suppressUntil = 0;

export const beginAppStateSuppression = (durationMs = 10000) => {
  const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 10000;
  suppressUntil = Math.max(suppressUntil, Date.now() + safeDuration);
  return suppressUntil;
};

export const clearAppStateSuppression = () => {
  suppressUntil = 0;
};

export const isAppStateSuppressed = () => Date.now() < suppressUntil;

export const getAppStateSuppressionRemainingMs = () => Math.max(0, suppressUntil - Date.now());
