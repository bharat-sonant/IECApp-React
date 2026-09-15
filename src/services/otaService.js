import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import { BackHandler, NativeModules, Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { getData } from '../firebase/dbServices';
import { restartApp } from './appRestart';
import { ERROR_CATEGORY, logError } from './errorLogService';
import {
  ENABLE_JS_BUNDLE_OTA,
  OTA_DB_PATH,
  OTA_GITHUB_TOKEN,
  OTA_RELEASES_URL,
} from '../constants/appVersion';

const REPO_URL = OTA_RELEASES_URL;
const LEGACY_BUNDLE_PATH = `${RNFS.DocumentDirectoryPath}/index.android.bundle`;
const LEGACY_BUNDLE_TMP_PATH = `${LEGACY_BUNDLE_PATH}.tmp`;
const OTA_PACKAGE_PATH = `${RNFS.DocumentDirectoryPath}/ota-package.zip`;
const OTA_PACKAGE_TMP_PATH = `${OTA_PACKAGE_PATH}.tmp`;
const LAST_BUNDLE_ASSET_ID_KEY = 'LAST_BUNDLE_ASSET_ID';

/** A real JS bundle is never this small — anything smaller is a broken download. */
const MIN_BUNDLE_BYTES = 100000;

const { OtaPackageInstaller } = NativeModules;

/**
 * Tells the native guard that this bundle started fine. Until this runs, the
 * next launch will roll the downloaded bundle back and boot the APK bundle.
 */
export const markBundleBootSuccessful = async () => {
  try {
    await OtaPackageInstaller?.markBootSuccessful?.();
  } catch (_error) {}
};

/**
 * If the native guard discarded a broken bundle on this launch, clear the
 * stored asset id so the update can be downloaded again, and report it.
 */
export const reportBundleRollback = async () => {
  try {
    const status = await OtaPackageInstaller?.consumeBootStatus?.();

    if (!status?.rolledBack) {
      return false;
    }

    await AsyncStorage.removeItem(LAST_BUNDLE_ASSET_ID_KEY);
    logError(
      ERROR_CATEGORY.BundleRollback,
      new Error('Downloaded JS bundle was rolled back'),
      { reason: status.reason || '', recoveredWith: 'apk-bundle' },
    );
    return true;
  } catch (_error) {
    return false;
  }
};

/**
 * Downloads to a temp file first and only swaps it in once it is complete and
 * big enough. An interrupted download must never be left at the path the app
 * boots from.
 */
const downloadToTempFile = async ({ url, token, tempPath, onProgress }) => {
  await safeDeletePath(tempPath);

  const result = await RNFS.downloadFile({
    fromUrl: url,
    headers: getAuthHeaders(token),
    toFile: tempPath,
    background: true,
    progress: res => {
      if (!res.contentLength) {
        return;
      }
      const percentage = ((res.bytesWritten / res.contentLength) * 100).toFixed(0);
      onProgress?.(parseInt(percentage, 10));
    },
  }).promise;

  if (result.statusCode !== 200) {
    throw new Error(`Download failed with status ${result.statusCode}`);
  }

  const stat = await RNFS.stat(tempPath);
  if (Number(stat.size) < MIN_BUNDLE_BYTES) {
    throw new Error(`Downloaded file is incomplete (${stat.size} bytes)`);
  }
};

const replaceFile = async (tempPath, finalPath) => {
  await safeDeletePath(finalPath);
  await RNFS.moveFile(tempPath, finalPath);
};

const normalizeVersion = (version = '') =>
  String(version).replace(/^v/i, '').trim();

const safeDeletePath = async path => {
  try {
    const exists = await RNFS.exists(path);
    if (exists) {
      await RNFS.unlink(path);
    }
  } catch (_error) {}
};

const getAuthHeaders = (token = '') =>
  token
    ? {
        Authorization: `token ${token}`,
        Accept: 'application/octet-stream',
      }
    : {};

const fetchReleaseData = async token => {
  if (
    !REPO_URL ||
    REPO_URL.includes('<owner>') ||
    REPO_URL.includes('<repo>')
  ) {
    throw new Error('Update service is unavailable. Please contact admin.');
  }

  const headers = token ? { Authorization: `token ${token}` } : {};
  const response = await fetch(REPO_URL, { headers });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'Unable to verify updates right now. Please contact admin.',
      );
    }
    if (response.status === 404) {
      return null;
    }
    throw new Error(
      'Unable to check for updates right now. Please try again shortly.',
    );
  }
  return response.json();
};

