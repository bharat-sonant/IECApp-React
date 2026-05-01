import {
  getData,
  updateData,
  initializeFirebaseApp,
} from '../firebase/firebaseService';
import { CITY, FIREBASE_CONFIG } from '../firebase/firebaseConfig';
import { loadLoginSession } from './sessionService';
import {
  buildPendingMediaPath,
  enqueuePendingMediaUpload,
  flushPendingMediaUploads,
} from './pendingUploadService';
import { getUserCurrentLocation } from './locationTrackingService';

const asString = value =>
  value === null || value === undefined ? '' : String(value).trim();
const STATIC_LOCATION = {
  latitude: 0,
  longitude: 0,
  address: 'Location not captured',
};
const isValidCoordinate = value => {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0;
};

const isValidLocation = location =>
  isValidCoordinate(location?.latitude) &&
  isValidCoordinate(location?.longitude) &&
  asString(location?.address).length > 0;

const formatLocationPair = location =>
  `${Number(location?.latitude)},${Number(location?.longitude)}`;

const includesToken = (value, token) =>
  asString(value).toLowerCase().includes(token);
const getSessionUserId = session =>
  asString(
    session?.loginId ||
      session?.employee?.userId ||
      session?.employee?.id ||
      session?.employee?.loginId,
  );

const getSessionCity = session =>
  asString(
    session?.city ||
      session?.employee?.city ||
      session?.employee?.City ||
      session?.selectedCity,
  );

const getCurrentDateParts = () => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = now.toLocaleString('en-US', { month: 'long' });
  const currentDate = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentDateTime = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(
    now.getHours(),
  ).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return { year, month, currentDate, currentDateTime };
};

const normalizeMediaList = mediaList =>
  (Array.isArray(mediaList) ? mediaList : [])
    .map((item, index) => {
      if (!item) {
        return null;
      }

      const uri = typeof item === 'string' ? item : asString(item.uri);
      if (!uri) {
        return null;
      }

      return {
        uri,
        thumbnailUri: asString(item?.thumbnailUri),
        index: index + 1,
      };
    })
    .filter(Boolean);

const buildOldTaskPayload = ({
  remark,
  ward,
  participants,
  taskChoice,
  currentDateTime,
  latitude,
  longitude,
  address,
  mode,
}) => {
  const priority = asString(
    taskChoice?.priority || taskChoice?.type || '',
  ).toLowerCase();
  const sourcePath = asString(
    taskChoice?.sourcePath ||
      taskChoice?.originalPath ||
      taskChoice?.raw?.originalPath,
  );
  const sourceLabel = asString(
    taskChoice?.sourceLabel || taskChoice?.taskCategory || '',
  ).toLowerCase();
  const explicitCategory = asString(
    taskChoice?.taskCategory || taskChoice?.TaskCategory,
  ).toLowerCase();
  const isPriorityTask =
    sourcePath.includes('IECPriorityTasks') ||
    includesToken(explicitCategory, 'priority') ||
    includesToken(sourceLabel, 'priority') ||
    priority === 'high' ||
    asString(
      taskChoice?.taskPriority || taskChoice?.TaskPriority,
    ).toLowerCase() === 'high' ||
    includesToken(taskChoice?.type || taskChoice?.Type, 'priority');
  const isOtherTask =
    includesToken(explicitCategory, 'other') ||
    includesToken(explicitCategory, 'self') ||
    includesToken(sourceLabel, 'other') ||
    includesToken(sourceLabel, 'self') ||
    sourcePath.includes('IECData/Tasks');
  const taskCategory = isPriorityTask
    ? 'Priority'
    : isOtherTask
      ? 'Other'
      : mode === 'add_other'
        ? 'Other'
        : 'KPI';
  const taskTypeValue = isPriorityTask
    ? 'high'
    : isOtherTask
      ? 'low'
      : 'medium';
  const payload = {
    _at: currentDateTime,
    latLng: isValidCoordinate(latitude) && isValidCoordinate(longitude)
      ? formatLocationPair({ latitude, longitude })
      : '',
    address: asString(address),
    type: taskTypeValue,
    remark: asString(remark),
    wardNo: asString(ward),
    noOfParticipants: asString(participants),
    taskCategory,
    status: '1',
  };

  return payload;
};

