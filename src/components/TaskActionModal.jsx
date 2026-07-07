import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Image,
  StatusBar,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  Video as VideoCompressor,
  createVideoThumbnail,
} from 'react-native-compressor';
import TaskDetailModal from './TaskDetailModal';
import CommonLoader from './CommonLoader';
import RNFS from 'react-native-fs';
import appTheme from '../theme/appTheme';
import ReusableCamera from './ReusableCamera';
import { useAppFeedback } from './AppFeedback';
import { getData } from '../firebase/firebaseService';
import { loadLoginSession } from '../services/sessionService';
import { saveTaskSubmission } from '../services/taskService';
import { beginAppStateSuppression } from '../services/appStateGuard';
import { getTaskCatalog, clearTaskCache } from '../services/taskCacheService';

const inlineToastStyles = {
  warning: {
    label: 'Warning',
    icon: 'alert-outline',
    accentColor: appTheme.colors.status.warning,
    iconBg: 'rgba(199, 125, 0, 0.12)',
    surfaceBg: appTheme.colors.neutral.surface,
    labelText: appTheme.colors.neutral.text,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
  error: {
    label: 'Error',
    icon: 'alert-circle-outline',
    accentColor: appTheme.colors.status.danger,
    iconBg: 'rgba(180, 35, 24, 0.12)',
    surfaceBg: appTheme.colors.neutral.surface,
    labelText: appTheme.colors.neutral.text,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
  success: {
    label: 'Success',
    icon: 'check-circle-outline',
    accentColor: appTheme.colors.status.success,
    iconBg: 'rgba(22, 122, 69, 0.12)',
    surfaceBg: appTheme.colors.neutral.surface,
    labelText: appTheme.colors.neutral.text,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
  info: {
    label: 'Info',
    icon: 'information-outline',
    accentColor: appTheme.colors.brand.primaryDark,
    iconBg: 'rgba(18, 59, 74, 0.12)',
    surfaceBg: appTheme.colors.neutral.surface,
    labelText: appTheme.colors.neutral.text,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
};

const MAX_IMAGES = 10;
const TARGET_VIDEO_MAX_BYTES = 15 * 1024 * 1024;
// Reduced manual fallback steps (only used if 'auto' mode fails)
const VIDEO_COMPRESSION_STEPS = [540, 360, 240];
const MAX_UPLOADABLE_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;

const getFileSizeBytes = async uri => {
  const path = String(uri || '').replace(/^file:\/\//, '');
  if (!path) {
    return 0;
  }

  try {
    const stats = await RNFS.stat(path);
    return Number(stats?.size || 0);
  } catch (error) {
    return 0;
  }
};

const getVideoSourceInfo = source => {
  const fileSizeBytes = Number(source?.fileSize || source?.sizeBytes || 0);
  const durationSeconds = Number(source?.duration || 0);
  const width = Number(source?.width || 0);
  const height = Number(source?.height || 0);

  return {
    fileSizeBytes: Number.isFinite(fileSizeBytes) ? fileSizeBytes : 0,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
};

const withTimeout = (promise, ms, label = 'Operation') =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]);

const compressionAttempts = (sourceInfo) => {
  const { fileSizeBytes, durationSeconds } = getVideoSourceInfo(sourceInfo);

  // 100MB+ ya 45 second se lambi file ke liye aggressive compression mode
  const isVeryLarge = fileSizeBytes > 100 * 1024 * 1024 || durationSeconds > 45;

  // Lower starting bitrate so first attempt already produces small file
  const attempts = VIDEO_COMPRESSION_STEPS.map((maxSize, index) => ({
    maxSize, // Video width/height scaling
    bitrate: isVeryLarge
      ? Math.max(100000, 350000 - index * 80000)
      : Math.max(150000, 450000 - index * 100000),
  }));

  return attempts;
};

const buildVideoTooLargeMessage = sizeBytes => {
  const sizeMB = (Number(sizeBytes || 0) / 1048576).toFixed(2);
  const maxMB = (MAX_UPLOADABLE_VIDEO_SIZE_BYTES / 1048576).toFixed(0);

  return (
    `यह वीडियो ${sizeMB} MB का है, जो अपलोड सीमा से बड़ा है। ` +
    `कृपया ${maxMB} MB से छोटा वीडियो अपलोड करें ताकि उसे सुरक्षित रूप से compress करके submit किया जा सके।`
  );
};
const compressVideoForUpload = async (videoUri, sourceInfo = {}, cancelRef = null) => {
  try {
    let safeUri = videoUri;
    const sourceDetails = getVideoSourceInfo(sourceInfo);

    if (!safeUri) {
      throw new Error('चुने गए वीडियो का file path नहीं मिला।');
    }

    if (videoUri.startsWith('content://')) {
      try {
        const stat = await RNFS.stat(videoUri);
        safeUri = stat.path;
      } catch (e) {
      }
    }

    const originalSizeBytes =
      sourceDetails.fileSizeBytes || (await getFileSizeBytes(safeUri));

    if (originalSizeBytes > MAX_UPLOADABLE_VIDEO_SIZE_BYTES) {
      const message = buildVideoTooLargeMessage(originalSizeBytes);
      throw new Error(message);
    }

    if (originalSizeBytes > 0 && originalSizeBytes <= TARGET_VIDEO_MAX_BYTES) {
      return {
        uri: safeUri,
        sizeBytes: originalSizeBytes,
        wasCompressed: false,
        method: 'Original',
      };
    }

    const checkCancelled = () => {
      if (cancelRef && cancelRef.current === true) {
        throw new Error('CANCELLED');
      }
    };

    // 1) Try AUTO mode first — fastest, library picks optimal settings
    try {
      checkCancelled();
      const autoUri = await withTimeout(
        VideoCompressor.compress(safeUri, {
          compressionMethod: 'auto',
          minimumFileSizeForCompress: 0,
          getCancellationId: id => {
            if (cancelRef) {
              cancelRef.activeId = id;
            }
          },
        }),
        30000,
        'Auto compression',
      );

      if (autoUri) {
        const autoSize = await getFileSizeBytes(autoUri);
        const autoOk =
          autoSize > 0 &&
          autoUri !== safeUri &&
          autoSize <= TARGET_VIDEO_MAX_BYTES;

        if (autoOk) {
          return {
            uri: autoUri,
            sizeBytes: autoSize,
            wasCompressed: true,
            method: 'Auto',
          };
        }
      }
    } catch (e) {
      if (e?.message === 'CANCELLED') {
        throw e;
      }
      // Auto failed or timed out — fall through to manual fallback
    }

    // 2) Manual fallback — only if auto didn't produce a small enough file
    const attempts = compressionAttempts(sourceDetails);
    let lastError = null;

    for (const attempt of attempts) {
      try {
        checkCancelled();
        const compressedUri = await withTimeout(
          VideoCompressor.compress(safeUri, {
            compressionMethod: 'manual',
            maxSize: attempt.maxSize,
            bitrate: attempt.bitrate,
            minimumFileSizeForCompress: 0,
            getCancellationId: id => {
              if (cancelRef) {
                cancelRef.activeId = id;
              }
            },
          }),
          60000,
          `Manual compression ${attempt.maxSize}p`,
        );

        if (!compressedUri) {
          throw new Error('Compression ने कोई file return नहीं की।');
        }

        const finalSizeBytes = await getFileSizeBytes(compressedUri);
        const didShrink =
          compressedUri !== safeUri &&
          finalSizeBytes > 0 &&
          (originalSizeBytes === 0 || finalSizeBytes < originalSizeBytes);

        if (!didShrink) {
          throw new Error('Compression के बाद file size कम नहीं हुई।');
        }

        // Accept first successful shrink — don't keep trying smaller sizes
        return {
          uri: compressedUri,
          sizeBytes: finalSizeBytes,
          wasCompressed: true,
          method: `Manual-${attempt.maxSize}`,
        };
      } catch (error) {
        if (error?.message === 'CANCELLED') {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError || new Error('Compression से छोटी file नहीं बन सकी।');
  } catch (error) {
    throw error;
  }
};

const normalizeTaskStateValue = value =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const hasTruthyTaskState = value =>
  normalizeTaskStateValue(value) === '1' ||
  normalizeTaskStateValue(value) === 'true' ||
  normalizeTaskStateValue(value) === 'yes' ||
  normalizeTaskStateValue(value) === 'active' ||
  normalizeTaskStateValue(value) === 'enabled' ||
  normalizeTaskStateValue(value) === 'visible' ||
  normalizeTaskStateValue(value) === 'open';

const hasFalsyTaskState = value =>
  normalizeTaskStateValue(value) === '0' ||
  normalizeTaskStateValue(value) === 'false' ||
  normalizeTaskStateValue(value) === 'no' ||
  normalizeTaskStateValue(value) === 'inactive' ||
  normalizeTaskStateValue(value) === 'disabled' ||
  normalizeTaskStateValue(value) === 'hidden' ||
  normalizeTaskStateValue(value) === 'deleted' ||
  normalizeTaskStateValue(value) === 'closed';

const isVisibleTaskRecord = task => {
  if (!task || typeof task !== 'object') {
    return true;
  }

  const sources = [task, task.raw, task.catalogTask, task.raw?.catalogTask].filter(
    source => source && typeof source === 'object',
  );

  const deleteState = sources
    .flatMap(source => [
      source.isDeleted,
      source.IsDeleted,
      source.isDelete,
      source.IsDelete,
      source.deleted,
      source.Deleted,
      source.deletedFlag,
      source.DeletedFlag,
      source.removeFlag,
      source.RemoveFlag,
      source.removed,
      source.Removed,
    ])
    .map(normalizeTaskStateValue)
    .find(Boolean);

  if (deleteState && hasTruthyTaskState(deleteState)) {
    return false;
  }

  const statusState = sources
    .flatMap(source => [
      source.state,
      source.State,
      source.status,
      source.Status,
      source.taskStatus,
      source.TaskStatus,
      source.recordStatus,
      source.RecordStatus,
      source.active,
      source.Active,
      source.isActive,
      source.IsActive,
      source.enabled,
      source.Enabled,
      source.visible,
      source.Visible,
    ])
    .map(normalizeTaskStateValue)
    .find(Boolean);

  if (!statusState) {
    return true;
  }

  if (hasTruthyTaskState(statusState)) {
    return true;
  }

  return !hasFalsyTaskState(statusState);
};

const resolveCatalogTaskRecord = (catalog, taskId) => {
  const targetTaskId = normalizeTaskStateValue(taskId);
  if (!targetTaskId || !catalog || typeof catalog !== 'object') {
    return null;
  }

  const seen = new Set();
  const walk = node => {
    if (!node || typeof node !== 'object' || seen.has(node)) {
      return null;
    }

    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) {
          return found;
        }
      }
      return null;
    }

    for (const [key, value] of Object.entries(node)) {
      if (normalizeTaskStateValue(key) === targetTaskId) {
        return value && typeof value === 'object' ? value : node;
      }
    }

    const candidateIds = [
      node.taskId,
      node.TaskId,
      node.taskID,
      node.TaskID,
      node.id,
      node.Id,
      node.key,
      node.Key,
      node.taskKey,
      node.TaskKey,
    ].map(normalizeTaskStateValue);

    if (candidateIds.includes(targetTaskId)) {
      return node;
    }

    for (const value of Object.values(node)) {
      const found = walk(value);
      if (found) {
        return found;
      }
    }

    return null;
  };

  return walk(catalog);
};

const isCatalogTaskVisible = catalogTask => {
  if (!catalogTask || typeof catalogTask !== 'object') {
    return false;
  }

  const deleteState = normalizeTaskStateValue(
    catalogTask.isDeleted ??
    catalogTask.IsDeleted ??
    catalogTask.isDelete ??
    catalogTask.IsDelete ??
    catalogTask.deleted ??
    catalogTask.Deleted ??
    catalogTask.deletedFlag ??
    catalogTask.DeletedFlag ??
    catalogTask.removeFlag ??
    catalogTask.RemoveFlag ??
    catalogTask.removed ??
    catalogTask.Removed,
  );

  if (deleteState && hasTruthyTaskState(deleteState)) {
    return false;
  }

  const statusState = normalizeTaskStateValue(
    catalogTask.state ??
    catalogTask.State ??
    catalogTask.status ??
    catalogTask.Status ??
    catalogTask.taskStatus ??
    catalogTask.TaskStatus ??
    catalogTask.recordStatus ??
    catalogTask.RecordStatus ??
    catalogTask.active ??
    catalogTask.Active ??
    catalogTask.isActive ??
    catalogTask.IsActive ??
    catalogTask.enabled ??
    catalogTask.Enabled ??
    catalogTask.visible ??
    catalogTask.Visible,
  );

  if (!statusState) {
    return true;
  }

  if (hasTruthyTaskState(statusState)) {
    return true;
  }

  return !hasFalsyTaskState(statusState);
};

const isTaskOptionVisible = (task, catalog = null) => {
  if (!task || typeof task !== 'object') {
    return false;
  }

  const taskId = String(
    task.taskId ||
    task.TaskId ||
    task.taskKey ||
    task.TaskKey ||
    task.id ||
    task.key ||
    '',
  ).trim();

  const catalogTask = resolveCatalogTaskRecord(
    catalog,
    taskId || task.originalPath || task.raw?.originalPath || task.title,
  );

  if (catalogTask) {
    return isCatalogTaskVisible(catalogTask);
  }

  return isVisibleTaskRecord(task);
};

const TaskActionModal = ({
  visible,
  onClose,
  onSaved,
  mode,
  taskOptions = [],
  initialTask = null,
}) => {
  const { showAlert, showToast } = useAppFeedback();
  const [selectedTaskParam, setSelectedTaskParam] = useState(null);
  const [selectedTaskMeta, setSelectedTaskMeta] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [taskChoices, setTaskChoices] = useState([]);
  const [taskCatalog, setTaskCatalog] = useState(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshSpin = useRef(new Animated.Value(0)).current;
  const [isSaving, setIsSaving] = useState(false);
  const [ward, setWard] = useState('');
  const [participants, setParticipants] = useState('');
  const [maleCount, setMaleCount] = useState('');
  const [femaleCount, setFemaleCount] = useState('');
  const [otherCount, setOtherCount] = useState('');
  const [ageBelow18, setAgeBelow18] = useState('');
  const [remark, setRemark] = useState('');
  const [selectedTopics, setSelectedTopics] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [inlineToast, setInlineToast] = useState(null);
  const inlineToastTimerRef = useRef(null);

  // Media states
  const [images, setImages] = useState([]);
  const [videos, setVideos] = useState([]);
  const [isCameraVisible, setIsCameraVisible] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const videoCancelRef = useRef({ current: false, activeId: null });

  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').width)).current;
  const infoSlideAnim = useRef(new Animated.Value(Dimensions.get('window').width)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    } else {
      slideAnim.setValue(Dimensions.get('window').width);
    }
  }, [visible, slideAnim]);

  useEffect(() => {
    if (infoModalVisible) {
      Animated.spring(infoSlideAnim, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    } else {
      infoSlideAnim.setValue(Dimensions.get('window').width);
    }
  }, [infoModalVisible, infoSlideAnim]);

  useEffect(() => {
    if (visible) {
      setDropdownOpen(false);
      setOptionsError('');
      setFieldErrors({});
      setInlineToast(null);
    } else {
      setWard('');
      setParticipants('');
      setMaleCount('');
      setFemaleCount('');
      setOtherCount('');
      setAgeBelow18('');
      setRemark('');
      setImages([]);
      setVideos([]);
      setSelectedTaskParam(null);
      setSelectedTaskMeta(null);
      setDropdownOpen(false);
      setTaskChoices([]);
      setOptionsLoading(false);
      setOptionsError('');
      setFieldErrors({});
      setInlineToast(null);
    }
  }, [visible, mode]);

  useEffect(() => {
    let isActive = true;

    const loadTaskCatalog = async () => {
      if (!visible) {
        if (isActive) {
          setTaskCatalog(null);
        }
        return;
      }

      try {
        const catalog = await getTaskCatalog();
        if (isActive) {
          setTaskCatalog(catalog && typeof catalog === 'object' ? catalog : null);
        }
      } catch (error) {
        if (isActive) {
          setTaskCatalog(null);
        }
      }
    };

    loadTaskCatalog();

    return () => {
      isActive = false;
    };
  }, [visible]);

  useEffect(() => {
    return () => {
      if (inlineToastTimerRef.current) {
        clearTimeout(inlineToastTimerRef.current);
      }
    };
  }, []);

  const updateField = (setter, fieldName) => value => {
    setter(value);
    setFieldErrors(prev => {
      if (!prev[fieldName]) {
        return prev;
      }
      const nextErrors = { ...prev };
      delete nextErrors[fieldName];
      return nextErrors;
    });
  };

  useEffect(() => {
    const n = parseInt(String(participants || '').trim(), 10);
    if (!Number.isFinite(n) || n <= 0) {
      setMaleCount('');
      setFemaleCount('');
      setOtherCount('');
      setAgeBelow18('');
    }
  }, [participants]);

  useEffect(() => {
    const toInt = v => {
      const n = parseInt(String(v || '').trim(), 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    const total = toInt(participants);
    const genderSum =
      toInt(maleCount) + toInt(femaleCount) + toInt(otherCount);
    if (genderSum === total) {
      setFieldErrors(prev => {
        if (!prev.maleCount && !prev.femaleCount && !prev.otherCount) {
          return prev;
        }
        const next = { ...prev };
        delete next.maleCount;
        delete next.femaleCount;
        delete next.otherCount;
        return next;
      });
    }
  }, [maleCount, femaleCount, otherCount, participants]);

  const showInlineToast = (message, variant = 'warning') => {
    if (inlineToastTimerRef.current) {
      clearTimeout(inlineToastTimerRef.current);
    }

    setInlineToast({ message, variant });
    inlineToastTimerRef.current = setTimeout(() => {
      setInlineToast(null);
    }, 2200);
  };

  const dedupeTaskOptions = options => {
    const seen = new Set();
    return (Array.isArray(options) ? options : []).filter(item => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      const title = String(item.title || '').trim().toLowerCase();
      const taskId = String(item.taskId || item.id || '').trim().toLowerCase();
      const originalPath = String(item.originalPath || '').trim().toLowerCase();
      const signature = taskId || originalPath || title;

      if (!signature) {
        return false;
      }

      if (seen.has(signature)) {
        return false;
      }

      seen.add(signature);
      return true;
    });
  };

  const normalizedTaskOptions = useMemo(() => {
    const visibilityCatalog = taskCatalog || null;
    return dedupeTaskOptions(
      (Array.isArray(taskChoices) ? taskChoices : [])
        .map((item, index) => {
          if (!item) {
            return null;
          }

          const title = String(
            item.title ||
            item.name ||
            item.taskName ||
            item.TaskName ||
            item.label ||
            '',
          ).trim();
          const id = String(
            item.id || item.key || item.taskId || item.TaskId || index,
          ).trim();

          if (!title) {
            return null;
          }

          return {
            id: id || `${index}`,
            title,
            taskId: String(
              item.taskId || item.TaskId || item.id || item.key || '',
            ).trim(),
            taskCategory: String(
              item.taskCategory || item.TaskCategory || item.category || '',
            ).trim(),
            sourceLabel: String(
              item.sourceLabel || item.sourceType || item.taskSourceLabel || '',
            ).trim(),
            sourceKey: String(
              item.sourceKey || item.taskSourceKey || item.source_key || '',
            ).trim(),
            priority: String(
              item.priority || item.taskPriority || item.TaskPriority || '',
            ).trim(),
            description: String(
              item.description ||
              item.Description ||
              item.desc ||
              item.Desc ||
              item.details ||
              item.Details ||
              item.remarks ||
              item.Remarks ||
              item.remark ||
              item.Remark ||
              item.taskDesc ||
              item.TaskDesc ||
              item.TaskDetails ||
              '',
            ).trim(),
            type: String(
              item.type || item.taskType || item.TaskType || '',
            ).trim(),
            originalPath: item.originalPath || null,
            catalogTask: item.catalogTask || null,
            raw: item.raw || item,
          };
        })
        .filter(Boolean)
        .filter(item => isTaskOptionVisible(item, visibilityCatalog)),
    );
  }, [taskCatalog, taskChoices]);

  const pickTaskOptions = useMemo(() => {
    const visibilityCatalog = taskCatalog || null;
    return dedupeTaskOptions(
      (Array.isArray(taskOptions) ? taskOptions : [])
        .map((item, index) => {
          if (!item) {
            return null;
          }

          const title = String(
            item.title ||
            item.name ||
            item.taskName ||
            item.TaskName ||
            item.label ||
            '',
          ).trim();
          const id = String(
            item.id || item.key || item.taskId || item.TaskId || index,
          ).trim();

          if (!title) {
            return null;
          }

          return {
            id: id || `${index}`,
            title,
            taskId: String(
              item.taskId || item.TaskId || item.id || item.key || '',
            ).trim(),
            taskCategory: String(
              item.taskCategory || item.TaskCategory || item.category || '',
            ).trim(),
            sourceLabel: String(
              item.sourceLabel || item.sourceType || item.taskSourceLabel || '',
            ).trim(),
            sourceKey: String(
              item.sourceKey || item.taskSourceKey || item.source_key || '',
            ).trim(),
            description: String(
              item.description ||
              item.Description ||
              item.desc ||
              item.Desc ||
              item.details ||
              item.Details ||
              item.remarks ||
              item.Remarks ||
              item.remark ||
              item.Remark ||
              item.taskDesc ||
              item.TaskDesc ||
              item.TaskDetails ||
              '',
            ).trim(),
            type: String(
              item.type || item.taskType || item.TaskType || '',
            ).trim(),
            priority: String(
              item.priority || item.taskPriority || item.TaskPriority || '',
            ).trim(),
            originalPath: item.originalPath || null,
            catalogTask: item.catalogTask || null,
            raw: item.raw || item,
          };
        })
        .filter(Boolean)
        .filter(item => isTaskOptionVisible(item, visibilityCatalog)),
    );
  }, [taskCatalog, taskOptions]);

  const buildTaskChoices = useCallback(async () => {
    const session = await loadLoginSession();
    const userId = String(
      session?.loginId ||
      session?.employee?.userId ||
      session?.employee?.id ||
      '',
    ).trim();

    if (!userId) {
      return [];
    }

    const pushUnique = (list, item) => {
      const title = String(
        item?.title || item?.name || item?.taskName || item?.TaskName || '',
      ).trim();
      if (!title) {
        return list;
      }

      const exists = list.some(
        existing => existing.title.toLowerCase() === title.toLowerCase(),
      );
      if (!exists) {
        list.push({
          title,
          id: String(item?.id ?? item?.key ?? item?.taskId ?? title),
          description: String(
            item?.remark ||
            item?.Remark ||
            item?.remarks ||
            item?.Remarks ||
            item?.desc ||
            item?.Desc ||
            item?.description ||
            item?.Description ||
            item?.details ||
            item?.Details ||
            item?.taskDesc ||
            item?.TaskDesc ||
            item?.TaskDetails ||
            '',
          ).trim(),
          type: String(
            item?.type ?? item?.taskType ?? item?.TaskType ?? '',
          ).trim(),
          priority: String(
            item?.priority ?? item?.taskPriority ?? item?.TaskPriority ?? '',
          ).trim(),
          raw: item,
        });
      }

      return list;
    };

    const getTaskIdCandidate = item =>
      String(
        item?.taskId ??
        item?.TaskId ??
        item?.taskKey ??
        item?.TaskKey ??
        item?.id ??
        item?.key ??
        '',
      ).trim();

    const resolveTaskTitle = item =>
      String(
        item?.title ||
        item?.name ||
        item?.taskName ||
        item?.TaskName ||
        item?.label ||
        '',
      ).trim();

    const getTaskState = item => {
      if (!item || typeof item !== 'object') {
        return { hasState: false, isActive: true };
      }

      const values = [
        item.state,
        item.State,
        item.status,
        item.Status,
        item.taskStatus,
        item.TaskStatus,
        item.recordStatus,
        item.RecordStatus,
        item.active,
        item.Active,
        item.isActive,
        item.IsActive,
        item.enabled,
        item.Enabled,
        item.visible,
        item.Visible,
      ];

      const deleteValues = [
        item.isDeleted,
        item.IsDeleted,
        item.isDelete,
        item.IsDelete,
        item.deleted,
        item.Deleted,
        item.deletedFlag,
        item.DeletedFlag,
        item.removeFlag,
        item.RemoveFlag,
        item.removed,
        item.Removed,
      ];

      const normalizedState = values
        .map(value => String(value ?? '').trim().toLowerCase())
        .find(Boolean);
      const normalizedDeleteState = deleteValues
        .map(value => String(value ?? '').trim().toLowerCase())
        .find(Boolean);

      const isDeleted =
        normalizedDeleteState === 'yes' ||
        normalizedDeleteState === 'true' ||
        normalizedDeleteState === '1' ||
        normalizedDeleteState === 'deleted';

      const isActive =
        normalizedState === '1' ||
        normalizedState === 'true' ||
        normalizedState === 'yes' ||
        normalizedState === 'active' ||
        normalizedState === 'enabled' ||
        normalizedState === 'visible' ||
        normalizedState === 'open';

      const isInactive =
        normalizedState === '0' ||
        normalizedState === 'false' ||
        normalizedState === 'no' ||
        normalizedState === 'inactive' ||
        normalizedState === 'disabled' ||
        normalizedState === 'hidden' ||
        normalizedState === 'deleted' ||
        normalizedState === 'closed';

      return {
        hasState: Boolean(normalizedState || normalizedDeleteState),
        isActive: !isDeleted && (isActive || (!isInactive && !normalizedState)),
      };
    };

    const isTaskLeafCandidate = item => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      return Boolean(
        resolveTaskTitle(item) ||
        item.taskId ||
        item.TaskId ||
        item.id ||
        item.key ||
        item.status ||
        item.Status ||
        item.taskStatus ||
        item.TaskStatus ||
        item.active ||
        item.Active ||
        item.isActive ||
        item.IsActive ||
        item.isDeleted ||
        item.IsDeleted ||
        item.deleted ||
        item.Deleted,
      );
    };

    const collectOtherTaskChoices = (list, node, trail = []) => {
      if (node === null || node === undefined) {
        return;
      }

      if (Array.isArray(node)) {
        node.forEach((item, index) => {
          collectOtherTaskChoices(list, item, [...trail, String(index)]);
        });
        return;
      }

      if (typeof node !== 'object') {
        const title = String(node ?? '').trim();
        if (title) {
          pushUnique(list, {
            title,
            id: trail[trail.length - 1] || title,
            priority: 'low',
            type: 'Other',
            raw: node,
          });
        }
        return;
      }

      if (isTaskLeafCandidate(node)) {
        const state = getTaskState(node);
        if (state.hasState && !state.isActive) {
          return;
        }

        const title = resolveTaskTitle(node);
        if (!title) {
          return;
        }

        pushUnique(list, {
          ...node,
          title,
          id: String(
            node.id ??
            node.key ??
            node.taskId ??
            node.TaskId ??
            trail[trail.length - 1] ??
            title,
          ),
          type:
            String(node.type ?? node.taskType ?? node.TaskType ?? 'Other').trim() ||
            'Other',
          priority:
            String(
              node.priority ??
              node.taskPriority ??
              node.TaskPriority ??
              'low',
            ).trim() || 'low',
          raw: node,
        });
        return;
      }

      Object.entries(node).forEach(([key, value]) => {
        if (key === 'lastKey') {
          return;
        }
        collectOtherTaskChoices(list, value, [...trail, key]);
      });
    };

    if (mode === 'add_kpi') {
      const kpiPayload = await getData(`IECData/IECKPITasks/${userId}`);
      const choices = [];

      if (Array.isArray(kpiPayload)) {
        kpiPayload.forEach((item, index) => {
          if (item && typeof item === 'object') {
            pushUnique(choices, {
              ...item,
              id: item.id ?? item.key ?? item.taskId ?? item.TaskId ?? index,
              taskId: getTaskIdCandidate(item) || null,
              priority: 'low',
              type: item.type ?? item.taskType ?? item.TaskType ?? 'KPI',
              originalPath: `IECData/IECKPITasks/${userId}/${index}`,
            });
            return;
          }

          const title = String(item ?? '').trim();
          if (title) {
            pushUnique(choices, {
              title,
              id: `${index}`,
              priority: 'low',
              type: 'KPI',
              originalPath: `IECData/IECKPITasks/${userId}/${index}`,
            });
          }
        });
      } else if (kpiPayload && typeof kpiPayload === 'object') {
        Object.entries(kpiPayload).forEach(([key, value]) => {
          if (value && typeof value === 'object') {
            pushUnique(choices, {
              ...value,
              id: value.id ?? value.key ?? value.taskId ?? value.TaskId ?? key,
              taskId: getTaskIdCandidate(value) || null,
              priority: 'low',
              type: value.type ?? value.taskType ?? value.TaskType ?? 'KPI',
              originalPath: `IECData/IECKPITasks/${userId}/${key}`,
            });
            return;
          }

          const title = String(value ?? '').trim();
          if (title) {
            pushUnique(choices, {
              title,
              id: key,
              priority: 'low',
              type: 'KPI',
              originalPath: `IECData/IECKPITasks/${userId}/${key}`,
            });
          }
        });
      }

      return dedupeTaskOptions(choices);
    }

    if (mode === 'add_other') {
      const payload = await getTaskCatalog();
      const choices = [];

      collectOtherTaskChoices(choices, payload);

      return dedupeTaskOptions(choices).filter(item =>
        isTaskOptionVisible(item, payload),
      );
    }

    return [];
  }, [mode]);

  useEffect(() => {
    if (!visible || mode !== 'pick_task') {
      return;
    }

    const resolvedInitialTask = initialTask
      ? {
        id: String(
          initialTask.id ??
          initialTask.key ??
          initialTask.taskId ??
          initialTask.TaskId ??
          initialTask.title ??
          '',
        ).trim(),
        title: String(
          initialTask.title ??
          initialTask.name ??
          initialTask.taskName ??
          initialTask.TaskName ??
          initialTask.label ??
          '',
        ).trim(),
        description: String(
          initialTask.description ??
          initialTask.desc ??
          initialTask.taskDesc ??
          initialTask.TaskDesc ??
          initialTask.details ??
          '',
        ).trim(),
        type: String(
          initialTask.type ??
          initialTask.taskType ??
          initialTask.TaskType ??
          '',
        ).trim(),
        priority: String(
          initialTask.priority ??
          initialTask.taskPriority ??
          initialTask.TaskPriority ??
          '',
        ).trim(),
        taskCategory: String(
          initialTask.taskCategory ??
          initialTask.TaskCategory ??
          initialTask.category ??
          '',
        ).trim(),
        sourceLabel: String(
          initialTask.sourceLabel ??
          initialTask.sourceType ??
          initialTask.taskSourceLabel ??
          '',
        ).trim(),
        sourceKey: String(
          initialTask.sourceKey ??
          initialTask.taskSourceKey ??
          initialTask.source_key ??
          '',
        ).trim(),
        originalPath: initialTask.originalPath || null,
      }
      : null;

    const autoTask = resolvedInitialTask?.title
      ? resolvedInitialTask
      : pickTaskOptions[0] || null;

    setSelectedTaskParam(autoTask?.title || null);
    setSelectedTaskMeta(autoTask || null);
    setDropdownOpen(false);
  }, [visible, mode, initialTask, pickTaskOptions]);

  useEffect(() => {
    if (!visible || mode === 'pick_task') {
      return;
    }

    let isActive = true;

    const loadChoices = async () => {
      setOptionsLoading(true);
      setOptionsError('');
      try {
        const nextChoices = await buildTaskChoices();
        if (isActive) {
          setTaskChoices(nextChoices);
          setSelectedTaskParam(null);
        }
      } catch (error) {
        if (isActive) {
          setTaskChoices([]);
          setOptionsError(error?.message || 'Unable to load tasks.');
        }
      } finally {
        if (isActive) {
          setOptionsLoading(false);
        }
      }
    };

    loadChoices();

    return () => {
      isActive = false;
    };
  }, [visible, mode, buildTaskChoices]);

  const handleSelectTask = async item => {
    if (item.title === 'Select task') {
      setSelectedTaskParam(null);
      setSelectedTaskMeta(null);
      setSelectedTopics({});
      setDropdownOpen(false);
      return;
    }

    setSelectedTaskParam(item.title);
    setSelectedTaskMeta(item);
    setSelectedTopics({});
    setDropdownOpen(false);
    setFieldErrors(prev => {
      if (!prev.selectedTask) {
        return prev;
      }
      const nextErrors = { ...prev };
      delete nextErrors.selectedTask;
      return nextErrors;
    });

    // If description is missing, try to fetch it from the main tasks catalog
    if (!item.description && item.id) {
      try {
        const details = await getData(`IECData/Tasks/${item.id}`);
        if (details) {
          const freshDesc = String(
            details.remark ||
            details.Remark ||
            details.remarks ||
            details.Remarks ||
            details.desc ||
            details.Desc ||
            details.description ||
            details.Description ||
            details.details ||
            details.Details ||
            details.taskDesc ||
            details.TaskDesc ||
            details.TaskDetails ||
            '',
          ).trim();

          if (freshDesc) {
            setSelectedTaskMeta(prev => {
              // Ensure we only update if the ID still matches
              if (prev?.id === item.id) {
                return {
                  ...prev,
                  description: freshDesc,
                  raw: { ...(prev?.raw || {}), ...details },
                };
              }
              return prev;
            });
          }
        }
      } catch (e) {
      }
    }
  };

  // Topics mapped to the currently selected task (from IECData/Tasks/{id}/topics).
  // Returns an array of { topicId, name } from the { topicId: topicName } map.
  const availableTopics = useMemo(() => {
    const meta = selectedTaskMeta;
    if (!meta) {
      return [];
    }
    const taskId = String(meta.taskId || meta.id || '').trim();
    let topicsMap =
      (meta.raw && meta.raw.topics) ||
      meta.topics ||
      (taskId && taskCatalog && taskCatalog[taskId] && taskCatalog[taskId].topics) ||
      null;
    if (!topicsMap || typeof topicsMap !== 'object') {
      return [];
    }
    return Object.entries(topicsMap)
      .filter(([, name]) => String(name || '').trim() !== '')
      .map(([topicId, name]) => ({ topicId: String(topicId), name: String(name).trim() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedTaskMeta, taskCatalog]);

  const toggleTopic = topic => {
    setSelectedTopics(prev => {
      const next = { ...prev };
      if (next[topic.topicId]) {
        delete next[topic.topicId];
      } else {
        next[topic.topicId] = topic.name;
      }
      return next;
    });
    setFieldErrors(prev => {
      if (!prev.topics) {
        return prev;
      }
      const nextErrors = { ...prev };
      delete nextErrors.topics;
      return nextErrors;
    });
  };

  // Re-fetch tasks from Firebase (clears cache) and refresh the list in place.
  // Uses isRefreshing (not optionsLoading) so the sheet keeps showing the current
  // list and does NOT collapse/resize while refreshing.
  const handleRefreshTasks = useCallback(async () => {
    if (isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    try {
      await clearTaskCache();
      const catalog = await getTaskCatalog();
      setTaskCatalog(catalog && typeof catalog === 'object' ? catalog : null);
      const nextChoices = await buildTaskChoices();
      setTaskChoices(Array.isArray(nextChoices) ? nextChoices : []);
      setSelectedTaskParam(null);
      setSelectedTaskMeta(null);
      setSelectedTopics({});
    } catch (error) {
      showToast(error?.message || 'Unable to refresh tasks.', 'error');
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, buildTaskChoices, showToast]);

  // Spin the refresh icon in place while refreshing.
  useEffect(() => {
    let loop;
    if (isRefreshing) {
      refreshSpin.setValue(0);
      loop = Animated.loop(
        Animated.timing(refreshSpin, {
          toValue: 1,
          duration: 800,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      loop.start();
    } else {
      refreshSpin.stopAnimation();
      refreshSpin.setValue(0);
    }
    return () => {
      if (loop) {
        loop.stop();
      }
    };
  }, [isRefreshing, refreshSpin]);

  const handleSave = async () => {
    if (isSaving) {
      return;
    }

    // Section 01 — Task
    if (!selectedTaskParam) {
      setFieldErrors({ selectedTask: true });
      showInlineToast('Please select a task.', 'warning');
      return;
    }

    // Section 02 — Activity Info
    if (!ward.trim()) {
      setFieldErrors({ ward: true });
      showInlineToast('Please enter Ward Number.', 'warning');
      return;
    }

    // Section 03 — Participant Details (only when total > 0)
    const toInt = v => {
      const n = parseInt(String(v || '').trim(), 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    const participantsNum = toInt(participants);
    const genderSum =
      toInt(maleCount) + toInt(femaleCount) + toInt(otherCount);

    if (participantsNum > 0) {
      if (genderSum !== participantsNum) {
        setFieldErrors({
          maleCount: true,
          femaleCount: true,
          otherCount: true,
        });
        showAlert({
          title: 'Gender Count Mismatch',
          message:
            `Gender (Male + Female + Other) मिलाकर ${genderSum} हैं, ` +
            `पर Total Participants ${participantsNum} है। ` +
            `कृपया Gender count सही करें।`,
          variant: 'warning',
        });
        return;
      }
    }

    // Section 04 — Photos
    if (!images.length) {
      setFieldErrors(prev => ({ ...prev, images: true }));
      showInlineToast(
        'Please capture at least one image before submitting.',
        'warning',
      );
      return;
    }

    // Section 02 — Topics (min 1 required when the task has mapped topics)
    if (availableTopics.length > 0 && Object.keys(selectedTopics).length === 0) {
      setFieldErrors({ topics: true });
      showInlineToast('Please select at least one topic.', 'warning');
      return;
    }

    // Remark is optional now (kept only as extra context).

    setIsSaving(true);
    let capturedLocation = {
      latitude: 0,
      longitude: 0,
      address: 'Location not captured',
    };

    try {
      const locResult = await require('../services/locationTrackingService').getUserCurrentLocation();
      if (locResult.success && locResult.location) {
        capturedLocation = {
          latitude: locResult.location.latitude || 0,
          longitude: locResult.location.longitude || 0,
          address: locResult.location.address || 'Location captured',
        };
      }
    } catch (e) {
    }

    try {
      const resolvedTask = selectedTaskMeta ||
        pickTaskOptions.find(item => item.title === selectedTaskParam) ||
        normalizedTaskOptions.find(
          item => item.title === selectedTaskParam,
        ) || { title: selectedTaskParam };
      const taskSourcePath =
        resolvedTask.originalPath || resolvedTask.raw?.originalPath || null;
      const taskSourceKey = String(
        resolvedTask.sourceKey ||
        resolvedTask.taskSourceKey ||
        resolvedTask.raw?.sourceKey ||
        resolvedTask.raw?.taskSourceKey ||
        '',
      ).trim();
      const inferredTaskCategory = String(
        resolvedTask.taskCategory ||
        resolvedTask.TaskCategory ||
        resolvedTask.sourceLabel ||
        resolvedTask.type ||
        resolvedTask.raw?.taskCategory ||
        resolvedTask.raw?.TaskCategory ||
        resolvedTask.raw?.sourceLabel ||
        '',
      ).trim();
      const normalizedTaskCategory = taskSourcePath &&
        String(taskSourcePath).includes('IECPriorityTasks')
        ? 'Priority'
        : taskSourceKey === 'priority_task'
          ? 'Priority'
          : inferredTaskCategory || null;
      const normalizedTaskPriority = normalizedTaskCategory === 'Priority'
        ? 'high'
        : String(
          resolvedTask.priority ||
          resolvedTask.taskPriority ||
          resolvedTask.TaskPriority ||
          '',
        ).trim() || null;
      const taskWithoutOriginalPath = { ...resolvedTask };
      delete taskWithoutOriginalPath.originalPath;
      delete taskWithoutOriginalPath.raw;

      await saveTaskSubmission({
        mode,
        selectedTask: {
          ...taskWithoutOriginalPath,
          sourcePath: taskSourcePath,
          sourceKey: taskSourceKey || (normalizedTaskCategory === 'Priority' ? 'priority_task' : ''),
          taskCategory: normalizedTaskCategory,
          category: normalizedTaskCategory,
          Category: normalizedTaskCategory,
          sourceLabel: normalizedTaskCategory === 'Priority' ? 'Priority Task' : normalizedTaskCategory,
          sourceType: normalizedTaskCategory === 'Priority' ? 'Priority Task' : normalizedTaskCategory,
          priority: normalizedTaskPriority,
          taskPriority: normalizedTaskPriority,
          TaskPriority: normalizedTaskPriority,
          type: normalizedTaskCategory === 'Priority' ? 'priority' : taskWithoutOriginalPath.type,
          taskType: normalizedTaskCategory === 'Priority' ? 'priority' : taskWithoutOriginalPath.type,
        },
        ward: ward.trim(),
        participants: String(participantsNum),
        maleCount: maleCount.trim() === '' ? '' : String(toInt(maleCount)),
        femaleCount: femaleCount.trim() === '' ? '' : String(toInt(femaleCount)),
        otherCount: otherCount.trim() === '' ? '' : String(toInt(otherCount)),
        ageBelow18: ageBelow18.trim() === '' ? '' : String(toInt(ageBelow18)),
        remark: remark.trim(),
        topics: selectedTopics,
        images,
        videos,
        location: capturedLocation,
      });

      setFieldErrors({});
      showToast('Task submitted.', 'success');
      onSaved?.();
      onClose();
    } catch (error) {
      showInlineToast(error?.message || 'Unable to save task.', 'error');
      showAlert({
        title: 'Save Task',
        message: error?.message || 'Unable to save task.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const captureImage = () => {
    if (images.length >= MAX_IMAGES) {
      showInlineToast(
        `You can only attach up to ${MAX_IMAGES} images.`,
        'warning',
      );
      return;
    }
    Keyboard.dismiss();
    setIsProcessingImage(true);
    setIsCameraVisible(true);
  };

  const onPictureTaken = uri => {
    setImages(prev => [...prev, uri]);
    setFieldErrors(prev => ({ ...prev, images: false }));
    setIsProcessingImage(false);
  };

  const pickImageFromGallery = async () => {
    if (images.length >= MAX_IMAGES) {
      showInlineToast(
        `You can only attach up to ${MAX_IMAGES} images.`,
        'warning',
      );
      return;
    }
    Keyboard.dismiss();
    setIsProcessingImage(true);
    try {
      const remainingSlots = MAX_IMAGES - images.length;
      beginAppStateSuppression(8000);
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: remainingSlots,
        quality: 0.8,
      });

      if (result.didCancel || result.errorCode || !result.assets) {
        return;
      }

      const pickedUris = result.assets
        .map(asset => asset?.uri)
        .filter(Boolean)
        .slice(0, remainingSlots);

      if (!pickedUris.length) {
        return;
      }

      setImages(prev => [...prev, ...pickedUris].slice(0, MAX_IMAGES));
      setFieldErrors(prev => ({ ...prev, images: false }));
    } catch (err) {
      showAlert({
        title: 'Image Upload Error',
        message: err?.message || 'Image upload नहीं हो पाया। कृपया दोबारा कोशिश करें।',
      });
    } finally {
      setIsProcessingImage(false);
    }
  };

  const cancelVideoCompression = () => {
    videoCancelRef.current.current = true;
    const id = videoCancelRef.current.activeId;
    if (id) {
      try {
        VideoCompressor.cancelCompression(id);
      } catch (_e) {
        // Ignore
      }
    }
    setIsCompressing(false);
  };

  const captureVideo = async () => {
    if (videos.length >= 2) {
      showInlineToast('आप केवल 2 वीडियो तक जोड़ सकते हैं।', 'warning');
      return;
    }
    Keyboard.dismiss();
    videoCancelRef.current = { current: false, activeId: null };
    setIsCompressing(true);
    try {
      beginAppStateSuppression(60000);
      const result = await launchImageLibrary({
        mediaType: 'video',
        videoQuality: 'high',
        selectionLimit: 1,
      });

      if (result.didCancel || result.errorCode || !result.assets) {
        setIsCompressing(false);
        return;
      }

      const activeVideoAsset = result.assets[0] || {};
      const videoUri = activeVideoAsset.uri;
      const compressedVideo = await compressVideoForUpload(
        videoUri,
        {
          fileSize: activeVideoAsset.fileSize,
          duration: activeVideoAsset.duration,
          width: activeVideoAsset.width,
          height: activeVideoAsset.height,
        },
        videoCancelRef.current,
      );
      const finalVideoUri = compressedVideo.uri;
      if (!finalVideoUri) {
        throw new Error(
          'वीडियो compress नहीं हो पाया। कृपया छोटा वीडियो चुनें।',
        );
      }
      const finalVideoSizeBytes =
        compressedVideo.sizeBytes || (await getFileSizeBytes(finalVideoUri));

      let thumbnailUri = null;

      try {
        const thumbnail = await createVideoThumbnail(finalVideoUri);
        thumbnailUri = thumbnail?.path || null;
      } catch { }

      setVideos(prev => [
        ...prev,
        { uri: finalVideoUri, thumbnailUri, sizeBytes: finalVideoSizeBytes },
      ]);
    } catch (err) {
      if (err?.message !== 'CANCELLED') {
        showAlert({
          title: 'Video Upload Error',
          message:
            err?.message ||
            'वीडियो process नहीं हो पाया। कृपया दोबारा कोशिश करें।',
        });
      }
    } finally {
      setIsCompressing(false);
    }
  };

  const getPageTitle = () => {
    if (mode === 'add_kpi') return 'Add KPI Task';
    if (mode === 'add_other') return 'Add Other Task';
    return 'Complete Task';
  };

  const getDropdownPlaceholder = () => {
    if (mode === 'add_kpi') return '-- Task --';
    if (mode === 'add_other') return '-- Task --';
    return 'Selected task';
  };

  const inlineToastTheme = inlineToast
    ? (inlineToastStyles[inlineToast.variant] ?? inlineToastStyles.warning)
    : inlineToastStyles.warning;
  const dropdownSheetMaxHeight = Dimensions.get('window').height * 0.65;

  const participantsParsed = parseInt(
    String(participants || '').trim(),
    10,
  );
  const showParticipantDetails =
    Number.isFinite(participantsParsed) && participantsParsed > 0;

  return (
    <>
      <ReusableCamera
        visible={isCameraVisible}
        onClose={() => {
          setIsCameraVisible(false);
          setIsProcessingImage(false);
        }}
        onPictureTaken={onPictureTaken}
      />
      <CommonLoader
        visible={isSaving}
        message="Saving task..."
        subMessage="Please wait while the task is being submitted."
      />
      <Modal
        visible={visible}
        animationType="none"
        transparent={true}
        onRequestClose={onClose}
      >
        <Animated.View
          style={{
            flex: 1,
            backgroundColor: '#FFF',
            transform: [{ translateX: slideAnim }],
          }}
        >
          <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
            <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
            <View
              style={{ flex: 1 }}
              pointerEvents={isSaving ? 'none' : 'auto'}
            >
              <View style={styles.header}>
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={onClose}
                  activeOpacity={0.6}
                  disabled={isSaving}
                >
                  <MaterialCommunityIcons
                    name="arrow-left"
                    size={24}
                    color={appTheme.colors.neutral.text}
                  />
                </TouchableOpacity>
                <View style={styles.headerTitleWrap}>
                  <Text style={styles.headerTitle}>{getPageTitle()}</Text>
                  <Text style={styles.headerSubtitle}>
                    Please fill the required details below
                  </Text>
                </View>
              </View>

              <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              >
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.scrollContent}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  {/* Section 01 — Task */}
                  <View
                    style={[
                      styles.section,
                      {
                        zIndex: 100,
                        ...(Platform.OS === 'android'
                          ? { elevation: dropdownOpen ? 10 : 2 }
                          : {}),
                      },
                    ]}
                  >
                    <View style={styles.sectionHead}>
                      <View style={styles.sectionBadge}>
                        <Text style={styles.sectionBadgeText}>01</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sectionTitle}>Task Selection</Text>
                        <Text style={styles.sectionSubtitle}>
                          Choose the activity you completed
                        </Text>
                      </View>
                      {selectedTaskParam ? (
                        <TouchableOpacity
                          style={styles.sectionAction}
                          onPress={() => setInfoModalVisible(true)}
                          activeOpacity={0.7}
                        >
                          <MaterialCommunityIcons
                            name="eye-outline"
                            size={14}
                            color={appTheme.colors.brand.primary}
                          />
                          <Text style={styles.sectionActionText}>Details</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {mode === 'pick_task' ? (
                      <View
                        style={[
                          styles.taskPicker,
                          styles.taskPickerLocked,
                          fieldErrors.selectedTask
                            ? styles.taskPickerError
                            : null,
                        ]}
                      >
                        <View style={styles.taskPickerIconWrap}>
                          <MaterialCommunityIcons
                            name="clipboard-check"
                            size={20}
                            color={appTheme.colors.brand.primary}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.taskPickerLabel}>
                            Selected Task
                          </Text>
                          <Text
                            style={styles.taskPickerValue}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {selectedTaskParam || '—'}
                          </Text>
                        </View>
                        <MaterialCommunityIcons
                          name="lock-outline"
                          size={18}
                          color="#94A3B8"
                        />
                      </View>
                    ) : (
                      <View style={styles.dropdownWrap}>
                        <TouchableOpacity
                          style={[
                            styles.taskPicker,
                            fieldErrors.selectedTask
                              ? styles.taskPickerError
                              : null,
                          ]}
                          activeOpacity={0.75}
                          onPress={() => setDropdownOpen(prev => !prev)}
                        >
                          <View style={styles.taskPickerIconWrap}>
                            <MaterialCommunityIcons
                              name="clipboard-list-outline"
                              size={20}
                              color={appTheme.colors.brand.primary}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.taskPickerLabel}>
                              Task <Text style={styles.reqStar}>*</Text>
                            </Text>
                            <Text
                              style={[
                                styles.taskPickerValue,
                                !selectedTaskParam &&
                                styles.taskPickerPlaceholder,
                              ]}
                              numberOfLines={1}
                              ellipsizeMode="tail"
                            >
                              {selectedTaskParam || getDropdownPlaceholder()}
                            </Text>
                          </View>
                          <View style={styles.taskPickerChevron}>
                            <MaterialCommunityIcons
                              name={
                                dropdownOpen ? 'chevron-up' : 'chevron-down'
                              }
                              size={20}
                              color={appTheme.colors.brand.primary}
                            />
                          </View>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  {/* Section 02 — Topics */}
                  <View style={styles.section}>
                    <View style={styles.sectionHead}>
                      <View style={styles.sectionBadge}>
                        <Text style={styles.sectionBadgeText}>02</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sectionTitle}>
                          Topics <Text style={styles.reqStar}>*</Text>
                        </Text>
                        <Text style={styles.sectionSubtitle}>
                          Select the topics covered in this activity
                        </Text>
                      </View>
                    </View>

                    {!selectedTaskParam ? (
                      <Text style={styles.topicsHint}>
                        Please select a task first to see its topics.
                      </Text>
                    ) : availableTopics.length === 0 ? (
                      <Text style={styles.topicsHint}>
                        No topics mapped for this task.
                      </Text>
                    ) : (
                      <View
                        style={[
                          styles.topicCheckList,
                          fieldErrors.topics && styles.topicCheckListError,
                        ]}
                      >
                        {availableTopics.map((topic, idx) => {
                          const isSel = !!selectedTopics[topic.topicId];
                          const isLast = idx === availableTopics.length - 1;
                          return (
                            <TouchableOpacity
                              key={topic.topicId}
                              activeOpacity={0.7}
                              style={[
                                styles.topicCheckRow,
                                !isLast && styles.topicCheckRowBorder,
                              ]}
                              onPress={() => toggleTopic(topic)}
                              disabled={isSaving}
                            >
                              <View
                                style={[
                                  styles.topicCheckbox,
                                  isSel && styles.topicCheckboxChecked,
                                ]}
                              >
                                {isSel && (
                                  <MaterialCommunityIcons
                                    name="check"
                                    size={14}
                                    color="#FFFFFF"
                                  />
                                )}
                              </View>
                              <Text
                                style={[
                                  styles.topicCheckLabel,
                                  isSel && styles.topicCheckLabelChecked,
                                ]}
                              >
                                {topic.name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>

                  {/* Section 03 — Activity Info */}
                  <View style={styles.section}>
                    <View style={styles.sectionHead}>
                      <View style={styles.sectionBadge}>
                        <Text style={styles.sectionBadgeText}>03</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sectionTitle}>Activity Info</Text>
                        <Text style={styles.sectionSubtitle}>
                          Where it happened and total people
                        </Text>
                      </View>
                    </View>

                    <View style={styles.row2}>
                      <View style={styles.row2Cell}>
                        <Text style={styles.fieldLabel}>
                          Ward Number <Text style={styles.reqStar}>*</Text>
                        </Text>
                        <View
                          style={[
                            styles.iconInput,
                            fieldErrors.ward && styles.iconInputError,
                          ]}
                        >
                          <MaterialCommunityIcons
                            name="map-marker-outline"
                            size={18}
                            color="#94A3B8"
                          />
                          <TextInput
                            style={styles.iconInputField}
                            placeholder="Ex: 14A"
                            placeholderTextColor="#CBD5E1"
                            value={ward}
                            onChangeText={updateField(setWard, 'ward')}
                            editable={!isSaving}
                          />
                        </View>
                      </View>

                      <View style={styles.row2Cell}>
                        <Text style={styles.fieldLabel}>Total Participants</Text>
                        <View
                          style={[
                            styles.iconInput,
                            fieldErrors.participants &&
                            styles.iconInputError,
                          ]}
                        >
                          <MaterialCommunityIcons
                            name="account-group-outline"
                            size={18}
                            color="#94A3B8"
                          />
                          <TextInput
                            style={styles.iconInputField}
                            placeholder="0"
                            placeholderTextColor="#CBD5E1"
                            value={participants}
                            onChangeText={txt =>
                              updateField(
                                setParticipants,
                                'participants',
                              )(String(txt).replace(/[^0-9]/g, ''))
                            }
                            keyboardType="numeric"
                            editable={!isSaving}
                          />
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* Section 04 — Participant Details (only when total > 0) */}
                  {showParticipantDetails ? (
                    <View style={styles.section}>
                      <View style={styles.sectionHead}>
                        <View style={styles.sectionBadge}>
                          <Text style={styles.sectionBadgeText}>04</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.sectionTitle}>
                            Participant Details
                          </Text>
                          <Text style={styles.sectionSubtitle}>
                            Count must match total participants
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.subHead}>Gender</Text>
                      <View style={styles.tileRow}>
                        {[
                          {
                            label: 'Male',
                            value: maleCount,
                            setter: setMaleCount,
                            errKey: 'maleCount',
                            icon: 'gender-male',
                            color: '#3B82F6',
                          },
                          {
                            label: 'Female',
                            value: femaleCount,
                            setter: setFemaleCount,
                            errKey: 'femaleCount',
                            icon: 'gender-female',
                            color: '#EC4899',
                          },
                          {
                            label: 'Other',
                            value: otherCount,
                            setter: setOtherCount,
                            errKey: 'otherCount',
                            icon: 'gender-non-binary',
                            color: '#8B5CF6',
                          },
                        ].map(item => (
                          <View key={item.errKey} style={styles.genderTile}>
                            <View
                              style={[
                                styles.genderTileIcon,
                                { backgroundColor: `${item.color}1A` },
                              ]}
                            >
                              <MaterialCommunityIcons
                                name={item.icon}
                                size={18}
                                color={item.color}
                              />
                            </View>
                            <Text style={styles.genderTileLabel}>
                              {item.label}
                            </Text>
                            <TextInput
                              style={[
                                styles.genderTileInput,
                                fieldErrors[item.errKey] &&
                                styles.genderTileInputError,
                              ]}
                              value={item.value ? String(item.value) : ''}
                              onChangeText={txt =>
                                updateField(
                                  item.setter,
                                  item.errKey,
                                )(String(txt).replace(/[^0-9]/g, ''))
                              }
                              placeholder="0"
                              placeholderTextColor="#CBD5E1"
                              keyboardType="numeric"
                              editable={!isSaving}
                              selectTextOnFocus
                            />
                          </View>
                        ))}
                      </View>

                      <Text style={[styles.subHead, { marginTop: 18 }]}>
                        Age Group
                      </Text>
                      <View style={styles.ageList}>
                        {[
                          {
                            label: 'Under 18',
                            value: ageBelow18,
                            setter: setAgeBelow18,
                            errKey: 'ageBelow18',
                            icon: 'baby-face-outline',
                            color: '#10B981',
                          },
                        ].map(item => (
                          <View key={item.errKey} style={styles.ageRow}>
                            <View
                              style={[
                                styles.ageRowIcon,
                                { backgroundColor: `${item.color}1A` },
                              ]}
                            >
                              <MaterialCommunityIcons
                                name={item.icon}
                                size={16}
                                color={item.color}
                              />
                            </View>
                            <Text style={styles.ageRowLabel}>{item.label}</Text>
                            <TextInput
                              style={[
                                styles.ageRowInput,
                                fieldErrors[item.errKey] &&
                                styles.ageRowInputError,
                              ]}
                              value={item.value ? String(item.value) : ''}
                              onChangeText={txt =>
                                updateField(
                                  item.setter,
                                  item.errKey,
                                )(String(txt).replace(/[^0-9]/g, ''))
                              }
                              placeholder="0"
                              placeholderTextColor="#CBD5E1"
                              keyboardType="numeric"
                              editable={!isSaving}
                              selectTextOnFocus
                            />
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {/* Section 05 — Photos & Video */}
                  <View style={styles.section}>
                    <View style={styles.sectionHead}>
                      <View style={styles.sectionBadge}>
                        <Text style={styles.sectionBadgeText}>05</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sectionTitle}>Photos & Video</Text>
                        <Text style={styles.sectionSubtitle}>
                          Capture or upload supporting media
                        </Text>
                      </View>
                    </View>

                    <View style={styles.mediaBlock}>
                      <View style={styles.mediaBlockHead}>
                        <MaterialCommunityIcons
                          name="image-multiple-outline"
                          size={16}
                          color="#475569"
                        />
                        <Text style={styles.mediaBlockTitle}>
                          Photos <Text style={styles.reqStar}>*</Text>
                        </Text>
                        <View style={styles.mediaPill}>
                          <Text style={styles.mediaPillText}>
                            {images.length} of {MAX_IMAGES}
                          </Text>
                        </View>
                      </View>
                      {fieldErrors.images ? (
                        <Text style={styles.mediaErrorText}>
                          At least one photo is required.
                        </Text>
                      ) : null}
                      <View style={styles.mediaGrid}>
                        {isProcessingImage ? (
                          <View
                            style={[
                              styles.previewCard,
                              styles.compressingCard,
                            ]}
                          >
                            <ActivityIndicator
                              size="small"
                              color={appTheme.colors.brand.primary}
                            />
                            <Text style={styles.compressingText}>
                              Loading...
                            </Text>
                          </View>
                        ) : null}
                        {!isProcessingImage && images.length < MAX_IMAGES && (
                          <TouchableOpacity
                            style={[
                              styles.previewCard,
                              styles.uploadDashedBox,
                            ]}
                            activeOpacity={0.7}
                            onPress={captureImage}
                          >
                            <MaterialCommunityIcons
                              name="camera-plus"
                              size={28}
                              color={appTheme.colors.brand.primary}
                            />
                            <Text style={styles.uploadSmallText}>Capture</Text>
                          </TouchableOpacity>
                        )}
                        {!isProcessingImage && images.length < MAX_IMAGES && (
                          <TouchableOpacity
                            style={[
                              styles.previewCard,
                              styles.uploadDashedBox,
                            ]}
                            activeOpacity={0.7}
                            onPress={pickImageFromGallery}
                          >
                            <MaterialCommunityIcons
                              name="image-plus"
                              size={28}
                              color={appTheme.colors.brand.primary}
                            />
                            <Text style={styles.uploadSmallText}>Upload</Text>
                          </TouchableOpacity>
                        )}
                        {images.map((imgUri, index) => (
                          <TouchableOpacity
                            key={`image-preview-${index}`}
                            style={styles.previewCard}
                            activeOpacity={0.8}
                            onPress={() => setPreviewImage(imgUri)}
                          >
                            <Image
                              source={{ uri: imgUri }}
                              style={styles.previewImg}
                            />
                            <TouchableOpacity
                              style={styles.removeMediaBtn}
                              onPress={() => {
                                const newImgs = [...images];
                                newImgs.splice(index, 1);
                                setImages(newImgs);
                              }}
                            >
                              <MaterialCommunityIcons
                                name="close"
                                size={14}
                                color="#FFF"
                              />
                            </TouchableOpacity>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    <View style={[styles.mediaBlock, { marginTop: 14 }]}>
                      <View style={styles.mediaBlockHead}>
                        <MaterialCommunityIcons
                          name="video-outline"
                          size={16}
                          color="#475569"
                        />
                        <Text style={styles.mediaBlockTitle}>
                          Video{' '}
                          <Text style={styles.optionalText}>(Optional)</Text>
                        </Text>
                        <View style={styles.mediaPill}>
                          <Text style={styles.mediaPillText}>
                            {videos.length} of 2
                          </Text>
                        </View>
                      </View>
                      <View style={styles.mediaGrid}>
                        {isCompressing ? (
                          <View
                            style={[
                              styles.previewCard,
                              styles.compressingCard,
                            ]}
                          >
                            <ActivityIndicator
                              size="small"
                              color={appTheme.colors.brand.primary}
                            />
                            <Text style={styles.compressingText}>
                              Compressing...
                            </Text>
                            <TouchableOpacity
                              style={styles.compressingCancelBtn}
                              onPress={cancelVideoCompression}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.compressingCancelText}>
                                Cancel
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          videos.length < 2 && (
                            <TouchableOpacity
                              style={[
                                styles.previewCard,
                                styles.uploadDashedBox,
                              ]}
                              activeOpacity={0.7}
                              onPress={captureVideo}
                            >
                              <MaterialCommunityIcons
                                name="video-plus"
                                size={28}
                                color={appTheme.colors.brand.primary}
                              />
                              <Text style={styles.uploadSmallText}>
                                Add Video
                              </Text>
                            </TouchableOpacity>
                          )
                        )}
                        {videos.map((videoItem, index) => (
                          <View
                            key={`video-preview-${index}`}
                            style={styles.previewCard}
                          >
                            {videoItem.thumbnailUri ? (
                              <Image
                                source={{ uri: videoItem.thumbnailUri }}
                                style={styles.previewImg}
                              />
                            ) : (
                              <View style={styles.videoPlaceholder}>
                                <MaterialCommunityIcons
                                  name="play-circle"
                                  size={38}
                                  color="#FFF"
                                />
                              </View>
                            )}
                            <TouchableOpacity
                              style={styles.removeMediaBtn}
                              onPress={() => {
                                const newVids = [...videos];
                                newVids.splice(index, 1);
                                setVideos(newVids);
                              }}
                            >
                              <MaterialCommunityIcons
                                name="close"
                                size={14}
                                color="#FFF"
                              />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    </View>
                  </View>

                  {/* Section 06 — Remarks */}
                  <View style={styles.section}>
                    <View style={styles.sectionHead}>
                      <View style={styles.sectionBadge}>
                        <Text style={styles.sectionBadgeText}>06</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sectionTitle}>Remarks</Text>
                        <Text style={styles.sectionSubtitle}>
                          Add any additional notes (optional)
                        </Text>
                      </View>
                    </View>

                    <TextInput
                      style={styles.descInput}
                      placeholder="Write your remark here..."
                      placeholderTextColor="#94A3B8"
                      multiline
                      numberOfLines={5}
                      value={remark}
                      onChangeText={updateField(setRemark, 'remark')}
                      textAlignVertical="top"
                      editable={!isSaving}
                    />
                  </View>

                  <View style={{ height: 100 }} />
                </ScrollView>
              </KeyboardAvoidingView>
            </View>

            {inlineToast ? (
              <View pointerEvents="none" style={styles.inlineToastWrap}>
                <View
                  style={[
                    styles.inlineToast,
                    {
                      borderColor: inlineToastTheme.borderColor,
                      backgroundColor: inlineToastTheme.surfaceBg,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.inlineToastAccent,
                      { backgroundColor: inlineToastTheme.accentColor },
                    ]}
                  />
                  <MaterialCommunityIcons
                    name={inlineToastTheme.icon}
                    size={18}
                    color={inlineToastTheme.accentColor}
                    style={styles.inlineToastIcon}
                  />
                  <View style={styles.inlineToastTextWrap}>
                    <Text
                      style={[
                        styles.inlineToastTitle,
                        { color: inlineToastTheme.labelText },
                      ]}
                    >
                      {inlineToastTheme.label}
                    </Text>
                    <Text style={styles.inlineToastText} numberOfLines={2}>
                      {inlineToast.message}
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}

            <View style={styles.bottomBar}>
              <TouchableOpacity
                style={[styles.submitBtn, isSaving && styles.submitBtnDisabled]}
                onPress={handleSave}
                activeOpacity={0.85}
                disabled={isSaving}
              >
                <Text style={styles.submitBtnText}>
                  {isSaving ? 'Saving...' : 'Submit Task'}
                </Text>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={20}
                  color="#FFF"
                  style={{ marginLeft: 8 }}
                />
              </TouchableOpacity>
            </View>

            {dropdownOpen ? (
              <View style={styles.dropdownOverlay} pointerEvents="box-none">
                <TouchableOpacity
                  activeOpacity={1}
                  style={styles.dropdownBackdrop}
                  onPress={() => setDropdownOpen(false)}
                />
                <View
                  style={[
                    styles.dropdownPanel,
                    { maxHeight: dropdownSheetMaxHeight },
                  ]}
                >
                  <View style={styles.dropdownSheetHeader}>
                    <Text style={styles.dropdownSheetTitle}>Select task</Text>
                    <View style={styles.dropdownSheetActions}>
                      <TouchableOpacity
                        onPress={handleRefreshTasks}
                        style={styles.dropdownSheetCloseBtn}
                        activeOpacity={0.75}
                        disabled={isRefreshing}
                      >
                        <Animated.View
                          style={{
                            transform: [
                              {
                                rotate: refreshSpin.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: ['0deg', '360deg'],
                                }),
                              },
                            ],
                          }}
                        >
                          <MaterialCommunityIcons
                            name="refresh"
                            size={20}
                            color={appTheme.colors.brand.primary}
                          />
                        </Animated.View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setDropdownOpen(false)}
                        style={styles.dropdownSheetCloseBtn}
                        activeOpacity={0.75}
                      >
                        <MaterialCommunityIcons
                          name="close"
                          size={20}
                          color={appTheme.colors.neutral.textMuted}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <ScrollView
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={true}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.dropdownScrollContent}
                  >
                    {optionsLoading ? (
                      <View style={styles.dropdownEmpty}>
                        <Text style={styles.dropdownEmptyText}>
                          Loading tasks...
                        </Text>
                      </View>
                    ) : optionsError ? (
                      <View style={styles.dropdownEmpty}>
                        <Text style={styles.dropdownEmptyText}>
                          {optionsError}
                        </Text>
                      </View>
                    ) : normalizedTaskOptions.length ? (
                      normalizedTaskOptions.map(item => {
                        const isSelected = selectedTaskParam === item.title;
                        return (
                          <TouchableOpacity
                            key={item.id}
                            style={[
                              styles.dropdownItem,
                              isSelected ? styles.dropdownItemActive : null,
                            ]}
                            activeOpacity={0.75}
                            onPress={() => handleSelectTask(item)}
                          >
                            <Text
                              style={[
                                styles.dropdownItemTitle,
                                isSelected && styles.dropdownItemTitleActive,
                              ]}
                            >
                              {item.title}
                            </Text>
                            {isSelected && (
                              <MaterialCommunityIcons
                                name="check-circle"
                                size={20}
                                color={appTheme.colors.brand.primary}
                              />
                            )}
                          </TouchableOpacity>
                        );
                      })
                    ) : (
                      <View style={styles.dropdownEmpty}>
                        <Text style={styles.dropdownEmptyText}>
                          No tasks available
                        </Text>
                      </View>
                    )}
                  </ScrollView>
                </View>
              </View>
            ) : null}
          </SafeAreaView>
        </Animated.View>
      </Modal>

      <Modal
        visible={!!previewImage}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
      >
        <View style={styles.fullScreenPreviewBg}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={styles.previewHeader}>
              <TouchableOpacity
                style={styles.previewCloseBtn}
                onPress={() => setPreviewImage(null)}
              >
                <MaterialCommunityIcons name="close" size={28} color="#FFF" />
              </TouchableOpacity>
            </View>
            {previewImage && (
              <Image
                source={{ uri: previewImage }}
                style={styles.fullScreenImg}
                resizeMode="contain"
              />
            )}
          </SafeAreaView>
        </View>
      </Modal>

      <TaskDetailModal
        visible={infoModalVisible}
        onClose={() => setInfoModalVisible(false)}
        onStart={() => { }}
        task={
          selectedTaskMeta ||
          pickTaskOptions.find(item => item.title === selectedTaskParam) ||
          normalizedTaskOptions.find(item => item.title === selectedTaskParam)
        }
        viewOnly={true}
      />
    </>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  scrollContent: {
    padding: 16,
    paddingTop: 18,
    paddingBottom: 24,
  },
  reqStar: {
    color: '#EF4444',
  },
  inputError: {
    borderColor: '#DC3545',
    backgroundColor: 'rgba(220, 53, 69, 0.05)',
  },
  // ─────── New design: Section card ───────
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginBottom: 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: appTheme.colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    shadowColor: appTheme.colors.brand.primary,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  sectionBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  sectionSubtitle: {
    fontSize: 11.5,
    color: '#94A3B8',
    fontWeight: '500',
    marginTop: 2,
  },
  sectionAction: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 59, 74, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 4,
  },
  sectionActionText: {
    fontSize: 11,
    fontWeight: '800',
    color: appTheme.colors.brand.primary,
  },
  // ─── Task picker
  taskPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
    gap: 12,
  },
  taskPickerLocked: {
    backgroundColor: '#F1F5F9',
    borderStyle: 'dashed',
  },
  taskPickerError: {
    borderColor: '#DC2626',
    backgroundColor: 'rgba(220, 38, 38, 0.05)',
  },
  taskPickerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(18, 59, 74, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskPickerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  taskPickerValue: {
    fontSize: 14.5,
    color: '#0F172A',
    fontWeight: '700',
  },
  taskPickerPlaceholder: {
    color: '#94A3B8',
    fontWeight: '500',
  },
  taskPickerChevron: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  // ─── Row layout
  row2: {
    flexDirection: 'row',
    gap: 12,
  },
  row2Cell: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  iconInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 46,
    gap: 8,
  },
  iconInputError: {
    borderColor: '#DC2626',
    backgroundColor: 'rgba(220, 38, 38, 0.04)',
  },
  iconInputField: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
    fontWeight: '600',
    paddingVertical: 0,
  },
  // ─── Demographics
  subHead: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  tileRow: {
    flexDirection: 'row',
    gap: 10,
  },
  genderTile: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#EEF2F7',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  genderTileIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  genderTileLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
  },
  genderTileInput: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    minHeight: 38,
    textAlign: 'center',
  },
  genderTileInputError: {
    borderColor: '#DC2626',
    backgroundColor: 'rgba(220, 38, 38, 0.04)',
  },
  ageList: {
    gap: 8,
  },
  ageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#EEF2F7',
  },
  ageRowIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  ageRowLabel: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    color: '#334155',
  },
  ageRowInput: {
    width: 80,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    minHeight: 38,
    textAlign: 'center',
  },
  ageRowInputError: {
    borderColor: '#DC2626',
    backgroundColor: 'rgba(220, 38, 38, 0.04)',
  },
  // ─── Media block
  mediaBlock: {},
  mediaBlockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  mediaBlockTitle: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '800',
    color: '#334155',
    letterSpacing: 0.3,
  },
  mediaPill: {
    backgroundColor: 'rgba(18, 59, 74, 0.10)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  mediaPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: appTheme.colors.brand.primary,
    letterSpacing: 0.2,
  },
  // ─── Description
  descInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 14.5,
    color: '#0F172A',
    fontWeight: '500',
    minHeight: 110,
  },
  descInputError: {
    borderColor: '#DC2626',
    backgroundColor: 'rgba(220, 38, 38, 0.04)',
  },
  topicsHint: {
    fontSize: 13,
    color: '#94A3B8',
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  topicCheckList: {
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
  },
  topicCheckListError: {
    borderColor: '#DC2626',
    backgroundColor: 'rgba(220, 38, 38, 0.04)',
  },
  topicCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  topicCheckRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  topicCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.6,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  topicCheckboxChecked: {
    backgroundColor: '#123B4A',
    borderColor: '#123B4A',
  },
  topicCheckLabel: {
    flex: 1,
    fontSize: 14,
    color: '#334155',
    fontWeight: '500',
  },
  topicCheckLabelChecked: {
    color: '#0F172A',
    fontWeight: '600',
  },
  remarkLabel: {
    fontSize: 13.5,
    color: '#475569',
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  pickerSelector: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerSelectorLocked: {
    opacity: 0.96,
    backgroundColor: '#F8FAFC',
  },
  pickerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  taskInfoBtn: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 8,
    backgroundColor: 'rgba(18, 59, 74, 0.08)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  taskInfoBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: appTheme.colors.brand.primary,
  },
  infoModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  infoModalContent: {
    width: '90%',
    backgroundColor: '#FFF',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  infoModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  infoModalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: appTheme.colors.neutral.text,
    flex: 1,
  },
  infoModalScroll: {
    maxHeight: 320,
  },
  infoModalDesc: {
    fontSize: 14,
    color: appTheme.colors.neutral.textMuted,
    lineHeight: 22,
    fontWeight: '600',
  },
  infoModalCloseBtn: {
    marginTop: 24,
    backgroundColor: appTheme.colors.brand.primary,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: appTheme.colors.brand.primary,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  infoModalCloseText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  pickerIcon: {
    marginRight: 10,
  },
  pickerTextWrap: {
    flex: 1,
    justifyContent: 'center', // added for perfect centering
  },
  pickerText: {
    fontSize: 16,
    color: '#0F172A',
    fontWeight: '600',
    // Removed flex: 1 so text height is natural, guaranteeing perfect vertical alignment with the icon
  },
  pickerSubText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: '#64748B',
  },
  pickerPlaceholder: {
    color: '#94A3B8',
    fontWeight: '500',
  },
  dropdownWrap: {
    position: 'relative',
    zIndex: 999,
  },
  dropdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2500,
    justifyContent: 'flex-end',
  },
  dropdownBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  dropdownPanel: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderColor: '#E2E8F0',
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 18,
  },
  dropdownSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  dropdownSheetTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.2,
  },
  dropdownSheetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dropdownSheetCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  dropdownScrollContent: {
    paddingTop: 4,
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
    backgroundColor: '#FFF',
  },
  dropdownItemActive: {
    backgroundColor: '#F1F5F9',
  },
  dropdownItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
    flex: 1,
  },
  dropdownItemTitleActive: {
    color: '#123B4A',
    fontWeight: '800',
  },
  dropdownHint: {
    marginBottom: 6,
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  dropdownEmpty: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownEmptyText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
  optionalText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94A3B8',
  },
  mediaErrorText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  uploadDashedBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 0,
    shadowOpacity: 0,
  },
  uploadSmallText: {
    fontSize: 11,
    fontWeight: '600',
    color: appTheme.colors.brand.primary,
    marginTop: 4,
  },
  previewCard: {
    width: 60,
    height: 60,
    borderRadius: 10,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
    position: 'relative',
  },
  fullScreenPreviewBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    padding: 20,
  },
  previewCloseBtn: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  fullScreenImg: {
    flex: 1,
    width: '100%',
    marginBottom: 40,
  },
  previewImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compressingCard: {
    width: 70,
    height: 70,
    borderRadius: 10,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compressingText: {
    fontSize: 9,
    fontWeight: '700',
    color: appTheme.colors.brand.primary,
    marginTop: 3,
  },
  compressingCancelBtn: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(180, 35, 24, 0.10)',
  },
  compressingCancelText: {
    fontSize: 9,
    fontWeight: '800',
    color: appTheme.colors.status.danger,
    letterSpacing: 0.2,
  },
  removeMediaBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineToastWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: 14,
    zIndex: 50,
  },
  inlineToast: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 84,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    overflow: 'hidden',
  },
  inlineToastAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
  },
  inlineToastIcon: {
    marginRight: 12,
    marginTop: 1,
  },
  inlineToastTextWrap: {
    flex: 1,
    paddingRight: 4,
  },
  inlineToastTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  inlineToastText: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 6,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  submitBtn: {
    backgroundColor: appTheme.colors.brand.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 12,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

export default TaskActionModal;