export const checkForUpdates = async (
  callbacks = {},
  runtimeConfig = null,
  options = {},
) => {
  const { onUpdateFound, onProgress, onComplete, onError } = callbacks;

  if (__DEV__) return false;

  try {
    const shouldForceRefreshDb = Boolean(options?.forceRefreshDb);
    const dbPayload = shouldForceRefreshDb
      ? (await getData(OTA_DB_PATH)) || {}
      : runtimeConfig || (await getData(OTA_DB_PATH)) || {};

    const dbVersion = normalizeVersion(dbPayload?.version);
    const gitAccessToken = OTA_GITHUB_TOKEN || '';
    const installedAppVersion = normalizeVersion(DeviceInfo.getVersion());

    const releaseData = await fetchReleaseData(gitAccessToken);
    if (!releaseData) {
      return false;
    }
    const latestVersion = releaseData.tag_name;
    const normalizedLatestVersion = normalizeVersion(latestVersion);
    if (!normalizedLatestVersion) {
      return false;
    }

    if (Platform.OS === 'android') {
      const skipNativeExit = Boolean(options?.skipNativeExit);
      const hasDbVersion = Boolean(dbVersion);
      const hasInstalledVersion = Boolean(installedAppVersion);
      const hasNativeVersionMismatch =
        hasDbVersion &&
        hasInstalledVersion &&
        (dbVersion !== normalizedLatestVersion ||
          installedAppVersion !== dbVersion ||
          installedAppVersion !== normalizedLatestVersion);

      if (hasDbVersion && hasInstalledVersion && hasNativeVersionMismatch) {
        onUpdateFound?.(
          latestVersion,
          'Your app is outdated. Please install the new APK to continue.',
          () => {
            if (skipNativeExit) return;
            BackHandler.exitApp();
          },
          {
            updateType: 'native',
            mandatoryBlock: true,
            modalTitle: 'Version Expired',
            actionLabel: 'OK',
            hideActions: false,
            hideFooterNote: true,
            nonDismissible: true,
          },
        );
        return true;
      }
    }

    if (ENABLE_JS_BUNDLE_OTA) {
      const otaPackageAsset =
        releaseData.assets.find(asset => asset.name === 'ota-package.zip') ||
        releaseData.assets.find(asset => asset.name === 'index.android.bundle');

      if (otaPackageAsset) {
        const latestBundleAssetId = otaPackageAsset?.id
          ? String(otaPackageAsset.id)
          : null;
        const storedBundleAssetId = await AsyncStorage.getItem(
          LAST_BUNDLE_ASSET_ID_KEY,
        );

        const shouldOfferJsUpdate = Boolean(
          latestBundleAssetId && latestBundleAssetId !== storedBundleAssetId,
        );

        if (!shouldOfferJsUpdate) {
          return false;
        }

        const downloadUrl = gitAccessToken
          ? otaPackageAsset.url
          : otaPackageAsset.browser_download_url;
        onUpdateFound?.(
          latestVersion,
          'A new app update is ready to install.',
          () => {
            if (otaPackageAsset.name === 'ota-package.zip') {
              downloadOtaPackage(
                downloadUrl,
                latestBundleAssetId,
                gitAccessToken,
                onProgress,
                onComplete,
                onError,
              );
            } else {
              downloadLegacyBundle(
                downloadUrl,
                latestBundleAssetId,
                gitAccessToken,
                onProgress,
                onComplete,
                onError,
              );
            }
          },
          { updateType: 'js' },
        );
        return true;
      }

      return false;
    }

    return true;
  } catch (error) {
    logError(ERROR_CATEGORY.OtaUpdate, error, { step: 'checkForUpdates' });
    onError?.(error);
    return false;
  }
};

const downloadOtaPackage = async (
  url,
  assetId,
  token,
  onProgress,
  onComplete,
  onError,
) => {
  try {
    if (!OtaPackageInstaller?.install) {
      throw new Error('OtaPackageInstaller native module is not available');
    }

    await downloadToTempFile({
      url,
      token,
      tempPath: OTA_PACKAGE_TMP_PATH,
      onProgress,
    });
    await replaceFile(OTA_PACKAGE_TMP_PATH, OTA_PACKAGE_PATH);

    await OtaPackageInstaller.install(OTA_PACKAGE_PATH);
    if (assetId) {
      await AsyncStorage.setItem(LAST_BUNDLE_ASSET_ID_KEY, assetId);
    }
    await safeDeletePath(LEGACY_BUNDLE_PATH);
    await safeDeletePath(OTA_PACKAGE_PATH);
    onComplete?.('js');
    setTimeout(() => restartApp(), 1000);
  } catch (error) {
    // Never leave a half written package or bundle behind — the app boots from these.
    await safeDeletePath(OTA_PACKAGE_TMP_PATH);
    await safeDeletePath(OTA_PACKAGE_PATH);
    logError(ERROR_CATEGORY.OtaUpdate, error, { step: 'downloadOtaPackage' });
    onError?.(error);
  }
};

const downloadLegacyBundle = async (
  url,
  assetId,
  token,
  onProgress,
  onComplete,
  onError,
) => {
  try {
    await safeDeletePath(OTA_PACKAGE_PATH);

    // Download to a temp path, then swap it in. Writing straight to
    // LEGACY_BUNDLE_PATH leaves a truncated bundle there if the download
    // breaks, and the app boots from that file on the next launch.
    await downloadToTempFile({
      url,
      token,
      tempPath: LEGACY_BUNDLE_TMP_PATH,
      onProgress,
    });
    await replaceFile(LEGACY_BUNDLE_TMP_PATH, LEGACY_BUNDLE_PATH);

    if (assetId) {
      await AsyncStorage.setItem(LAST_BUNDLE_ASSET_ID_KEY, assetId);
    }
    onComplete?.('js');
    setTimeout(() => restartApp(), 1000);
  } catch (error) {
    await safeDeletePath(LEGACY_BUNDLE_TMP_PATH);
    await safeDeletePath(LEGACY_BUNDLE_PATH);
    logError(ERROR_CATEGORY.OtaUpdate, error, { step: 'downloadLegacyBundle' });
    onError?.(error);
  }
};
