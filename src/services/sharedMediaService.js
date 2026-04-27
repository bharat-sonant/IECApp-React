import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SHARED_MEDIA_DIR = `${RNFS.DocumentDirectoryPath}/shared_images`;
const SHARED_MEDIA_CLEANUP_KEY = 'shared_media_last_cleanup_date';

const getLocalDayKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getSharedMediaDir = () => SHARED_MEDIA_DIR;

export const clearSharedMediaFiles = async () => {
  try {
    const exists = await RNFS.exists(SHARED_MEDIA_DIR);
    if (!exists) {
      return;
    }

    const files = await RNFS.readDir(SHARED_MEDIA_DIR);
    for (const file of files) {
      await RNFS.unlink(file.path);
    }
  } catch (error) {
  }
};

export const ensureSharedMediaCleanup = async ({ force = false } = {}) => {
  try {
    const today = getLocalDayKey();
    const lastCleanup = await AsyncStorage.getItem(SHARED_MEDIA_CLEANUP_KEY);

    if (!force && lastCleanup === today) {
      return;
    }

    await clearSharedMediaFiles();
    await AsyncStorage.setItem(SHARED_MEDIA_CLEANUP_KEY, today);
  } catch (error) {
  }
};