const deriveTaskStorageKey = ({ selectedTask, taskSourcePath }) => {
  const taskType = asString(
    selectedTask?.priority || selectedTask?.type || '',
  ).toLowerCase();
  const sourcePath = asString(taskSourcePath);

  if (sourcePath.includes('IECPriorityTasks')) {
    const segments = sourcePath.split('/').filter(Boolean);
    const priorityIndex = segments.lastIndexOf('IECPriorityTasks');
    const parentKey = priorityIndex >= 0 ? segments[priorityIndex + 3] : '';
    return (
      parentKey ||
      asString(
        selectedTask?.resolvedWardNo ||
          selectedTask?.taskId ||
          selectedTask?.id,
      ).split('/')[0]
    );
  }

  if (taskType === 'high') {
    return asString(
      selectedTask?.resolvedWardNo || selectedTask?.taskId || selectedTask?.id,
    ).split('/')[0];
  }

  return asString(
    selectedTask?.id ||
      selectedTask?.taskId ||
      selectedTask?.key ||
      selectedTask?.title,
  );
};

const getNextNumericChildKey = node => {
  if (!node || typeof node !== 'object') {
    return 1;
  }

  const validKeys = Object.keys(node).filter(
    key => node[key] !== null && node[key] !== undefined,
  );

  const numericMax = validKeys.reduce((max, key) => {
    if (key === 'lastKey') {
      return max;
    }

    const numeric = Number.parseInt(key, 10);
    return Number.isFinite(numeric) && numeric > max ? numeric : max;
  }, 0);

  if (numericMax > 0) {
    return numericMax + 1;
  }

  const hasAnyMeaningfulValue = validKeys.some(key => key !== 'lastKey');
  return hasAnyMeaningfulValue ? 2 : 1;
};

const sanitizeTaskBucket = node => {
  if (!node || typeof node !== 'object') {
    return {};
  }

  if (Array.isArray(node)) {
    const nextNode = {};
    node.forEach((item, index) => {
      if (item !== null && item !== undefined) {
        nextNode[String(index)] = item;
      }
    });
    return nextNode;
  }

  const nextNode = { ...node };
  delete nextNode.lastKey;
  return nextNode;
};

