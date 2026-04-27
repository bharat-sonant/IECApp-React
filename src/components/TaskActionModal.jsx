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
  Platform,
  Image,
  StatusBar,
  Animated,
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

const TARGET_VIDEO_MAX_BYTES = 15 * 1024 * 1024;
const VIDEO_COMPRESSION_STEPS = [720, 640, 540, 480, 360, 240];
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

const compressionAttempts = (sourceInfo) => {
  const { fileSizeBytes, durationSeconds } = getVideoSourceInfo(sourceInfo);

  // 100MB+ ya 45 second se lambi file ke liye aggressive compression mode
  const isVeryLarge = fileSizeBytes > 100 * 1024 * 1024 || durationSeconds > 45;

  const attempts = VIDEO_COMPRESSION_STEPS.map((maxSize, index) => ({
    maxSize, // Video width/height scaling
    bitrate: isVeryLarge
      ? Math.max(120000, 500000 - index * 90000)
      : Math.max(180000, 800000 - index * 120000),
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
const compressVideoForUpload = async (videoUri, sourceInfo = {}) => {
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

    if (sourceDetails.fileSizeBytes > 100 * 1024 * 1024) {
    }

    const attempts = compressionAttempts(sourceDetails);
    let lastError = null;

    for (const attempt of attempts) {
      try {

        const compressedUri = await VideoCompressor.compress(safeUri, {
          compressionMethod: 'manual',
          maxSize: attempt.maxSize,
          bitrate: attempt.bitrate,
          minimumFileSizeForCompress: 0,
        });

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

        return {
          uri: compressedUri,
          sizeBytes: finalSizeBytes,
          wasCompressed: true,
          method: `Aggressive-Manual-${attempt.maxSize}`,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Compression से छोटी file नहीं बन सकी।');
  } catch (error) {
    throw error;
  }
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
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [ward, setWard] = useState('');
  const [participants, setParticipants] = useState('');
  const [remark, setRemark] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [inlineToast, setInlineToast] = useState(null);
  const inlineToastTimerRef = useRef(null);

  // Media states
  const [images, setImages] = useState([]);
  const [videos, setVideos] = useState([]);
  const [isCameraVisible, setIsCameraVisible] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);

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

  const showInlineToast = (message, variant = 'warning') => {
    if (inlineToastTimerRef.current) {
      clearTimeout(inlineToastTimerRef.current);
    }

    setInlineToast({ message, variant });
    inlineToastTimerRef.current = setTimeout(() => {
      setInlineToast(null);
    }, 2200);
  };

  const isVisibleTaskRecord = task => {
    if (!task || typeof task !== 'object') {
      return true;
    }

    const catalogTask =
      (task.catalogTask && typeof task.catalogTask === 'object'
        ? task.catalogTask
        : null) ||
      (task.raw?.catalogTask && typeof task.raw.catalogTask === 'object'
        ? task.raw.catalogTask
        : null);

    if (!catalogTask) {
      return true;
    }

    const isDeleted = String(
      catalogTask?.isDeleted ??
      catalogTask?.IsDeleted ??
      '',
    ).toLowerCase();

    if (isDeleted === 'yes') {
      return false;
    }

    const catalogStatus = String(
      catalogTask?.status ??
      catalogTask?.Status ??
      '',
    ).trim();

    return catalogStatus === '1';
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
      .filter(isVisibleTaskRecord),
    );
  }, [taskChoices]);

  const pickTaskOptions = useMemo(() => {
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
      .filter(isVisibleTaskRecord),
    );
  }, [taskOptions]);

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
            const taskState = getTaskState(item);
            if (taskState.hasState && !taskState.isActive) {
              return;
            }
            pushUnique(choices, {
              ...item,
              id: item.id ?? item.key ?? item.taskId ?? item.TaskId ?? index,
              taskId: getTaskIdCandidate(item) || null,
              priority: 'low',
              type: item.type ?? item.taskType ?? item.TaskType ?? 'KPI',
              originalPath: `IECData/IECKPITasks/${userId}/${index}`,
              catalogTask: taskState.catalogTask || null,
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
            const taskState = getTaskState(value);
            if (taskState.hasState && !taskState.isActive) {
              return;
            }
            pushUnique(choices, {
              ...value,
              id: value.id ?? value.key ?? value.taskId ?? value.TaskId ?? key,
              taskId: getTaskIdCandidate(value) || null,
              priority: 'low',
              type: value.type ?? value.taskType ?? value.TaskType ?? 'KPI',
              originalPath: `IECData/IECKPITasks/${userId}/${key}`,
              catalogTask: taskState.catalogTask || null,
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
      const payload = await getData('IECData/Tasks');
      const choices = [];

      collectOtherTaskChoices(choices, payload);

      return dedupeTaskOptions(choices);
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
      setDropdownOpen(false);
      return;
    }

    setSelectedTaskParam(item.title);
    setSelectedTaskMeta(item);
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

  const handleSave = async () => {
    if (isSaving) {
      return;
    }

    if (!selectedTaskParam) {
      setFieldErrors({ selectedTask: true });
      showInlineToast('Please select a task.', 'warning');
      return;
    }

    if (!remark.trim()) {
      setFieldErrors({ remark: true });
      showInlineToast('Remark / description is required.', 'warning');
      return;
    }

    if (!images.length) {
      setFieldErrors(prev => ({ ...prev, images: true }));
      showInlineToast(
        'Please capture at least one image before submitting.',
        'warning',
      );
      return;
    }

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
        participants: participants.trim(),
        remark: remark.trim(),
        images,
        videos,
        location: capturedLocation,
      });

      setFieldErrors({});
      showToast('Task details have been submitted.', 'success');
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
    if (images.length >= 5) {
      showInlineToast('You can only attach up to 5 images.', 'warning');
      return;
    }
    setIsCameraVisible(true);
  };

  const onPictureTaken = uri => {
    setImages(prev => [...prev, uri]);
    setFieldErrors(prev => ({ ...prev, images: false }));
  };

  const captureVideo = async () => {
    if (videos.length >= 2) {
      showInlineToast('आप केवल 2 वीडियो तक जोड़ सकते हैं।', 'warning');
      return;
    }
    setIsCompressing(true);
    try {
      beginAppStateSuppression(12000);
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
      const compressedVideo = await compressVideoForUpload(videoUri, {
        fileSize: activeVideoAsset.fileSize,
        duration: activeVideoAsset.duration,
        width: activeVideoAsset.width,
        height: activeVideoAsset.height,
      });
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
      showAlert({
        title: 'Video Upload Error',
        message: err?.message || 'वीडियो process नहीं हो पाया। कृपया दोबारा कोशिश करें।',
      });
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
  const dropdownSheetMaxHeight = Dimensions.get('window').height * 0.5;

  return (
    <>
      <ReusableCamera
        visible={isCameraVisible}
        onClose={() => setIsCameraVisible(false)}
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
                  <View
                    style={[
                      styles.inputGroup,
                      {
                        zIndex: 100,
                        ...(Platform.OS === 'android'
                          ? { elevation: dropdownOpen ? 10 : 0 }
                          : {}),
                      },
                    ]}
                  >
                    <View style={styles.labelRow}>
                      <Text style={styles.label}>
                        Task <Text style={styles.reqStar}>*</Text>
                      </Text>
                      {selectedTaskParam && (
                        <TouchableOpacity
                          style={styles.labelInfoBtn}
                          onPress={() => setInfoModalVisible(true)}
                          activeOpacity={0.7}
                        >
                          <MaterialCommunityIcons
                            name="information-outline"
                            size={14}
                            color={appTheme.colors.brand.primary}
                          />
                          <Text style={styles.labelInfoText}>View Details</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {mode !== 'pick_task' && (
                      <Text style={styles.dropdownHint}>
                        Tap the field to open the dropdown
                      </Text>
                    )}
                    {mode === 'pick_task' ? (
                      <View
                        style={[
                          styles.pickerSelector,
                          styles.pickerSelectorLocked,
                          fieldErrors.selectedTask ? styles.inputError : null,
                        ]}
                      >
                        <View style={styles.pickerContent}>
                          <MaterialCommunityIcons
                            name="clipboard-check-outline"
                            size={20}
                            color={appTheme.colors.brand.primary}
                            style={styles.pickerIcon}
                          />
                          <View style={styles.pickerTextWrap}>
                            <Text style={styles.pickerText}>
                              {selectedTaskParam || 'Selected task'}
                            </Text>
                          </View>
                        </View>
                        <MaterialCommunityIcons
                          name="lock-outline"
                          size={18}
                          color={appTheme.colors.neutral.textMuted}
                        />
                      </View>
                    ) : (
                      <View style={styles.dropdownWrap}>
                        <TouchableOpacity
                          style={[
                            styles.pickerSelector,
                            fieldErrors.selectedTask ? styles.inputError : null,
                          ]}
                          activeOpacity={0.7}
                          onPress={() => {
                            setDropdownOpen(prev => !prev);
                          }}
                        >
                          <View style={styles.pickerContent}>
                            <MaterialCommunityIcons
                              name="clipboard-check-outline"
                              size={20}
                              color={appTheme.colors.brand.primary}
                              style={styles.pickerIcon}
                            />
                            <View style={styles.pickerTextWrap}>
                              <Text
                                style={[
                                  styles.pickerText,
                                  !selectedTaskParam && styles.pickerPlaceholder,
                                ]}
                              >
                                {selectedTaskParam
                                  ? selectedTaskParam
                                  : getDropdownPlaceholder()}
                              </Text>
                            </View>

                          </View>
                          <MaterialCommunityIcons
                            name={dropdownOpen ? 'chevron-up' : 'chevron-down'}
                            size={22}
                            color={appTheme.colors.neutral.textMuted}
                          />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  <View style={styles.rowGrid}>
                    <View style={[styles.inputGroup, { flex: 1, marginRight: 12 }]}>
                      <Text style={styles.label}>
                        Ward No.
                      </Text>
                      <TextInput
                        style={[
                          styles.input,
                          fieldErrors.ward ? styles.inputError : null,
                        ]}
                        placeholder="Ex: 14A"
                        placeholderTextColor="#94A3B8"
                        value={ward}
                        onChangeText={updateField(setWard, 'ward')}
                        keyboardType="default"
                        editable={!isSaving}
                      />
                    </View>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.label}>
                        Participants
                      </Text>
                      <TextInput
                        style={[
                          styles.input,
                          fieldErrors.participants ? styles.inputError : null,
                        ]}
                        placeholder="Total count"
                        placeholderTextColor="#94A3B8"
                        value={participants}
                        onChangeText={updateField(setParticipants, 'participants')}
                        keyboardType="numeric"
                        editable={!isSaving}
                      />
                    </View>
                  </View>

                  <View style={styles.mediaSection}>
                    <View style={styles.mediaHeaderRow}>
                      <View>
                        <Text style={styles.mediaTitle}>Task Photos * (1 required)</Text>
                        <Text style={styles.mediaSubtitle}>
                          Take clear pictures of the work
                        </Text>
                      </View>
                      <Text style={styles.mediaCount}>{images.length} / 5</Text>
                    </View>

                    {fieldErrors.images ? (
                      <Text style={styles.mediaErrorText}>
                        At least one photo is required.
                      </Text>
                    ) : null}

                    <View style={styles.mediaGrid}>
                      {images.length < 5 && (
                        <TouchableOpacity
                          style={[styles.previewCard, styles.uploadDashedBox]}
                          activeOpacity={0.7}
                          onPress={captureImage}
                        >
                          <MaterialCommunityIcons
                            name="camera-plus"
                            size={32}
                            color={appTheme.colors.brand.primary}
                          />
                          <Text style={styles.uploadSmallText}>Add Photo</Text>
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

                  <View style={styles.mediaSection}>
                    <View style={styles.mediaHeaderRow}>
                      <View>
                        <Text style={styles.mediaTitle}>
                          Task Video{' '}
                          <Text style={styles.optionalText}>(Optional)</Text>
                        </Text>
                        <Text style={styles.mediaSubtitle}>
                          Keep it under 30 seconds
                        </Text>
                      </View>
                      <Text style={styles.mediaCount}>{videos.length} / 2</Text>
                    </View>

                    <View style={styles.mediaGrid}>
                      {isCompressing ? (
                        <View style={[styles.previewCard, styles.compressingCard]}>
                          <ActivityIndicator
                            size="large"
                            color={appTheme.colors.brand.primary}
                          />
                          <Text style={styles.compressingText}>Compressing...</Text>
                        </View>
                      ) : (
                        videos.length < 2 && (
                          <TouchableOpacity
                            style={[styles.previewCard, styles.uploadDashedBox]}
                            activeOpacity={0.7}
                            onPress={captureVideo}
                          >
                            <MaterialCommunityIcons
                              name="video-plus"
                              size={32}
                              color={appTheme.colors.brand.primary}
                            />
                            <Text style={styles.uploadSmallText}>Add Video</Text>
                          </TouchableOpacity>
                        )
                      )}

                      {videos.map((videoItem, index) => (
                        <View key={`video-preview-${index}`} style={styles.previewCard}>
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

                  <View style={styles.divider} />

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>
                      Remarks / Description <Text style={styles.reqStar}>*</Text>
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        styles.textArea,
                        fieldErrors.remark ? styles.inputError : null,
                      ]}
                      placeholder="Write observation details here..."
                      placeholderTextColor="#94A3B8"
                      multiline
                      numberOfLines={4}
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
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 20,
    paddingTop: 24,
  },
  inputGroup: {
    marginBottom: 20,
  },
  rowGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  labelInfoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 59, 74, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  labelInfoText: {
    fontSize: 11,
    fontWeight: '700',
    color: appTheme.colors.brand.primary,
  },
  reqStar: {
    color: '#EF4444',
  },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#0F172A',
    minHeight: 56,
  },
  inputError: {
    borderColor: '#DC3545',
    backgroundColor: 'rgba(220, 53, 69, 0.04)',
  },
  textArea: {
    minHeight: 120,
    paddingTop: 16,
    paddingBottom: 16,
  },
  pickerSelector: {
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 16,
    minHeight: 56,
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
    paddingBottom: 20, // Extra padding so the last item isn't cut off inside constrained scrollview
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
  divider: {
    height: 1.5,
    backgroundColor: '#E2E8F0',
    marginVertical: 24,
  },
  mediaSection: {
    marginBottom: 28,
  },
  mediaHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  mediaTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  optionalText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  mediaSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  mediaErrorText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  mediaCount: {
    fontSize: 12,
    fontWeight: '700',
    color: appTheme.colors.brand.primary,
    backgroundColor: 'rgba(18, 59, 74, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: 8,
    paddingBottom: 4,
  },
  uploadDashedBox: {
    borderWidth: 2,
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
    fontWeight: '700',
    color: appTheme.colors.brand.primary,
    marginTop: 6,
  },
  previewCard: {
    width: 100,
    height: 100,
    borderRadius: 16,
    marginRight: 12,
    marginBottom: 12,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
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
    width: 100,
    height: 100,
    borderRadius: 16,
    marginRight: 12,
    marginBottom: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compressingText: {
    fontSize: 10,
    fontWeight: '700',
    color: appTheme.colors.brand.primary,
    marginTop: 6,
  },
  removeMediaBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.6)',
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
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 10,
  },
  submitBtn: {
    backgroundColor: appTheme.colors.brand.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: 16,
  },
  submitBtnDisabled: {
    opacity: 0.72,
  },
  submitBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
});

export default TaskActionModal;
