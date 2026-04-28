import React, { useEffect, useMemo, useState } from 'react';
import {
  InteractionManager,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TouchableWithoutFeedback,
  AppState,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import appTheme from '../theme/appTheme';
import CommonLoader from '../components/CommonLoader';
import { getData } from '../firebase/firebaseService';
import { FIREBASE_CONFIG, getCityStoragePrefix } from '../firebase/firebaseConfig';
import {
  clearLoginSession,
  loadLoginSession,
} from '../services/sessionService';
import { clearSharedMediaFiles } from '../services/sharedMediaService';
import { clearMediaCache } from '../services/mediaCacheService';
import { useAppFeedback } from '../components/AppFeedback';
import { useLocation } from '../context/LocationContext';
import {
  saveDashboardTaskCache,
  readTaskCatalogCache,
  saveTaskCatalogCache,
  clearTaskCache,
} from '../services/taskCacheService';

const isPlainObject = value =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasTaskData = value => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (!isPlainObject(value)) {
    return false;
  }

  return Object.keys(value).length > 0;
};

const getFirstText = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
  }

  return '';
};

const formatCompletionDate = value => {
  const text = getFirstText(value);
  if (!text) {
    return '';
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  const day = String(parsed.getDate()).padStart(2, '0');
  const month = parsed.toLocaleString('en-US', { month: 'short' });
  const year = parsed.getFullYear();
  const hours24 = parsed.getHours();
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  const hours12 = hours24 % 12 || 12;
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';

  return `${day} ${month} ${year} ${String(hours12).padStart(2, '0')}:${minutes} ${meridiem}`;
};

const getCompletionDisplayValue = task =>
  getFirstText(
    task?.raw?._at,
    task?.taskDate,
    task?.completedAt,
    task?.raw?.approvedAt,
    task?.raw?.createdAt,
    task?.raw?.updatedAt,
  );

const resolveTaskStatus = task => {
  const approvedRaw = getFirstText(
    task?.approvedStatus,
    task?.ApprovedStatus,
    task?.approvalStatus,
    task?.ApprovalStatus,
  ).toLowerCase();

  if (approvedRaw) {
    return approvedRaw === '0' || approvedRaw === 'false'
      ? 'Not Approved'
      : 'Approved';
  }

  const rawStatus = getFirstText(
    task?.status,
    task?.Status,
    task?.taskStatus,
    task?.TaskStatus,
  ).toLowerCase();
  if (!rawStatus) {
    return 'Pending';
  }

  if (rawStatus.includes('approve')) {
    return 'Approved';
  }

  if (
    rawStatus === '1' ||
    rawStatus.includes('complete') ||
    rawStatus.includes('done')
  ) {
    return 'Completed';
  }

  if (rawStatus.includes('reject') || rawStatus.includes('not approved')) {
    return 'Not Approved';
  }

  return 'Pending';
};

const resolveTaskPriority = task => {
  const rawPriority = getFirstText(
    task?.priority,
    task?.Priority,
    task?.taskPriority,
    task?.TaskPriority,
    task?.importance,
    task?.Importance,
  ).toLowerCase();

  if (!rawPriority) {
    return 'Medium';
  }

  if (rawPriority.includes('high')) {
    return 'High';
  }

  if (rawPriority.includes('low')) {
    return 'Low';
  }

  if (rawPriority.includes('medium')) {
    return 'Medium';
  }

  return rawPriority.charAt(0).toUpperCase() + rawPriority.slice(1);
};

const buildTaskTitle = task => {
  return (
    getFirstText(
      task?.title,
      task?.Title,
      task?.task,
      task?.Task,
      task?.taskTitle,
      task?.TaskTitle,
      task?.taskName,
      task?.TaskName,
      task?.name,
      task?.Name,
      task?.subject,
      task?.Subject,
      task?.description,
      task?.Description,
      task?.remarks,
      task?.Remarks,
    ) || 'Untitled Task'
  );
};

const buildTaskType = (task, fallbackType) => {
  return (
    getFirstText(
      task?.type,
      task?.Type,
      task?.taskType,
      task?.TaskType,
      task?.category,
      task?.Category,
    ) || fallbackType
  );
};

const getGreetingByHour = hour => {
  const safeHour = Number.isFinite(hour) ? hour : new Date().getHours();

  if (safeHour >= 5 && safeHour < 12) {
    return 'Good Morning,';
  }

  if (safeHour >= 12 && safeHour < 17) {
    return 'Good Afternoon,';
  }

  if (safeHour >= 17 && safeHour < 21) {
    return 'Good Evening,';
  }

  return 'Good Night,';
};

// resolveLeafTitle definition
const resolveLeafTitle = task =>
  getFirstText(
    task?.task,
    task?.Task,
    task?.title,
    task?.TaskTitle,
    task?.taskName,
    task?.TaskName,
    task?.name,
    task?.Name,
  ) || buildTaskTitle(task);

const isMeaningfulTaskTitle = value => {
  const text = getFirstText(value);
  if (!text) {
    return false;
  }
  return text.toLowerCase() !== 'untitled task';
};

const getDashboardDisplayTitle = task => {
  const directTitle = getFirstText(
    task?.title,
    task?.TaskTitle,
    task?.taskName,
    task?.TaskName,
    task?.name,
    task?.Name,
  );
  const rawTitle = resolveLeafTitle(task?.raw);
  const catalogTitle = resolveLeafTitle(task?.catalogEntry);
  return (
    (isMeaningfulTaskTitle(directTitle) ? directTitle : '') ||
    (isMeaningfulTaskTitle(rawTitle) ? rawTitle : '') ||
    (isMeaningfulTaskTitle(catalogTitle) ? catalogTitle : '') ||
    'Untitled Task'
  );
};


const resolveLeafDescription = task =>
  getFirstText(
    task?.remark,
    task?.Remark,
    task?.remarks,
    task?.Remarks,
    task?.desc,
    task?.Desc,
    task?.description,
    task?.Description,
    task?.details,
    task?.Details,
  );

const resolveTaskCategory = task => {
  const raw = getFirstText(
    task?.taskCategory,
    task?.TaskCategory,
    task?.category,
    task?.Category,
  ).toLowerCase();

  if (!raw) {
    // Fallback to sourceLabel
    const sourceLabel = getFirstText(task?.sourceLabel).toLowerCase();
    if (sourceLabel === 'priority') return 'Priority';
    if (sourceLabel === 'kpi') return 'KPI';
    return 'Other';
  }
  if (raw.includes('kpi')) return 'KPI';
  if (raw.includes('priority')) return 'Priority';
  return 'Other';
};

const extractUserId = taskData => {
  if (!taskData) return '';
  return getFirstText(
    taskData?.userId,
    taskData?.userID,
    taskData?.createdBy,
    taskData?.loginId,
    taskData?.employeeId,
  );
};

const resolveTaskTag = task => {
  const category = resolveTaskCategory(task).toLowerCase();
  if (category === 'kpi') {
    return 'KPI';
  }

  if (category === 'priority') {
    return 'Priority';
  }

  if (category === 'other') {
    return 'Other';
  }

  const source = getFirstText(task?.sourceLabel).toLowerCase();
  if (source === 'priority') {
    return 'Priority';
  }

  if (source === 'kpi') {
    return 'KPI';
  }

  return 'Other';
};

const resolveTaskPriorityChip = task => {
  const tag = resolveTaskTag(task);
  if (tag === 'Priority') {
    return 'High';
  }

  if (tag === 'KPI') {
    return 'Medium';
  }

  return 'Low';
};

const resolveCatalogTaskTitle = (catalog, taskKey) => {
  if (!taskKey || !catalog || typeof catalog !== 'object') {
    return '';
  }

  const entry = catalog[taskKey];
  if (!entry) {
    return '';
  }

  if (typeof entry === 'string') {
    return entry.trim();
  }

  return getFirstText(
    entry?.name,
    entry?.title,
    entry?.taskName,
    entry?.TaskName,
    entry?.label,
  );
};

const normalizeTaskStateValue = value =>
  String(value ?? '')
    .trim()
    .toLowerCase();

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
      node.taskID,
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

const isCatalogTaskVisible = catalogTask => {
  if (!catalogTask || typeof catalogTask !== 'object') {
    return false;
  }

  const deleteState = normalizeTaskStateValue(
    catalogTask?.isDeleted ??
      catalogTask?.IsDeleted ??
      catalogTask?.isDelete ??
      catalogTask?.IsDelete ??
      catalogTask?.deleted ??
      catalogTask?.Deleted ??
      catalogTask?.deletedFlag ??
      catalogTask?.DeletedFlag ??
      catalogTask?.removeFlag ??
      catalogTask?.RemoveFlag ??
      catalogTask?.removed ??
      catalogTask?.Removed,
  );

  if (deleteState && hasTruthyTaskState(deleteState)) {
    return false;
  }

  const statusState = normalizeTaskStateValue(
    catalogTask?.status ??
      catalogTask?.Status ??
      catalogTask?.taskStatus ??
      catalogTask?.TaskStatus ??
      catalogTask?.state ??
      catalogTask?.State ??
      catalogTask?.active ??
      catalogTask?.Active ??
      catalogTask?.isActive ??
      catalogTask?.IsActive ??
      catalogTask?.enabled ??
      catalogTask?.Enabled ??
      catalogTask?.visible ??
      catalogTask?.Visible,
  );

  if (!statusState) {
    return true;
  }

  if (hasTruthyTaskState(statusState)) {
    return true;
  }

  return !hasFalsyTaskState(statusState);
};

const normalizeIdentityText = (...values) =>
  getFirstText(...values)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const buildTaskIdentity = task => {
  const taskId = normalizeIdentityText(
    task?.resolvedTaskId,
    task?.id,
    task?.taskKey,
    task?.raw?.taskId,
    task?.raw?.TaskId,
    task?.raw?.id,
    task?.raw?.Id,
  );
  if (taskId) {
    return `taskId:${taskId}`;
  }

  const wardNo = normalizeIdentityText(
    task?.resolvedWardNo,
    task?.raw?.wardNo,
    task?.raw?.WardNo,
  );
  const title = normalizeIdentityText(
    task?.title,
    task?.raw?.title,
    task?.raw?.Title,
    task?.raw?.task,
    task?.raw?.Task,
    task?.raw?.taskName,
    task?.raw?.TaskName,
  );

  if (wardNo && title) {
    return `ward:${wardNo}|title:${title}`;
  }

  if (title) {
    return `title:${title}`;
  }

  const pathIdentity = normalizeIdentityText(
    task?.originalPath,
    task?.raw?.originalPath,
  );
  return pathIdentity ? `path:${pathIdentity}` : '';
};

const buildDashboardDisplayIdentity = task => {
  const category = resolveTaskCategory(task).toLowerCase();
  let baseIdentity = buildTaskIdentity(task);

  if (task.leafKey) {
    baseIdentity = `${baseIdentity}|leaf:${task.leafKey}`;
  }

  if (category === 'other') {
    return `other:${baseIdentity || normalizeIdentityText(task?.title, task?.taskDate, task?.raw?._at, task?.raw?.approvedAt)}`;
  }

  return (
    baseIdentity ||
    normalizeIdentityText(
      task?.title,
      task?.taskDate,
      task?.raw?._at,
      task?.raw?.approvedAt,
    )
  );
};

const getTaskTimestamp = task => {
  const source = task?.raw && typeof task.raw === 'object' ? task.raw : task;
  const candidates = [
    source?.approvedAt,
    source?.ApprovedAt,
    source?._at,
    source?.createdAt,
    source?.CreatedAt,
    source?.updatedAt,
    source?.UpdatedAt,
    task?.taskDate,
  ];

  for (const value of candidates) {
    const text = getFirstText(value);
    if (!text) {
      continue;
    }

    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
};

const buildCurrentStatusMap = tasks => {
  const map = new Map();

  tasks.forEach(task => {
    if (!task || resolveTaskCategory(task).toLowerCase() === 'other') {
      return;
    }

    const identity = buildTaskIdentity(task);
    if (!identity) {
      return;
    }

    const existing = map.get(identity);
    if (!existing || getTaskTimestamp(task) >= getTaskTimestamp(existing)) {
      map.set(identity, task);
    }
  });

  return map;
};

const isTaskApproved = task => {
  const source = task?.raw && typeof task.raw === 'object' ? task.raw : task;
  const approvedStatus = getFirstText(
    source?.approvedStatus,
    source?.ApprovedStatus,
    source?.approvalStatus,
    source?.ApprovalStatus,
  ).toLowerCase();
  const approvedBy = getFirstText(source?.approvedBy, source?.ApprovedBy);
  const approvedAt = getFirstText(source?.approvedAt, source?.ApprovedAt);

  if (approvedBy || approvedAt) {
    return true;
  }

  return approvedStatus.includes('approve');
};

const applyCurrentStatusMap = (tasks, currentStatusMap) =>
  tasks
    .filter(task => {
      const identity = buildTaskIdentity(task);
      const currentTask = identity ? currentStatusMap.get(identity) : null;
      return !currentTask || !isTaskApproved(currentTask);
    })
    .map(task => {
      const identity = buildTaskIdentity(task);
      const currentTask = identity ? currentStatusMap.get(identity) : null;

      if (!currentTask) {
        return task;
      }

      return {
        ...task,
        status: 'Completed',
        taskDate: getFirstText(
          currentTask.raw?._at,
          currentTask.taskDate,
          task.taskDate,
        ),
        raw: currentTask.raw || task.raw,
        completedAt: getFirstText(
          currentTask.raw?._at,
          currentTask.raw?.createdAt,
          currentTask.raw?.updatedAt,
          task.completedAt,
        ),
        leafKey: currentTask.leafKey,
      };
    });

const buildDisplayableCurrentTasks = tasks =>
  tasks
    .filter(task => !isTaskApproved(task))
    .map(task => ({
      ...task,
      status: 'Completed',
      sourceLabel: 'Current',
      taskDate: getFirstText(task.taskDate, task.raw?._at) || task.taskDate,
    }));

// Filter to show only active (non-deleted) tasks
// Check status and isDeleted from task catalog (IECData/Tasks)
const filterActiveTasks = (tasks, taskCatalog = {}) => {
  if (!Array.isArray(tasks)) return [];

  return tasks.filter(task => {
    const taskId = task.taskId || task.resolvedTaskId || task.id;
    const catalogTask = resolveCatalogTaskRecord(taskCatalog, taskId);

    if (!catalogTask) {
      return !taskCatalog || Object.keys(taskCatalog).length === 0;
    }

    return isCatalogTaskVisible(catalogTask);
  });
};

const getTaskStatusRank = status => {
  const normalized = getFirstText(status).toLowerCase();
  if (normalized.includes('completed')) return 3;
  if (normalized.includes('approved')) return 2;
  if (normalized.includes('not approved') || normalized.includes('rejected'))
    return 1;
  if (normalized.includes('pending')) return 0;
  return 0;
};

const mergeDashboardTask = (existing, incoming) => {
  if (!existing) {
    return incoming;
  }

  const existingRank = getTaskStatusRank(existing.status);
  const incomingRank = getTaskStatusRank(incoming.status);
  const existingTime = getTaskTimestamp(existing);
  const incomingTime = getTaskTimestamp(incoming);

  const preferred =
    incomingRank > existingRank ||
      (incomingRank === existingRank && incomingTime >= existingTime)
      ? { ...existing, ...incoming }
      : { ...incoming, ...existing };

  if (!preferred.title) {
    preferred.title = existing.title || incoming.title;
  }

  if (!preferred.type) {
    preferred.type = existing.type || incoming.type;
  }

  if (!preferred.priority) {
    preferred.priority = existing.priority || incoming.priority;
  }

  if (!preferred.sourceLabel) {
    preferred.sourceLabel = existing.sourceLabel || incoming.sourceLabel;
  }

  if (!preferred.taskCategory) {
    preferred.taskCategory = existing.taskCategory || incoming.taskCategory;
  }

  return preferred;
};

const dedupeDashboardTasks = tasks => {
  const merged = new Map();

  tasks.forEach(task => {
    if (!task) {
      return;
    }

    const identity = buildDashboardDisplayIdentity(task);
    if (!identity) {
      return;
    }

    const existing = merged.get(identity);
    merged.set(identity, existing ? mergeDashboardTask(existing, task) : task);
  });

  return Array.from(merged.values());
};

const getDashboardTaskOrderRank = task => {
  const tag = resolveTaskTag(task);
  if (tag === 'Priority') return 0;
  if (tag === 'KPI') return 1;
  return 2;
};

const TASK_FIELD_KEYS = new Set([
  '_at',
  'address',
  'approvedAt',
  'approvedBy',
  'approvedStatus',
  'ApprovedStatus',
  'approvalStatus',
  'ApprovalStatus',
  'completionStatus',
  'CompletionStatus',
  'date',
  'Date',
  'image1',
  'image2',
  'image3',
  'image4',
  'image5',
  'latLng',
  'noOfParticipants',
  'remark',
  'status',
  'Status',
  'taskCategory',
  'taskStatus',
  'TaskStatus',
  'taskType',
  'TaskType',
  'taskName',
  'TaskName',
  'name',
  'Name',
  'title',
  'Title',
  'type',
  'Type',
  'wardNo',
  'video1',
  'video2',
  'mediaKey',
  'mediaCount',
]);

const isTaskLeafNode = item => {
  if (!isPlainObject(item)) {
    return false;
  }

  return Object.keys(item).some(key => TASK_FIELD_KEYS.has(key));
};

const buildTaskFromPrimitive = (
  item,
  key,
  index,
  fallbackType,
  sourceLabel,
  rootPath = '',
  nextPath = '',
) => {
  const title = getFirstText(item) || 'Untitled Task';

  return {
    id: getFirstText(key, `${sourceLabel}-${index}`),
    listKey: `${sourceLabel}:${getFirstText(key, `${sourceLabel}-${index}`)}`,
    title,
    status: 'Pending',
    type: fallbackType,
    priority: 'Medium',
    sourceLabel,
    taskCategory: sourceLabel,
    taskDate: '',
    raw: item,
    resolvedTaskId: getFirstText(key, `${sourceLabel}-${index}`),
    resolvedWardNo: '',
    originalPath: rootPath && nextPath ? `${rootPath}/${nextPath}` : null,
  };
};

const buildStorageUrl = (
  path,
  type = 'media',
  taskData = null,
) => {
  if (!path) return null;
  if (path.startsWith('http')) return path;

  // Construct full path from filename + task data
  let fullPath = path;

  if (!path.includes('IECData/') && taskData) {
    const userId = getFirstText(taskData.userId, taskData.loginId);
    const taskId = getFirstText(taskData.taskId, taskData.id);
    const itemKey = getFirstText(taskData.mediaKey, taskData.mediaCount, '1');
    const dateStr = getFirstText(taskData._at, taskData.date);

    if (dateStr && userId && taskId) {
      const parts = dateStr.split(' ')[0].split('-');
      if (parts.length >= 3) {
        const year = parts[0];
        const monthNum = parseInt(parts[1], 10);
        const monthNames = [
          'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const month = monthNames[monthNum - 1];
        const day = parts[2];
        const isoDate = `${year}-${parts[1]}-${day}`;

        if (type === 'video') {
          fullPath = `${getCityStoragePrefix(FIREBASE_CONFIG)}IECData/IECTasksVideos/${userId}/${year}/${month}/${isoDate}/${taskId}/${itemKey}/${path}`;
        } else {
          fullPath = `${getCityStoragePrefix(FIREBASE_CONFIG)}IECData/IECTasksImages/${userId}/${year}/${month}/${isoDate}/${taskId}/${itemKey}/${path}`;
        }
      }
    }
  }

  const encodedPath = encodeURIComponent(fullPath);
  const bucket = FIREBASE_CONFIG?.storageBucket || 'devtest-62768.firebasestorage.app';
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
};

const flattenTaskNode = (
  value,
  fallbackType,
  sourceLabel,
  rootPath = '',
  taskCatalog = null,
) => {
  const seen = new Set();

  const walk = (node, trail = []) => {
    if (node === null || node === undefined) {
      return [];
    }

    const entries = Array.isArray(node)
      ? node
        .map((item, index) => [String(index), item])
        .filter(([, item]) => item !== null && item !== undefined)
      : isPlainObject(node)
        ? Object.entries(node)
        : [];

    return entries.flatMap(([key, item], index) => {
      if (key === 'lastKey') {
        return [];
      }

      const nextTrail = [...trail, key];
      const nextPath = nextTrail.join('/');

      if (Array.isArray(item) || isPlainObject(item)) {
        if (isTaskLeafNode(item)) {
          const leafKey = getFirstText(key, `${sourceLabel}-${index}`);
          let fallbackId = key;
          let fallbackWardNo = '';
          if (sourceLabel?.includes('Current')) {
            fallbackId =
              nextTrail.length >= 2 ? nextTrail[nextTrail.length - 2] : key;
          } else if (sourceLabel?.includes('Priority')) {
            const parentKey =
              nextTrail.length >= 2 ? nextTrail[nextTrail.length - 2] : key;
            fallbackId = parentKey;
            fallbackWardNo = parentKey;
          }
          const resolvedTaskId = getFirstText(
            item?.taskId,
            item?.TaskId,
            item?.id,
            item?.Id,
            fallbackId,
          );
          const resolvedWardNo = getFirstText(
            item?.wardNo,
            item?.WardNo,
            fallbackWardNo,
          );
          const taskKey = getFirstText(fallbackId, key);
          const id = getFirstText(
            item?.taskId,
            item?.TaskId,
            item?.id,
            item?.Id,
            fallbackId,
            `${sourceLabel}-${index}`,
          );
          const catalogTask =
            resolveCatalogTaskRecord(taskCatalog, resolvedTaskId) ||
            resolveCatalogTaskRecord(taskCatalog, taskKey) ||
            resolveCatalogTaskRecord(taskCatalog, leafKey) ||
            resolveCatalogTaskRecord(taskCatalog, id);
          const title =
            resolveLeafTitle(item) ||
            resolveLeafTitle(catalogTask) ||
            resolveCatalogTaskTitle(taskCatalog, resolvedTaskId) ||
            resolveCatalogTaskTitle(taskCatalog, taskKey) ||
            resolveCatalogTaskTitle(taskCatalog, leafKey) ||
            resolveCatalogTaskTitle(taskCatalog, id) ||
            resolvedTaskId ||
            id;
          const status = resolveTaskStatus(item);
          const priority = resolveTaskPriority(item);
          const type = buildTaskType(item, fallbackType);
          const taskCategory = sourceLabel === 'Priority' ? 'Priority' :
            sourceLabel === 'KPI' ? 'KPI' :
              resolveTaskCategory(item) || sourceLabel;
          const hasApprovalMeta = Boolean(
            getFirstText(
              item?.approvedBy,
              item?.ApprovedBy,
              item?.approvedAt,
              item?.ApprovedAt,
            ),
          );
          const resolvedStatus =
            sourceLabel === 'Current'
              ? hasApprovalMeta
                ? 'Approved'
                : 'Completed'
              : status;
          const taskDate = getFirstText(
            item?.date,
            item?.Date,
            item?.taskDate,
            item?.TaskDate,
            item?.createdOn,
            item?.CreatedOn,
            item?.updatedOn,
            item?.UpdatedOn,
            item?.approvedAt,
          );

          const mediaContext = {
            userId: extractUserId(item) || '',
            taskId: resolvedTaskId,
            mediaKey: key,
            date: taskDate,
            _at: getFirstText(item?._at, taskDate),
          };

          const imageKeys = Object.keys(item).filter(name => /^image\d+$/i.test(name));
          const videoKeys = Object.keys(item).filter(name => /^video\d+$/i.test(name));

          const imageUrls = imageKeys
            .map(k => buildStorageUrl(item[k], 'image', mediaContext))
            .filter(Boolean);
          const videoUrls = videoKeys
            .map(k => buildStorageUrl(item[k], 'video', mediaContext))
            .filter(Boolean);

          const signature = `${sourceLabel}:${nextPath}:${id}:${title}:${status}:${type}`;
          if (seen.has(signature)) {
            return [];
          }
          seen.add(signature);

          return [
            {
              id,
              resolvedTaskId,
              resolvedWardNo,
              taskKey,
              leafKey,
              listKey: `${sourceLabel}:${nextPath}:${id}`,
              title,
              status: resolvedStatus,
              type,
              priority,
              sourceLabel,
              taskCategory,
              taskDate,
              imageUrls,
              videoUrls,
              images: imageUrls.length,
              videos: videoUrls.length,
              description: resolveLeafDescription(item),
              raw: item,
              originalPath:
                rootPath && nextPath ? `${rootPath}/${nextPath}` : null,
            },
          ];
        }

        return walk(item, nextTrail);
      }

      const taskKey = getFirstText(
        nextTrail.length >= 2 ? nextTrail[nextTrail.length - 2] : '',
        key,
      );
      const primitiveTitle =
        getFirstText(item) ||
        resolveCatalogTaskTitle(taskCatalog, taskKey) ||
        taskKey;
      if (!primitiveTitle) {
        return [];
      }

      const id = getFirstText(key, `${sourceLabel}-${index}`);
      const signature = `${sourceLabel}:${nextPath}:${id}:${primitiveTitle}:Pending:${fallbackType}`;
      if (seen.has(signature)) {
        return [];
      }
      seen.add(signature);

      return [
        buildTaskFromPrimitive(
          primitiveTitle,
          key,
          index,
          fallbackType,
          sourceLabel,
          rootPath,
          nextPath,
        ),
      ];
    });
  };

  return walk(value);
};

const mergeAssignedTasks = (...taskGroups) => {
  const merged = new Map();

  taskGroups.flat().forEach(task => {
    if (!task) return;

    const explicitId = getFirstText(task.resolvedTaskId);
    const explicitWard = getFirstText(task.resolvedWardNo);
    const explicitTitle = getFirstText(task.title).toLowerCase();
    const pathIdentity = getFirstText(
      task.originalPath,
      task.raw?.originalPath,
    );

    let identity = buildTaskIdentity(task);
    if (!identity) {
      if (explicitWard && explicitId) {
        identity = `ward:${normalizeIdentityText(explicitWard)}|task:${normalizeIdentityText(explicitId)}`;
      } else if (explicitId) {
        identity = `task:${normalizeIdentityText(explicitId)}`;
      } else if (explicitTitle) {
        identity = `title:${normalizeIdentityText(explicitTitle)}`;
      } else if (pathIdentity) {
        identity = `path:${normalizeIdentityText(pathIdentity)}`;
      }
    }

    if (!identity) return;

    const existing = merged.get(identity);
    if (!existing) {
      merged.set(identity, task);
      return;
    }

    const currentRank = getTaskStatusRank(task.status);
    const existingRank = getTaskStatusRank(existing.status);
    const preferred = { ...existing };

    if (currentRank > existingRank) {
      preferred.status = task.status;
      preferred.taskDate = task.taskDate || preferred.taskDate;
      preferred.raw = preferred.raw || task.raw;
    }

    if (!preferred.title) {
      preferred.title = task.title;
    }

    if (!preferred.type) {
      preferred.type = task.type;
    }

    if (!preferred.priority) {
      preferred.priority = task.priority;
    }

    if (!preferred.sourceLabel) {
      preferred.sourceLabel = task.sourceLabel;
    }

    merged.set(identity, preferred);
  });

  return Array.from(merged.values());
};

const getCurrentDateParts = () => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1);
  const monthPadded = month.padStart(2, '0');
  const monthName = now.toLocaleString('en-US', { month: 'long' });
  const day = String(now.getDate());
  const dayPadded = day.padStart(2, '0');
  const isoDate = `${year}-${monthPadded}-${dayPadded}`;

  return {
    year,
    monthName,
    day,
    dayPadded,
    isoDate,
  };
};

const readFirstExistingPath = async paths => {
  for (const path of paths) {
    const value = await getData(path);
    if (hasTaskData(value)) {
      return { path, value };
    }
  }
  return { path: null, value: null };
};

const STATUS_META = {
  Pending: {
    label: 'Pending',
    backgroundColor: '#FFF4E5',
    textColor: appTheme.colors.brand.accent,
    icon: 'clock-outline',
  },
  Completed: {
    label: 'Completed',
    backgroundColor: '#E8F5E9',
    textColor: appTheme.colors.status.success,
    icon: 'check-circle-outline',
  },
  Approved: {
    label: 'Approved',
    backgroundColor: '#E8F5E9',
    textColor: appTheme.colors.status.success,
    icon: 'check-decagram-outline',
  },
  'Not Approved': {
    label: 'Not Approved',
    backgroundColor: '#FDECEA',
    textColor: appTheme.colors.status.danger,
    icon: 'close-circle-outline',
  },
};

const DashboardScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const {
    stopTracking,
    startTracking,
    isIgnoringBatteryOptimizations,
    requestIgnoreBatteryOptimizations,
  } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const syncHour = () => {
      setCurrentHour(new Date().getHours());
    };

    syncHour();
    const timerId = setInterval(syncHour, 60 * 1000);

    return () => {
      clearInterval(timerId);
    };
  }, []);

  const [fabOpen, setFabOpen] = useState(false);
  const [actionModalVisible, setActionModalVisible] = useState(false);
  const [actionModalMode, setActionModalMode] = useState('add_kpi');
  const [actionModalTask, setActionModalTask] = useState(null);
  const [employeeName, setEmployeeName] = useState('Employee');
  const [loginId, setLoginId] = useState('');
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [tasksRefreshing, setTasksRefreshing] = useState(false);
  const [tasksReloadToken, setTasksReloadToken] = useState(0);
  const [batteryPromptChecked, setBatteryPromptChecked] = useState(false);
  const [trackingPermissionGranted, setTrackingPermissionGranted] = useState(false);
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours());
  const { showAlert } = useAppFeedback();
  const TaskActionModal = actionModalVisible
    ? require('../components/TaskActionModal').default
    : null;
  const backgroundPermissionPromptShownRef = React.useRef(false);

  const runAfterGesture = callback => {
    requestAnimationFrame(() => {
      setTimeout(callback, 0);
    });
  };

  useEffect(() => {
  }, [
    actionModalMode,
    actionModalTask,
    actionModalVisible,
    employeeName,
    fabOpen,
    loginId,
    menuOpen,
    tasks.length,
    tasksError,
    tasksLoading,
  ]);

  const metrics = useMemo(() => {
    const pendingCount = tasks.filter(task => task.status === 'Pending').length;
    const completedCount = tasks.filter(
      task => task.status === 'Completed' || task.status === 'Approved',
    ).length;
    return {
      total: tasks.length,
      pending: pendingCount,
      completed: completedCount,
    };
  }, [tasks]);

  const greetingText = useMemo(() => getGreetingByHour(currentHour), [currentHour]);

  useEffect(() => {
    console.log(
      '[DashboardScreen] task list snapshot',
      tasks.map((task, index) => ({
        index,
        id: task?.id || '',
        resolvedTaskId: task?.resolvedTaskId || '',
        taskKey: task?.taskKey || '',
        leafKey: task?.leafKey || '',
        title: task?.title || '',
        taskName: task?.taskName || task?.TaskName || '',
        name: task?.name || task?.Name || '',
        rawTitle: task?.raw?.title || task?.raw?.taskName || task?.raw?.name || '',
        status: task?.status || '',
        taskCategory: task?.taskCategory || '',
        sourceLabel: task?.sourceLabel || '',
      })),
    );
  }, [tasks]);

  useEffect(() => {
    let isActive = true;
    const startedAt = Date.now();

    const hydrateSession = async () => {
      try {
        const session = await loadLoginSession();
        if (!isActive || !session) {
          return;
        }

        const resolvedName =
          session.loggedInName ||
          session.employee?.name ||
          session.employee?.Name ||
          session.employee?.employeeName ||
          session.employee?.fullName ||
          session.loginId ||
          'Employee';

        setEmployeeName(resolvedName);
        setLoginId(
          session.loginId ||
          session.employee?.userId ||
          session.employee?.id ||
          '',
        );
      } catch {
        if (isActive) {
          setEmployeeName('Employee');
          setLoginId('');
        }
      }
    };

    hydrateSession();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    const startedAt = Date.now();

    const loadTasks = async () => {
      if (!loginId) {
        if (isActive) {
          setTasks([]);
          setTasksError('');
          setTasksLoading(false);
        }
        return;
      }

      setTasksLoading(true);
      setTasksError('');

      const dateParts = getCurrentDateParts();

      // 1. Try to load from cache first for instant UI
      try {
        const cached = await readDashboardTaskCache(loginId, dateParts.isoDate);
        if (cached && cached.tasks && isActive) {
          setTasks(cached.tasks);
          // If we have cache, we still fetch in background but maybe don't show full loader
        }
      } catch (e) {
      }

      try {
        const kpiPaths = [`IECData/IECKPITasks/${loginId}`];
        const priorityPaths = [
          `IECData/IECPriorityTasks/${loginId}/${dateParts.isoDate}`,
        ];
        const currentTaskPaths = [
          `IECData/IECTasks/${loginId}/${dateParts.year}/${dateParts.monthName}/${dateParts.isoDate}`,
        ];

        // 2. Load the latest catalog from Firebase first, then fall back to cache
        let taskCatalog = {};
        try {
          const freshCatalog = await getData('IECData/Tasks');
          if (freshCatalog && typeof freshCatalog === 'object') {
            taskCatalog = freshCatalog;
            await saveTaskCatalogCache(freshCatalog);
          }
        } catch (catalogError) {
          taskCatalog = (await readTaskCatalogCache()) || {};
        }

        if (!taskCatalog || typeof taskCatalog !== 'object') {
          taskCatalog = (await readTaskCatalogCache()) || {};
        }

        const debugTaskId = '22';
        const debugCatalogRecord =
          resolveCatalogTaskRecord(taskCatalog, debugTaskId) ||
          taskCatalog?.[debugTaskId] ||
          null;
        console.log('[DashboardScreen] catalog debug', {
          debugTaskId,
          rawCatalogValue: taskCatalog?.[debugTaskId] || null,
          matchedCatalogRecord: debugCatalogRecord,
          matchedCatalogName: getFirstText(
            debugCatalogRecord?.name,
            debugCatalogRecord?.Name,
            debugCatalogRecord?.title,
            debugCatalogRecord?.Title,
            debugCatalogRecord?.taskName,
            debugCatalogRecord?.TaskName,
            debugCatalogRecord?.label,
            debugCatalogRecord?.Label,
          ),
        });

        const [kpiResult, priorityResult, currentResult] =
          await Promise.all([
            readFirstExistingPath(kpiPaths),
            readFirstExistingPath(priorityPaths),
            readFirstExistingPath(currentTaskPaths),
          ]);

        const kpiTasks = flattenTaskNode(
          kpiResult.value,
          'KPI Task',
          'KPI',
          kpiResult.path,
          taskCatalog,
        );
        const priorityTasks = flattenTaskNode(
          priorityResult.value,
          'Priority Task',
          'Priority',
          priorityResult.path,
          taskCatalog,
        );
        const currentTasks = flattenTaskNode(
          currentResult.value,
          'Current Task',
          'Current',
          currentResult.path,
          taskCatalog,
        );
        const currentStatusMap = buildCurrentStatusMap(currentTasks);
        const displayableCurrentTasks =
          buildDisplayableCurrentTasks(currentTasks);

        const assignedTasks = applyCurrentStatusMap(
          mergeAssignedTasks(kpiTasks, priorityTasks),
          currentStatusMap,
        );
        const combinedTasks = [...assignedTasks, ...displayableCurrentTasks];
        // 3. Deep Fetch missing task details if they are not in the catalog
        const tasksNeedingInfo = combinedTasks.filter(t => {
          const hasDetailsInCatalog = Boolean(
            resolveCatalogTaskRecord(taskCatalog, t.resolvedTaskId || t.id),
          );
          const hasDetailsInTask = t.description || (t.raw && resolveLeafDescription(t.raw));
          return !hasDetailsInCatalog && !hasDetailsInTask;
        });

        if (tasksNeedingInfo.length > 0) {
          await Promise.all(tasksNeedingInfo.map(async (t) => {
            try {
              const details = await getData(`IECData/Tasks/${t.resolvedTaskId}`);
              if (details) {
                taskCatalog[t.resolvedTaskId] = details;
              }
            } catch (e) {
            }
          }));
          await saveTaskCatalogCache(taskCatalog);
        }

        // Re-normalize titles and descriptions after deep fetch
        const finalTasks = combinedTasks.map(t => {
          const catalogEntry =
            resolveCatalogTaskRecord(taskCatalog, t.resolvedTaskId) ||
            resolveCatalogTaskRecord(taskCatalog, t.taskKey) ||
            resolveCatalogTaskRecord(taskCatalog, t.leafKey) ||
            resolveCatalogTaskRecord(taskCatalog, t.id);
          const rawTitle = resolveLeafTitle(t.raw);
          const catalogTitle = resolveLeafTitle(catalogEntry);
          const currentTitle = getFirstText(
            t.title,
            t.taskName,
            t.TaskName,
            t.name,
            t.Name,
          );
          return {
            ...t,
            catalogEntry,
            title:
              isMeaningfulTaskTitle(currentTitle) && currentTitle !== t.resolvedTaskId
                ? currentTitle
                : (
                  rawTitle ||
                  catalogTitle ||
                  t.raw?.taskName ||
                  t.raw?.TaskName ||
                  t.raw?.name ||
                  t.raw?.Name ||
                  t.taskName ||
                  t.TaskName ||
                  t.name ||
                  t.Name ||
                  'Untitled Task'
                ),
            description: t.description || resolveLeafDescription(catalogEntry) || '',
          };
        });

        const dedupedTasks = dedupeDashboardTasks(finalTasks).sort(
          (left, right) => {
            const leftRank = getDashboardTaskOrderRank(left);
            const rightRank = getDashboardTaskOrderRank(right);
            if (leftRank !== rightRank) {
              return leftRank - rightRank;
            }

            const statusDelta =
              getTaskStatusRank(right.status) - getTaskStatusRank(left.status);
            if (statusDelta !== 0) {
              return statusDelta;
            }

            return String(left.title || '').localeCompare(
              String(right.title || ''),
            );
          },
        );

        // Filter to show only active (non-deleted) tasks
        const activeTasks = filterActiveTasks(dedupedTasks, taskCatalog);

        if (isActive) {
          setTasks(activeTasks);
          // 3. Save to cache for next time
          await saveDashboardTaskCache(loginId, dateParts.isoDate, activeTasks);
        }
      } catch (error) {
        if (isActive) {
          // If we have tasks from cache, don't show error if network fails
          if (tasks.length === 0) {
            setTasks([]);
            setTasksError(error?.message || 'Unable to load tasks.');
          }
        }
      } finally {
        if (isActive) {
          setTasksLoading(false);
          setTasksRefreshing(false);
        }
      }
    };

    const interactionHandle = InteractionManager.runAfterInteractions(() => {
      if (isActive) {
        loadTasks();
      }
    });

    return () => {
      isActive = false;
      interactionHandle?.cancel?.();
    };
  }, [loginId, tasksReloadToken]);

  // Handle location tracking start
  useEffect(() => {
    if (loginId) {
      startTracking();
    }
  }, [loginId, startTracking]);

  const batteryPromptCheckedRef = React.useRef(false);
  const isCheckingBatteryRef = React.useRef(false);

  const checkAndShowBatteryPrompt = React.useCallback(async (isReturnFromBackground = false) => {
    // 1. Quick exit if already handled in this session or currently checking
    if (!loginId || tasksLoading || isCheckingBatteryRef.current || batteryPromptCheckedRef.current) return;

    try {
      isCheckingBatteryRef.current = true;

      // 2. Check persistent storage first (if they ever allowed it)
      const handled = await AsyncStorage.getItem(`battery_prompt_handled_${loginId}`);
      if (handled === 'true') {
        batteryPromptCheckedRef.current = true;
        setBatteryPromptChecked(true);

        // Even if handled, we still want to ensure tracking starts if exempt
        const isExempt = await isIgnoringBatteryOptimizations();
        if (isExempt) {
          setTrackingPermissionGranted(true);
          startTracking();
        }
        return;
      }

      // 3. Small delay if returning from background
      if (isReturnFromBackground) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // 4. Check actual system status
      const isExempt = await isIgnoringBatteryOptimizations();
      if (isExempt) {
        batteryPromptCheckedRef.current = true;
        setBatteryPromptChecked(true);
        setTrackingPermissionGranted(true);
        startTracking();
        return;
      }

      // 5. Final check before showing alert
      if (backgroundPermissionPromptShownRef.current) return;

      backgroundPermissionPromptShownRef.current = true;
      batteryPromptCheckedRef.current = true;
      setBatteryPromptChecked(true);
      showAlert({
        title: 'Keep Tracking Active',
        message:
          'Location tracking is active. To ensure it works in the background, please set battery to "No Restriction" or "Unrestricted".',
        variant: 'warning',
        dismissible: false,
        buttons: [
          {
            text: 'Allow No Restriction',
            onPress: async () => {
              try {
                await AsyncStorage.setItem(`battery_prompt_handled_${loginId}`, 'true');
                await requestIgnoreBatteryOptimizations();
              } catch (error) {
              }
            },
          },
        ],
      });
    } catch (e) {
    } finally {
      isCheckingBatteryRef.current = false;
    }
  }, [loginId, tasksLoading, isIgnoringBatteryOptimizations, startTracking, showAlert]);

  useEffect(() => {
    checkAndShowBatteryPrompt();
  }, [loginId, tasksLoading]); // Only run when loginId or loading state changes

  // Re-check when app returns to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        checkAndShowBatteryPrompt(true);
      }
    });
    return () => subscription.remove();
  }, [checkAndShowBatteryPrompt]);


  const handleRefreshTasks = async () => {
    setTasksRefreshing(true);
    setTasksError('');

    try {
      const session = await loadLoginSession();
      const refreshedLoginId =
        session?.loginId ||
        session?.employee?.userId ||
        session?.employee?.id ||
        '';
      setLoginId(refreshedLoginId);
      setTasksReloadToken(token => token + 1);
    } catch (error) {
      setTasksRefreshing(false);
    }
  };

  const handleLogout = () => {
    setMenuOpen(false);
    showAlert({
      title: 'Logout',
      message: 'Are you sure you want to logout ?',
      variant: 'warning',
      dismissible: false,
      buttons: [
        {
          text: 'No',
          style: 'cancel',
        },
        {
          text: 'Yes',
          onPress: async () => {
            runAfterGesture(async () => {
              await stopTracking();
              await clearLoginSession();
              await clearSharedMediaFiles();
              await clearMediaCache();
              await clearTaskCache();
              navigation.replace('Login');
            });
          },
        },
      ],
    });
  };

  const handleTaskAction = task => {
    if (task.status === 'Pending') {
      handleStartTask(task);
    }
  };

  const handleStartTask = task => {
    setActionModalTask(task);
    setActionModalMode('pick_task');
    setActionModalVisible(true);
  };

  const handleAddTask = mode => {
    setFabOpen(false);
    runAfterGesture(() => {
      setActionModalTask(null);
      setActionModalMode(mode);
      setActionModalVisible(true);
    });
  };

  const renderTask = ({ item }) => {
    const status = STATUS_META[item.status] ?? STATUS_META.Pending;
    const taskTag = resolveTaskTag(item);
    const taskPriorityChip = resolveTaskPriorityChip(item);

    let priorityColor = appTheme.colors.status.success;
    let priorityBackgroundColor = 'rgba(22, 122, 69, 0.12)';
    let priorityBorderColor = 'rgba(22, 122, 69, 0.18)';

    if (taskPriorityChip === 'High') {
      priorityColor = appTheme.colors.status.danger;
      priorityBackgroundColor = 'rgba(180, 35, 24, 0.10)';
      priorityBorderColor = 'rgba(180, 35, 24, 0.22)';
    }

    if (taskPriorityChip === 'Medium') {
      priorityColor = appTheme.colors.status.warning;
      priorityBackgroundColor = 'rgba(199, 125, 0, 0.12)';
      priorityBorderColor = 'rgba(199, 125, 0, 0.22)';
    }

    return (
      <View style={styles.taskCard}>
        <View style={styles.taskHeader}>
          <View style={styles.typeWrap}>
            <Text style={styles.taskType}>{taskTag}</Text>
          </View>
          <View
            style={[
              styles.priorityWrap,
              {
                backgroundColor: priorityBackgroundColor,
                borderColor: priorityBorderColor,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="flag-variant-outline"
              size={12}
              color={priorityColor}
            />
            <Text style={[styles.priorityText, { color: priorityColor }]}>
              {taskPriorityChip}
            </Text>
          </View>
        </View>

        <Text style={styles.taskTitle} numberOfLines={2}>
          {getDashboardDisplayTitle(item)}
        </Text>
        <View style={styles.taskFooter}>
          <View
            style={[
              styles.statusChip,
              { backgroundColor: status.backgroundColor },
            ]}
          >
            <MaterialCommunityIcons
              name={status.icon}
              size={14}
              color={status.textColor}
              style={styles.statusIcon}
            />
            <Text style={[styles.statusText, { color: status.textColor }]}>
              {status.label}
            </Text>
          </View>

          {item.status !== 'Pending' && !!getCompletionDisplayValue(item) && (
            <Text style={styles.taskDateRight}>
              {formatCompletionDate(getCompletionDisplayValue(item))}
            </Text>
          )}

          {item.status === 'Pending' && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleTaskAction(item)}
              activeOpacity={0.8}
            >
              <Text style={styles.actionBtnText}>Pick Task</Text>
              <MaterialCommunityIcons
                name="arrow-right-circle"
                size={16}
                color="#FFF"
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F4F7F9" />
      <CommonLoader
        visible={tasksLoading && tasks.length === 0}
        message="Loading tasks"
      />

      {/* Close FAB menu when touching outside via absolute fill instead of wrapping */}
      {fabOpen && (
        <Pressable
          style={[styles.overlayBlocker, { zIndex: 10, elevation: 10 }]}
          onPress={() => setFabOpen(false)}
        />
      )}
      <View style={styles.container}>
        {/* STATIC HEADER AREA */}
        <View style={styles.staticTopSection}>
          <View style={styles.header}>
            <View>
              <Text style={styles.greeting}>{greetingText}</Text>
              <Text style={styles.userName}>{employeeName}</Text>
            </View>
            <TouchableOpacity
              style={styles.menuIconWrap}
              onPress={() => setMenuOpen(true)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="dots-vertical"
                size={24}
                color={appTheme.colors.brand.primaryDark}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.metricsRow}>
            <View style={[styles.metricCard, styles.metricTotal]}>
              <Text style={styles.metricLabelTotal}>Total Tasks</Text>
              <Text style={styles.metricValTotal}>{metrics.total}</Text>
            </View>
            <View style={[styles.metricCard, styles.metricPending]}>
              <Text style={styles.metricLabelGroup}>Pending</Text>
              <Text style={styles.metricValGroup}>{metrics.pending}</Text>
            </View>
            <View style={[styles.metricCard, styles.metricCompleted]}>
              <Text style={styles.metricLabelGroup}>Completed</Text>
              <Text style={styles.metricValCompleted}>{metrics.completed}</Text>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Tasks</Text>
          </View>
        </View>

        {/* SCROLLING LIST AREA */}
        <View style={styles.listContainer}>
          <FlatList
            data={tasks}
            keyExtractor={item =>
              String(item.listKey || item.originalPath || item.id)
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: insets.bottom + 80 },
            ]}
            renderItem={renderTask}
            refreshControl={
              <RefreshControl
                refreshing={tasksRefreshing}
                onRefresh={handleRefreshTasks}
                tintColor={appTheme.colors.brand.primaryDark}
                colors={[appTheme.colors.brand.primaryDark]}
              />
            }
            ListEmptyComponent={
              !tasksLoading ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons
                    name="clipboard-text-outline"
                    size={42}
                    color={appTheme.colors.neutral.textMuted}
                  />
                  <Text style={styles.emptyTitle}>
                    {tasksError ? 'Unable to load tasks' : 'No tasks found'}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {tasksError ||
                      'Your assigned tasks will appear here once they are available.'}
                  </Text>
                </View>
              ) : null
            }
            onScroll={() => {
              if (fabOpen) setFabOpen(false);
            }}
          />
          {!!tasksError && !tasksLoading && (
            <Text style={styles.errorText}>{tasksError}</Text>
          )}
        </View>

        {/* FAB BUTTON */}
        <View
          style={[
            styles.fabWrap,
            {
              bottom: Math.max(insets.bottom + 16, 16),
              zIndex: 30,
              elevation: 30,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.fabButton}
            onPress={() => setFabOpen(!fabOpen)}
            activeOpacity={0.9}
          >
            <MaterialCommunityIcons
              name={fabOpen ? 'close' : 'plus'}
              size={26}
              color="#FFF"
            />
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        transparent
        visible={fabOpen}
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => setFabOpen(false)}
      >
        <Pressable
          style={[styles.menuOverlay, { flex: 1 }]}
          onPress={() => setFabOpen(false)}
        >
          <View style={styles.menuSpacer} />
          <TouchableWithoutFeedback onPress={() => {}}>
            <View
              style={[
                styles.fabModalContent,
                { bottom: Math.max(insets.bottom + 76, 76) },
              ]}
            >
              <View style={styles.fabMenuPanel}>
                <TouchableOpacity
                  style={styles.fabPanelItem}
                  onPress={() => handleAddTask('add_kpi')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.fabPanelIcon, styles.fabIconKpi]}>
                    <MaterialCommunityIcons
                      name="clipboard-plus-outline"
                      size={18}
                      color={appTheme.colors.brand.primaryDark}
                    />
                  </View>
                  <View>
                    <Text style={styles.fabPanelTitle}>Add KPI Task</Text>
                    <Text style={styles.fabPanelSubtitle}>
                      Create a new KPI
                    </Text>
                  </View>
                </TouchableOpacity>

                <View style={styles.fabDivider} />

                <TouchableOpacity
                  style={styles.fabPanelItem}
                  onPress={() => handleAddTask('add_other')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.fabPanelIcon, styles.fabIconOther]}>
                    <MaterialCommunityIcons
                      name="playlist-plus"
                      size={18}
                      color={appTheme.colors.brand.primaryDark}
                    />
                  </View>
                  <View>
                    <Text style={styles.fabPanelTitle}>Add Other Task</Text>
                    <Text style={styles.fabPanelSubtitle}>
                      Non-KPI assignment
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </Pressable>
      </Modal>

      {/* Menu Modal */}
      <Modal
        transparent
        visible={menuOpen}
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={[styles.menuOverlay, { flex: 1 }]} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuSpacer} />
          <TouchableWithoutFeedback onPress={() => {}}>
            <View style={styles.menuPanel}>
              <Pressable
                onPress={() => {
                  runAfterGesture(() => {
                    setMenuOpen(false);
                    navigation?.navigate?.('TaskMonitoring');
                  });
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && styles.menuItemPressed,
                ]}
              >
                <View style={[styles.menuIcon, styles.menuIconPrimary]}>
                  <MaterialCommunityIcons
                    name="clipboard-text-outline"
                    size={18}
                    color={appTheme.colors.brand.primaryDark}
                  />
                </View>
                <View style={styles.menuTextWrap}>
                  <Text style={styles.menuTitle}>Task Monitoring</Text>
                  <Text style={styles.menuSubtitle}>View overall status</Text>
                </View>
              </Pressable>

              <Pressable
                onPress={handleLogout}
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && styles.menuItemPressed,
                ]}
              >
                <View style={[styles.menuIcon, styles.menuIconDanger]}>
                  <MaterialCommunityIcons
                    name="logout-variant"
                    size={18}
                    color={appTheme.colors.status.danger}
                  />
                </View>
                <View style={styles.menuTextWrap}>
                  <Text style={styles.menuTitle}>Logout</Text>
                  <Text style={styles.menuSubtitle}>Exit application</Text>
                </View>
              </Pressable>
            </View>
          </TouchableWithoutFeedback>
        </Pressable>
      </Modal>


      {/* Unified Task Action Modal */}
      {actionModalVisible && TaskActionModal ? (
        <TaskActionModal
          visible={actionModalVisible}
          onClose={() => setActionModalVisible(false)}
          onSaved={() => setTasksReloadToken(token => token + 1)}
          mode={actionModalMode}
          taskOptions={tasks}
          initialTask={actionModalTask}
        />
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F7F9',
  },
  container: {
    flex: 1,
  },
  staticTopSection: {
    paddingHorizontal: 20,
    backgroundColor: '#F4F7F9',
    zIndex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 22,
  },
  greeting: {
    fontSize: 14,
    color: appTheme.colors.neutral.textMuted,
    fontWeight: '600',
    marginBottom: 4,
  },
  userName: {
    fontSize: 16,
    color: appTheme.colors.brand.primaryDark,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  menuIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.4)',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  // --- Summary Metrics ---
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 12,
  },
  metricCard: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricTotal: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#FFF',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  metricPending: {
    backgroundColor: '#FFF4E5',
  },
  metricCompleted: {
    backgroundColor: '#E8F5E9',
  },
  metricValTotal: {
    fontSize: 24,
    fontWeight: '900',
    color: appTheme.colors.brand.primaryDark,
  },
  metricLabelTotal: {
    fontSize: 12,
    fontWeight: '700',
    color: appTheme.colors.neutral.textMuted,
    marginBottom: 4,
  },
  metricValGroup: {
    fontSize: 24,
    fontWeight: '900',
    color: appTheme.colors.brand.accent,
  },
  metricValCompleted: {
    fontSize: 24,
    fontWeight: '900',
    color: appTheme.colors.status.success,
  },
  metricLabelGroup: {
    fontSize: 12,
    fontWeight: '700',
    color: appTheme.colors.neutral.text,
    marginBottom: 4,
    opacity: 0.7,
  },
  // --- Section Header ---
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: appTheme.colors.neutral.text,
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '700',
    color: appTheme.colors.brand.secondary,
  },
  // --- List Container ---
  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 44,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '800',
    color: appTheme.colors.neutral.text,
    textAlign: 'center',
  },
  emptySubtitle: {
    marginTop: 6,
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  // --- Task Card ---
  taskCard: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.25)',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    justifyContent: 'space-between',
  },
  typeWrap: {
    backgroundColor: 'rgba(185, 199, 209, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  taskType: {
    fontSize: 11,
    fontWeight: '800',
    color: appTheme.colors.brand.primaryDark,
    letterSpacing: 0.5,
  },
  priorityWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.3)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priorityText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: appTheme.colors.neutral.text,
    lineHeight: 22,
    marginBottom: 16,
  },
  taskDate: {
    marginTop: -8,
    marginBottom: 14,
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  taskDateRight: {
    marginLeft: 'auto',
    marginRight: 8,
    color: appTheme.colors.neutral.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'right',
  },
  statusIcon: {
    marginRight: 4,
  },
  errorText: {
    marginTop: 8,
    color: appTheme.colors.status.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  overlayBlocker: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  taskFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appTheme.colors.brand.primaryDark,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 6,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  // --- FAB Menu ---
  fabWrap: {
    position: 'absolute',
    right: 20,
    alignItems: 'flex-end',
    zIndex: 10,
  },
  fabModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
  },
  fabModalContent: {
    position: 'absolute',
    right: 20,
    alignItems: 'flex-end',
    zIndex: 20,
    elevation: 20,
  },
  fabMenuPanel: {
    marginBottom: 16,
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.4)',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    minWidth: 200,
  },
  fabPanelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  fabPanelIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  fabIconKpi: {
    backgroundColor: 'rgba(18, 59, 74, 0.1)',
  },
  fabIconOther: {
    backgroundColor: 'rgba(232, 155, 0, 0.15)',
  },
  fabPanelTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 14,
    fontWeight: '800',
  },
  fabPanelSubtitle: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  fabDivider: {
    height: 1,
    backgroundColor: 'rgba(185, 199, 209, 0.3)',
    marginVertical: 4,
  },
  fabButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: appTheme.colors.brand.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: appTheme.colors.brand.accent,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  // --- Menu Overlay ---
  menuOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  menuPanel: {
    position: 'absolute',
    top: 72,
    right: 20,
    width: 240,
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.3)',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  menuItemPressed: {
    backgroundColor: '#F4F7F9',
  },
  menuIconPrimary: {
    backgroundColor: 'rgba(18, 59, 74, 0.08)',
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuIconDanger: {
    backgroundColor: 'rgba(180, 35, 24, 0.08)',
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuTextWrap: {
    flex: 1,
  },
  menuTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 14,
    fontWeight: '900',
  },
  menuSubtitle: {
    marginTop: 2,
    color: appTheme.colors.neutral.textMuted,
    fontSize: 11,
  },
  menuDivider: {
    height: 1,
    marginVertical: 4,
    backgroundColor: 'rgba(185, 199, 209, 0.3)',
  },
});

export default DashboardScreen;