export const saveTaskSubmission = async ({
  mode,
  selectedTask,
  ward,
  participants,
  remark,
  images,
  videos,
  location,
}) => {
  const session = await loadLoginSession();
  const userId = getSessionUserId(session);

  if (!userId) {
    throw new Error('Missing logged in user.');
  }

  if (!selectedTask?.title) {
    throw new Error('Task is required.');
  }

  const taskChoice = selectedTask ? { ...selectedTask } : selectedTask;
  if (taskChoice) {
    delete taskChoice.originalPath;
    delete taskChoice.raw;
  }
  const taskSourcePath = asString(
    selectedTask?.sourcePath ||
      selectedTask?.originalPath ||
      selectedTask?.raw?.originalPath,
  );
  const city = getSessionCity(session);
  const cityName = asString(CITY?.cityName || city);
  const { year, month, currentDate, currentDateTime } = getCurrentDateParts();
  const taskKey = deriveTaskStorageKey({ selectedTask, taskSourcePath });
  const taskPriority = asString(
    selectedTask?.priority || selectedTask?.type || '',
  ).toLowerCase();
  const dateRootPath = `IECData/IECTasks/${userId}/${year}/${month}/${currentDate}`;
  const taskRootPath = `${dateRootPath}/${taskKey}`;
  const existingTaskNode = await getData(taskRootPath);
  const existingTaskKeys =
    existingTaskNode && typeof existingTaskNode === 'object'
      ? Object.keys(existingTaskNode).filter(
          key =>
            key !== 'lastKey' &&
            existingTaskNode[key] !== null &&
            existingTaskNode[key] !== undefined,
        )
      : [];

  const normalizedImages = normalizeMediaList(images);
  const normalizedVideos = normalizeMediaList(videos);
  let nextTaskCount = 1;

  const payload = buildOldTaskPayload({
    remark,
    ward,
    participants,
    taskChoice,
    currentDateTime,
    latitude: location?.latitude ?? STATIC_LOCATION.latitude,
    longitude: location?.longitude ?? STATIC_LOCATION.longitude,
    address: location?.address ?? STATIC_LOCATION.address,
    mode,
  });

  // If no valid location provided, try to fetch from tracking service
  if (!isValidLocation(location)) {
    try {
      const locResult = await getUserCurrentLocation();
      if (
        locResult.success &&
        locResult.location?.latitude &&
        locResult.location?.longitude
      ) {
        payload.latLng = formatLocationPair(locResult.location);
        payload.address = locResult.location?.address || payload.address || STATIC_LOCATION.address;
      }
    } catch (e) {
    }
  }

  const finalLocation = {
    latitude: payload.latLng ? Number(String(payload.latLng).split(',')[0]) : 0,
    longitude: payload.latLng ? Number(String(payload.latLng).split(',')[1]) : 0,
    address: payload.address,
  };

  if (!isValidLocation(finalLocation)) {
    throw new Error(
      'Location capture failed. Please enable GPS and try again before submitting.',
    );
  }

  // Save ONLY filename to DB (path will be constructed when reading)
  normalizedImages.forEach((_, index) => {
    payload[`image${index + 1}`] = `image${index + 1}.jpg`;
  });
  normalizedVideos.forEach((_, index) => {
    payload[`video${index + 1}`] = `video${index + 1}.mp4`;
  });


  const { getDatabase, ref } = require('@react-native-firebase/database');
  const app = await initializeFirebaseApp();
  const db = getDatabase(app, FIREBASE_CONFIG?.databaseURL);
  const taskBucketRef = ref(db, taskRootPath);

  const transactionResult = await taskBucketRef.transaction(current => {
    const currentBucket = sanitizeTaskBucket(current);
    const nextCount = getNextNumericChildKey(currentBucket);
    return {
      ...currentBucket,
      [String(nextCount)]: payload,
    };
  });

  const finalBucket = transactionResult?.snapshot?.val?.() || {};
  const finalKeys = Object.keys(finalBucket).filter(
    key =>
      key !== 'lastKey' &&
      finalBucket[key] !== null &&
      finalBucket[key] !== undefined,
  );
  const diffKey = finalKeys.find(key => !existingTaskKeys.includes(key));

  if (diffKey && Number.isFinite(Number.parseInt(diffKey, 10))) {
    nextTaskCount = Number.parseInt(diffKey, 10);
  } else {
    // Fallback safely to max numeric key
    const maxKey = finalKeys.reduce(
      (max, k) => Math.max(max, Number.parseInt(k, 10) || 0),
      0,
    );
    nextTaskCount = maxKey > 0 ? maxKey : 1;
  }

  if (taskSourcePath) {
    if (taskSourcePath.includes('IECPriorityTasks')) {
      try {
        await updateData(taskSourcePath, {
          status: '1',
        });
      } catch (e) {}
    }
  } else if (taskPriority === 'high') {
    // Legacy fallback incase originalPath is missing
    const priorityPath = `IECData/IECPriorityTasks/${userId}/${currentDate}/${taskKey}`;
    await updateData(priorityPath, {
      status: '1',
      task: selectedTask?.title || '',
      desc: selectedTask?.description || '',
    });
  }

  // Build full storage paths for upload queue only AFTER transaction provides correct nextTaskCount
  const imageStoragePaths = normalizedImages.map((image, index) => {
    const imageFileName = `image${index + 1}.jpg`;
    return buildPendingMediaPath({
      userId,
      cityName,
      year,
      month,
      currentDate,
      taskKey: `${taskKey}/${nextTaskCount}`,
      fileName: imageFileName,
    });
  });

  const videoStoragePaths = normalizedVideos.map((video, index) => {
    const videoFileName = `video${index + 1}.mp4`;
    return `${cityName ? `${cityName}/` : ''}IECData/IECTasksVideos/${userId}/${year}/${month}/${currentDate}/${taskKey}/${nextTaskCount}/${videoFileName}`;
  });

  await Promise.all(
    normalizedImages.map(async (image, index) => {
      await enqueuePendingMediaUpload({
        localPath: image.uri,
        storagePath: imageStoragePaths[index],
        contentType: 'image/jpeg',
      });
    }),
  );

  await Promise.all(
    normalizedVideos.map(async (video, index) => {
      await enqueuePendingMediaUpload({
        localPath: video.uri,
        storagePath: videoStoragePaths[index],
        contentType: 'video/mp4',
      });
    }),
  );

  flushPendingMediaUploads().catch(error => {});

  return {
    ok: true,
  };
};
