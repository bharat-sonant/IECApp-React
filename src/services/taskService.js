import {getData, updateData, initializeFirebaseApp} from '../firebase/firebaseService';
import {CITY, FIREBASE_CONFIG} from '../firebase/firebaseConfig';
import {loadLoginSession} from './sessionService';
import {buildPendingMediaPath, enqueuePendingMediaUpload, flushPendingMediaUploads} from './pendingUploadService';

const asString = value => (value === null || value === undefined ? '' : String(value).trim());
const STATIC_LOCATION = {
  latitude: 0,
  longitude: 0,
  address: 'Location not captured',
};
const getSessionUserId = session =>
  asString(session?.loginId || session?.employee?.userId || session?.employee?.id || session?.employee?.loginId);

const getSessionCity = session =>
  asString(session?.city || session?.employee?.city || session?.employee?.City || session?.selectedCity);

const getCurrentDateParts = () => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = now.toLocaleString('en-US', {month: 'long'});
  const currentDate = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentDateTime = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(
    now.getHours(),
  ).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return {year, month, currentDate, currentDateTime};
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

const buildOldTaskPayload = ({remark, ward, participants, taskChoice, currentDateTime, latitude, longitude, address, mode}) => {
  const priority = asString(taskChoice?.priority || taskChoice?.type || '').toLowerCase();
  const sourcePath = asString(taskChoice?.sourcePath || taskChoice?.originalPath || taskChoice?.raw?.originalPath);
  const sourceLabel = asString(taskChoice?.sourceLabel || taskChoice?.taskCategory || '').toLowerCase();
  const isPriorityTask =
    sourcePath.includes('IECPriorityTasks') ||
    sourceLabel === 'priority' ||
    priority === 'high' ||
    asString(taskChoice?.taskPriority || taskChoice?.TaskPriority).toLowerCase() === 'high';
  const isOtherTask = mode === 'add_other' || sourceLabel === 'other' || sourceLabel === 'self';
  const taskCategory = isOtherTask ? 'Other' : isPriorityTask ? 'Priority' : 'KPI';
  const taskTypeValue = isOtherTask ? 'low' : isPriorityTask ? 'high' : 'medium';
  const payload = {
    _at: currentDateTime,
    latLng: latitude && longitude ? `${latitude},${longitude}` : '',
    address: asString(address),
    type: taskTypeValue,
    title: asString(taskChoice?.title || taskChoice?.taskName || ''),
    remark: asString(remark),
    wardNo: asString(ward),
    noOfParticipants: asString(participants),
    taskCategory,
  };

  return payload;
};

const deriveTaskStorageKey = ({selectedTask, taskSourcePath}) => {
  const taskType = asString(selectedTask?.priority || selectedTask?.type || '').toLowerCase();
  const sourcePath = asString(taskSourcePath);

  if (sourcePath.includes('IECPriorityTasks')) {
    const segments = sourcePath.split('/').filter(Boolean);
    const priorityIndex = segments.lastIndexOf('IECPriorityTasks');
    const parentKey = priorityIndex >= 0 ? segments[priorityIndex + 3] : '';
    return parentKey || asString(selectedTask?.resolvedWardNo || selectedTask?.taskId || selectedTask?.id).split('/')[0];
  }

  if (taskType === 'high') {
    return asString(selectedTask?.resolvedWardNo || selectedTask?.taskId || selectedTask?.id).split('/')[0];
  }

  return asString(selectedTask?.id || selectedTask?.taskId || selectedTask?.key || selectedTask?.title);
};

