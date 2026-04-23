import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import { BackHandler, NativeModules, Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { getData } from '../firebase/dbServices';
import {
  ENABLE_JS_BUNDLE_OTA,
  OTA_DB_PATH,
  OTA_GITHUB_TOKEN,
  OTA_RELEASES_URL,
} from '../constants/appVersion';

const restartApp = () => {
  BackHandler.exitApp();
};

const REPO_URL = OTA_RELEASES_URL;
const LEGACY_BUNDLE_PATH = `${RNFS.DocumentDirectoryPath}/index.android.bundle`;
const OTA_PACKAGE_PATH = `${RNFS.DocumentDirectoryPath}/ota-package.zip`;
const LAST_BUNDLE_ASSET_ID_KEY = 'LAST_BUNDLE_ASSET_ID';

const { OtaPackageInstaller } = NativeModules;

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
      const hasNativeVersionMismatch =
        !dbVersion ||
        !installedAppVersion ||
        dbVersion !== normalizedLatestVersion ||
        installedAppVersion !== dbVersion ||
        installedAppVersion !== normalizedLatestVersion;

      if (hasNativeVersionMismatch) {
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
    await safeDeletePath(OTA_PACKAGE_PATH);

    const downloadOptions = {
      fromUrl: url,
      headers: getAuthHeaders(token),
      toFile: OTA_PACKAGE_PATH,
      background: true,
      progress: res => {
        const percentage = (
          (res.bytesWritten / res.contentLength) *
          100
        ).toFixed(0);
        onProgress?.(parseInt(percentage, 10));
      },
    };

    const result = await RNFS.downloadFile(downloadOptions).promise;

    if (result.statusCode === 200) {
      if (!OtaPackageInstaller?.install) {
        throw new Error('OtaPackageInstaller native module is not available');
      }
      await OtaPackageInstaller.install(OTA_PACKAGE_PATH);
      if (assetId) {
        await AsyncStorage.setItem(LAST_BUNDLE_ASSET_ID_KEY, assetId);
      }
      await safeDeletePath(LEGACY_BUNDLE_PATH);
      await safeDeletePath(OTA_PACKAGE_PATH);
      onComplete?.('js');
      setTimeout(() => restartApp(), 1000);
    } else {
      throw new Error(`Download failed with status ${result.statusCode}`);
    }
  } catch (error) {
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

    const downloadOptions = {
      fromUrl: url,
      headers: getAuthHeaders(token),
      toFile: LEGACY_BUNDLE_PATH,
      background: true,
      progress: res => {
        const percentage = (
          (res.bytesWritten / res.contentLength) *
          100
        ).toFixed(0);
        onProgress?.(parseInt(percentage, 10));
      },
    };

    const result = await RNFS.downloadFile(downloadOptions).promise;

    if (result.statusCode === 200) {
      if (assetId) {
        await AsyncStorage.setItem(LAST_BUNDLE_ASSET_ID_KEY, assetId);
      }
      onComplete?.('js');
      setTimeout(() => restartApp(), 1000);
    } else {
      throw new Error(`Download failed with status ${result.statusCode}`);
    }
  } catch (error) {
    onError?.(error);
  }
};