const getNextNumericChildKey = node => {
  if (!node || typeof node !== 'object') {
    return 1;
  }

  const validKeys = Object.keys(node).filter(key => node[key] !== null && node[key] !== undefined);

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

  const nextNode = {...node};
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

  const taskChoice = selectedTask ? {...selectedTask} : selectedTask;
  if (taskChoice) {
    delete taskChoice.originalPath;
    delete taskChoice.raw;
  }
  const taskSourcePath = asString(selectedTask?.sourcePath || selectedTask?.originalPath || selectedTask?.raw?.originalPath);
  const taskChoiceDebug = {
    mode,
    selectedTaskId: selectedTask?.id || '',
    selectedTaskKey: selectedTask?.key || '',
    selectedTaskTaskId: selectedTask?.taskId || '',
    selectedTaskTitle: selectedTask?.title || '',
    selectedTaskPriority: selectedTask?.priority || '',
    selectedTaskType: selectedTask?.type || '',
    selectedTaskWardNo: selectedTask?.resolvedWardNo || selectedTask?.wardNo || '',
    selectedTaskSourceLabel: selectedTask?.sourceLabel || '',
    selectedTaskSourcePath: taskSourcePath,
    taskChoiceTitle: taskChoice?.title || '',
    taskChoiceTaskName: taskChoice?.taskName || '',
    taskChoiceTaskCategory: taskChoice?.taskCategory || '',
    taskChoicePriority: taskChoice?.priority || '',
    taskChoiceType: taskChoice?.type || '',
    taskChoiceTaskId: taskChoice?.taskId || '',
    taskChoiceId: taskChoice?.id || '',
    taskChoiceKey: taskChoice?.key || '',
  };
  const city = getSessionCity(session);
  const cityName = asString(CITY?.cityName || city);
  const {year, month, currentDate, currentDateTime} = getCurrentDateParts();
  const taskKey = deriveTaskStorageKey({selectedTask, taskSourcePath});
  const taskPriority = asString(selectedTask?.priority || selectedTask?.type || '').toLowerCase();
  const dateRootPath = `IECData/IECTasks/${userId}/${year}/${month}/${currentDate}`;
  const taskRootPath = `${dateRootPath}/${taskKey}`;
  const existingTaskNode = await getData(taskRootPath);
  const existingTaskKeys =
    existingTaskNode && typeof existingTaskNode === 'object'
      ? Object.keys(existingTaskNode).filter(key => key !== 'lastKey' && existingTaskNode[key] !== null && existingTaskNode[key] !== undefined)
      : [];

  const debugLine = [
    `mode=${mode}`,
    `userId=${userId}`,
    `selectedTaskId=${taskChoiceDebug.selectedTaskId}`,
    `selectedTaskKey=${taskChoiceDebug.selectedTaskKey}`,
    `selectedTaskTaskId=${taskChoiceDebug.selectedTaskTaskId}`,
    `title=${taskChoiceDebug.selectedTaskTitle}`,
    `priority=${taskChoiceDebug.selectedTaskPriority}`,
    `type=${taskChoiceDebug.selectedTaskType}`,
    `sourceLabel=${taskChoiceDebug.selectedTaskSourceLabel}`,
    `sourcePath=${taskChoiceDebug.selectedTaskSourcePath}`,
    `taskKey=${taskKey}`,
    `taskRootPath=${taskRootPath}`,
    `existingKeys=${JSON.stringify(
      existingTaskKeys,
    )}`,
  ].join(' | ');



  const normalizedImages = normalizeMediaList(images);
  const normalizedVideos = normalizeMediaList(videos);
  let nextTaskCount = 1;
  let finalTaskPath = `${taskRootPath}/${nextTaskCount}`;
  const mediaTaskKey = taskKey;
  const mediaTaskCount = () => nextTaskCount;

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

  normalizedImages.forEach((_, index) => {
    payload[`image${index + 1}`] = `image${index + 1}.jpg`;
  });
  normalizedVideos.forEach((_, index) => {
    payload[`video${index + 1}`] = `video${index + 1}.mp4`;
  });

  const {getDatabase, ref} = require('@react-native-firebase/database');
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
    key => key !== 'lastKey' && finalBucket[key] !== null && finalBucket[key] !== undefined
  );
  const diffKey = finalKeys.find(key => !existingTaskKeys.includes(key));
  
  if (diffKey && Number.isFinite(Number.parseInt(diffKey, 10))) {
    nextTaskCount = Number.parseInt(diffKey, 10);
  } else {
    // Fallback safely to max numeric key
    const maxKey = finalKeys.reduce((max, k) => Math.max(max, Number.parseInt(k, 10) || 0), 0);
    nextTaskCount = maxKey > 0 ? maxKey : 1;
  }
  
  finalTaskPath = `${taskRootPath}/${nextTaskCount}`;

  console.log('[taskService] save path resolved:', {
    taskRootPath,
    taskLeafPath: finalTaskPath,
    nextTaskCount,
    taskPriority,
  });

  console.log('[taskService] task saved:', {
    path: finalTaskPath,
    payloadKeys: Object.keys(payload),
    payload,
  });

  if (taskSourcePath) {
    if (taskSourcePath.includes('IECPriorityTasks')) {
      try {
        await updateData(taskSourcePath, {
          status: '1',
        });
      } catch (e) {
        console.log('[taskService] Failed to safely update Priority Task node', e);
      }
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

  for (const image of normalizedImages) {
    const imageFileName = `image${image.index}.jpg`;
    const imageStoragePath = buildPendingMediaPath({
      userId,
      cityName,
      year,
      month,
      currentDate,
      taskKey: mediaTaskKey,
      taskCount: mediaTaskCount(),
      fileName: imageFileName,
    });
    console.log('[taskService] image queued for background upload:', {
      imageIndex: image.index,
      sourceUri: image.uri,
      imageStoragePath,
    });

    await enqueuePendingMediaUpload({
      localPath: image.uri,
      storagePath: imageStoragePath,
      contentType: 'image/jpeg',
    });
  }

  for (const video of normalizedVideos) {
    const videoFileName = `video${video.index}.mp4`;
    const videoStoragePath = `${cityName ? `${cityName}/` : ''}IECData/IECTasksVideos/${userId}/${year}/${month}/${currentDate}/${mediaTaskKey}/${mediaTaskCount()}/${videoFileName}`;
    console.log('[taskService] video queued for background upload:', {
      videoIndex: video.index,
      sourceUri: video.uri,
      thumbnailUri: video.thumbnailUri || '',
      videoStoragePath,
    });

    await enqueuePendingMediaUpload({
      localPath: video.uri,
      storagePath: videoStoragePath,
      contentType: 'video/mp4',
    });
  }

  flushPendingMediaUploads().catch(error => {
    console.log('[taskService] background flush failed:', error?.message || error);
  });

  return {
    ok: true,
  };
};
