import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import RepickTaskDetailModal from '../components/RepickTaskDetailModal';
import UpcomingTasksModal from '../components/UpcomingTasksModal';
import {
  getPendingMediaCountsByTaskRef,
  subscribePendingMediaQueue,
} from '../services/pendingUploadService';
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
import { useIsFocused } from '@react-navigation/native';
import {
  acknowledgeRejectedTasks,
  backfillRejectedTasks,
  getEntryWindow,
  subscribeRejectedTasks,
} from '../services/rejectedTaskService';
import { loadTasks as loadTasksForDate } from '../services/taskMonitoringService';
import {
  loadAssignedTasks,
  loadExecutiveBranch,
} from '../services/assignedTaskService';
 import {
   saveDashboardTaskCache,
   readDashboardTaskCache,
   saveTaskCatalogCache,
   clearTaskCache,
   getTaskCatalog,
   subscribeTaskCatalog,
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

// 'YYYY-MM-DD' -> '17 Sep 2026' (date only, no timezone shift).
// "YYYY-MM-DD HH:mm" — same format the task records use for their timestamps.
const getCurrentDateTimeText = () => {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

const formatDayOnly = value => {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) {
    return '';
  }
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', {
    month: 'short',
  });
  return `${String(day).padStart(2, '0')} ${monthName} ${year}`;
};

// "3h 20m" / "45m" / "less than a minute" — the time left to re-pick.
const formatTimeLeft = ms => {
  const total = Math.max(0, Math.floor(Number(ms) || 0) / 60000);
  const minutes = Math.floor(total);
  if (minutes < 1) return 'less than a minute';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

// "10 Oct, 04:15 PM" — the resubmission deadline.
const formatDeadline = date => {
  if (!date || Number.isNaN(date.getTime?.())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleString('en-US', { month: 'short' });
  const hours24 = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const hours12 = hours24 % 12 || 12;
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  return `${day} ${month}, ${String(hours12).padStart(2, '0')}:${minutes} ${meridiem}`;
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
  // Planned from the portal's calendar — counted as KPI work, but shown
  // apart from a task the executive picked themselves.
  if (task?.isAssigned) {
    return 'Assigned';
  }

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

  // An assigned task is KPI work, so it carries the same Medium chip.
  if (tag === 'KPI' || tag === 'Assigned') {
    return 'Medium';
  }

  return 'Low';
};

// Colours of the High / Medium / Low priority chip.
const getPriorityChipColors = chip => {
  if (chip === 'High') {
    return {
      color: appTheme.colors.status.danger,
      background: 'rgba(180, 35, 24, 0.10)',
      border: 'rgba(180, 35, 24, 0.22)',
    };
  }
  if (chip === 'Medium') {
    return {
      color: appTheme.colors.status.warning,
      background: 'rgba(199, 125, 0, 0.12)',
      border: 'rgba(199, 125, 0, 0.22)',
    };
  }
  return {
    color: appTheme.colors.status.success,
    background: 'rgba(22, 122, 69, 0.12)',
    border: 'rgba(22, 122, 69, 0.18)',
  };
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
  // Its own slot, so a submission of the same task never merges into it.
  if (task?.isAssigned) {
    return `assigned:${task.listKey || task.id}`;
  }

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

// Today's submissions per task, keyed like buildTaskIdentity:
// { count, lastAt } — lastAt is the latest submission's "_at".
const summarizeSubmissionsByTask = tasks => {
  const summary = new Map();
  tasks.forEach(task => {
    const identity = task ? buildTaskIdentity(task) : '';
    if (!identity) return;
    const at = getFirstText(task.raw?._at, task.taskDate);
    const current = summary.get(identity) || { count: 0, lastAt: '' };
    summary.set(identity, {
      count: current.count + 1,
      lastAt: at > current.lastAt ? at : current.lastAt,
    });
  });
  return summary;
};

/*
 * A calendar-assigned task stays open for the WHOLE day: it is never folded
 * into a submission or marked Completed, so the executive can pick it again
 * and again. The assigned card carries how often and when it was last picked;
 * the submissions themselves leave the list once their media has uploaded.
 */
const keepAssignedTasksOpen = (tasks, submissionSummary) =>
  tasks.map(task => {
    if (!task?.isAssigned) return task;
    const done = submissionSummary.get(buildTaskIdentity(task));
    return {
      ...task,
      status: 'Pending',
      doneCount: done?.count || 0,
      lastPickAt: done?.lastAt || '',
    };
  });

// "2026-10-28 10:45" -> "10:45 AM"
const formatPickTime = value => {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${match[2]} ${suffix}`;
};

const applyCurrentStatusMap = (tasks, currentStatusMap) =>
  tasks
    .filter(task => {
      if (task?.isAssigned) {
        return true;
      }
      const identity = buildTaskIdentity(task);
      const currentTask = identity ? currentStatusMap.get(identity) : null;
      return !currentTask || !isTaskApproved(currentTask);
    })
    .map(task => {
      if (task?.isAssigned) {
        return task;
      }
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
  // The day's plan stays on top — it is always open to pick again.
  if (task?.isAssigned) return -1;
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
  const [upcomingVisible, setUpcomingVisible] = useState(false);
  const [actionModalMode, setActionModalMode] = useState('add_kpi');
  const [actionModalTask, setActionModalTask] = useState(null);
  const [employeeName, setEmployeeName] = useState('Employee');
  const [loginId, setLoginId] = useState('');
  // Branch / site from the employee record — the Task Calendar is planned
  // per site, so the Dashboard only shows this site's assigned tasks.
  const [executiveBranch, setExecutiveBranch] = useState('');
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [tasksRefreshing, setTasksRefreshing] = useState(false);
  const [tasksReloadToken, setTasksReloadToken] = useState(0);
  const [batteryPromptChecked, setBatteryPromptChecked] = useState(false);
  const [trackingPermissionGranted, setTrackingPermissionGranted] = useState(false);
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours());
  const [pendingUploadMap, setPendingUploadMap] = useState(new Map());
  // True while the battery prompt is on screen — the Not Approved reminder
  // waits for it to close instead of replacing it.
  const [batteryAlertOpen, setBatteryAlertOpen] = useState(false);
  // Not Approved tasks the reminder already covered during this visit.
  const infoShownKeysRef = React.useRef(new Set());

  useEffect(() => {
    let isMounted = true;
    const refresh = async () => {
      try {
        const map = await getPendingMediaCountsByTaskRef();
        if (isMounted) {
          setPendingUploadMap(map);
        }
      } catch {
        // Ignore
      }
    };
    refresh();
    const unsubscribe = subscribePendingMediaQueue(() => {
      refresh();
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);
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

  /*
   * Counted from the full list, so a submission of an assigned task still
   * counts as Completed after its card leaves the screen. An assigned task is
   * Pending only until it is first picked; after that the card is just the
   * way to pick it again, so it no longer counts on its own.
   */
  const metrics = useMemo(() => {
    const pendingCount = tasks.filter(task =>
      task.isAssigned
        ? !(task.doneCount > 0)
        : task.status === 'Pending',
    ).length;
    const completedCount = tasks.filter(
      task =>
        !task.isAssigned &&
        (task.status === 'Completed' || task.status === 'Approved'),
    ).length;
    return {
      total: tasks.filter(task => !(task.isAssigned && task.doneCount > 0))
        .length,
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

        const resolvedLoginId =
          session.loginId ||
          session.employee?.userId ||
          session.employee?.id ||
          '';

        setEmployeeName(resolvedName);
        setLoginId(resolvedLoginId);

        // Site of this executive — decides which calendar-assigned tasks
        // belong to them. The session rarely carries it, so fall back to the
        // employee master, which is where the portal reads it from too.
        const sessionBranch = String(
          session.employee?.branch ||
          session.employee?.Branch ||
          '',
        ).trim();

        const branch =
          sessionBranch || (await loadExecutiveBranch(resolvedLoginId));

        if (isActive) {
          setExecutiveBranch(branch);
        }
      } catch {
        if (isActive) {
          setEmployeeName('Employee');
          setLoginId('');
          setExecutiveBranch('');
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

        // 2. Load task catalog (cached or fresh)
        const taskCatalog = await getTaskCatalog();

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

        const [kpiResult, priorityResult, currentResult, calendarTasks] =
          await Promise.all([
            readFirstExistingPath(kpiPaths),
            readFirstExistingPath(priorityPaths),
            readFirstExistingPath(currentTaskPaths),
            // Planned from the portal's Task Calendar for this executive's
            // site — KPI tasks that are already chosen for the day.
            loadAssignedTasks(dateParts.isoDate, executiveBranch),
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

        // Calendar tasks sit first: they are the day's plan. mergeAssignedTasks
        // drops a duplicate when the same task is also a standing KPI task.
        const assignedTasks = keepAssignedTasksOpen(
          applyCurrentStatusMap(
            mergeAssignedTasks(
              mergeAssignedTasks(calendarTasks || [], kpiTasks),
              priorityTasks,
            ),
            currentStatusMap,
          ),
          summarizeSubmissionsByTask(currentTasks),
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

    // Defer initial load until after current frame/gesture finishes
    const rafId = requestAnimationFrame(() => {
      if (isActive) {
        loadTasks();
      }
    });

    return () => {
      isActive = false;
      cancelAnimationFrame(rafId);
    };
    // executiveBranch decides which calendar-assigned tasks belong here, so
    // the list reloads once the session has resolved it.
  }, [loginId, tasksReloadToken, executiveBranch]);

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
      // If the Not Approved reminder was already up, this prompt replaces it —
      // let it show again once the prompt is closed.
      infoShownKeysRef.current = new Set();
      setBatteryAlertOpen(true);
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
              setBatteryAlertOpen(false);
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

  // ── Not Approved tasks ("To Resubmit") ──
  // Live list of this executive's rejected tasks. The portal adds an entry on
  // Not Approved; it is removed once the task is resubmitted or approved.
  const isFocused = useIsFocused();
  const [rejectedTasks, setRejectedTasks] = useState([]);
  const [rejectedLoaded, setRejectedLoaded] = useState(false);

  useEffect(() => {
    if (!loginId) return undefined;
    // One-time pick-up of rejections from before this list existed.
    backfillRejectedTasks(loginId);
    return subscribeRejectedTasks(loginId, list => {
      setRejectedTasks(list);
      setRejectedLoaded(true);
    });
  }, [loginId]);

  // Sent back for resubmission — these get a Re-pick card.
  const resubmitTasks = useMemo(
    () => rejectedTasks.filter(r => r.resubmissionRequired),
    [rejectedTasks],
  );

  // Ticks once a minute so the "re-pick within …" countdown stays honest and
  // a card locks itself while the screen is open. Only runs while something
  // is actually counting down.
  const [nowTs, setNowTs] = useState(Date.now());
  const hasOpenWindow = useMemo(
    () =>
      rejectedTasks.some(
        r => r.resubmissionRequired && !r.resubmitted && !r.isLocked,
      ),
    [rejectedTasks],
  );
  useEffect(() => {
    if (!hasOpenWindow || !isFocused) return undefined;
    setNowTs(Date.now());
    const timer = setInterval(() => setNowTs(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, [hasOpenWindow, isFocused]);

  // Still waiting for a re-pick. A task whose 24-hour window has closed is
  // NOT pending any more — it can no longer be re-picked, so it must not
  // drive the Re-pick reminder either.
  const repickPending = useMemo(
    () =>
      resubmitTasks.filter(
        r => !r.resubmitted && !getEntryWindow(r, nowTs).isLocked,
      ),
    [resubmitTasks, nowTs],
  );

  // "Do Not Send for Resubmission" — no card, only an info popup (task +
  // reason) until the executive taps OK.
  const infoPending = useMemo(
    () =>
      rejectedTasks.filter(r => !r.resubmissionRequired && !r.acknowledged),
    [rejectedTasks],
  );

  // Re-pick Task — load that date's submission and show the same Task Details
  // screen as Task Monitoring; its Re-pick button opens the existing re-pick
  // form (TaskActionModal, mode "repick") right here on the Dashboard.
  const [repickOpeningKey, setRepickOpeningKey] = useState('');
  const [repickValues, setRepickValues] = useState(null);
  const [detailTask, setDetailTask] = useState(null);

  const handleDetailRepick = React.useCallback(task => {
    setDetailTask(null);
    setRepickValues(task);
    setActionModalTask(null);
    setActionModalMode('repick');
    setActionModalVisible(true);
  }, []);

  const handleRepickRejected = React.useCallback(
    async item => {
      if (!item || repickOpeningKey) return;
      setRepickOpeningKey(item.entryKey);
      try {
        const dayTasks = await loadTasksForDate(item.date);
        const task = (dayTasks || []).find(
          t =>
            String(t?.taskKey) === String(item.taskId) &&
            String(t?.taskCount) === String(item.key) &&
            (!t?.datePath?.isoDate || t.datePath.isoDate === item.date),
        );
        if (!task) {
          showAlert({
            title: 'Re-pick Task',
            message: 'This task could not be found. Please try again.',
            variant: 'error',
          });
          return;
        }
        // Keep the list entry: a "Do Not Send" task is acknowledged by it.
        setDetailTask({ ...task, _rejectedEntry: item });
      } catch {
        showAlert({
          title: 'Re-pick Task',
          message: 'Unable to open the task. Please try again.',
          variant: 'error',
        });
      } finally {
        setRepickOpeningKey('');
      }
    },
    [repickOpeningKey, showAlert],
  );

  // "Do Not Send" task viewed — the executive tapped OK on its details:
  // mark it acknowledged (the card leaves the Dashboard, portal shows "Seen").
  const handleDetailAcknowledge = React.useCallback(
    task => {
      setDetailTask(null);
      const entry = task?._rejectedEntry;
      if (!entry) return;
      acknowledgeRejectedTasks(loginId, [entry], getCurrentDateTimeText()).catch(
        () => {},
      );
    },
    [loginId],
  );

  // Every time the executive lands on the Dashboard with Not Approved tasks
  // waiting (to re-pick, or to view), one common reminder. A new one arriving
  // live while on the Dashboard reminds again.
  useEffect(() => {
    if (!isFocused) {
      infoShownKeysRef.current = new Set();
      return;
    }
    // Wait while the battery prompt is open; shows right after it closes.
    if (!rejectedLoaded || batteryAlertOpen) return;

    const waiting = [...repickPending, ...infoPending];
    const unseen = waiting.filter(
      r => !infoShownKeysRef.current.has(r.entryKey),
    );
    if (!unseen.length) return;
    waiting.forEach(r => infoShownKeysRef.current.add(r.entryKey));

    // One common message, whatever the count — the tasks themselves are at
    // the top of the task list, each card with its own button.
    let action = 'Please open them from your task list to see the details.';
    if (repickPending.length && infoPending.length) {
      action =
        'Please open them from your task list — re-pick and submit again the ones marked "Re-pick Required".';
    } else if (repickPending.length) {
      action = 'Please re-pick them from your task list and submit again.';
    }
    showAlert({
      title: 'Reminder',
      message: `Some of your tasks were not approved.\n\n${action}`,
      variant: 'reminder',
      buttons: [{ text: 'OK' }],
    });
  }, [
    isFocused,
    rejectedLoaded,
    repickPending,
    infoPending,
    batteryAlertOpen,
    showAlert,
  ]);

  // Today's date (YYYY-MM-DD) — a re-picked task stays on the Dashboard for
  // the day it was re-picked, same as tasks added from Add Other / Add KPI.
  const todayIso = getCurrentDateParts().isoDate;

  // Media still uploading after a re-pick, per rejected entry — matched on the
  // task path the upload queue uses (…/IECTasks/{user}/…/{date}/{taskId}/{key}).
  const rejectedPendingUploads = useMemo(() => {
    const out = new Map();
    if (!pendingUploadMap.size) return out;
    resubmitTasks.forEach(r => {
      const suffix = `/${r.date}/${r.taskId}/${r.key}`;
      let count = 0;
      pendingUploadMap.forEach((n, ref) => {
        const path = String(ref || '');
        if (
          path.endsWith(suffix) &&
          (!loginId || path.includes(`/${loginId}/`))
        ) {
          count += Number(n) || 0;
        }
      });
      if (count > 0) out.set(r.entryKey, count);
    });
    return out;
  }, [pendingUploadMap, resubmitTasks, loginId]);

  // Cards on the Dashboard:
  //  - sent for resubmission: still to re-pick, or re-picked today (as
  //    Re-Submitted — like other submitted tasks it leaves once approved,
  //    which deletes the entry, or when the day changes), or media still
  //    uploading;
  //  - not sent for resubmission: until the executive has viewed it and
  //    tapped OK (acknowledged).
  const visibleRejected = useMemo(
    () =>
      rejectedTasks.filter(r => {
        if (!r.resubmissionRequired) return !r.acknowledged;
        // A locked task is read-only from here on: it stays until the
        // executive has seen it, then goes, like an info-only entry.
        if (!r.resubmitted && getEntryWindow(r, nowTs).isLocked) {
          return !r.acknowledged;
        }
        return (
          !r.resubmitted ||
          String(r.resubmittedAt || '').startsWith(todayIso) ||
          rejectedPendingUploads.has(r.entryKey)
        );
      }),
    [rejectedTasks, todayIso, rejectedPendingUploads, nowTs],
  );

  // Largest pending count seen per upload, so the card can show "Uploading
  // 1/3" — the rejected entry itself carries no media counts.
  const [rejectedUploadTotals, setRejectedUploadTotals] = useState(
    () => new Map(),
  );
  useEffect(() => {
    setRejectedUploadTotals(prev => {
      const next = new Map();
      rejectedPendingUploads.forEach((count, k) => {
        next.set(k, Math.max(prev.get(k) || 0, count));
      });
      const same =
        next.size === prev.size &&
        [...next].every(([k, v]) => prev.get(k) === v);
      return same ? prev : next;
    });
  }, [rejectedPendingUploads]);

  /*
   * A completed task's card, from submit to gone:
   *   uploading  — media still in the queue
   *   settling   — queue went quiet; may be only the gap before the next file,
   *                so the card keeps showing "Uploading" for UPLOAD_SETTLE_MS
   *   completed  — upload really finished: Completed badge for
   *                COMPLETED_SHOW_MS, then the card leaves the list
   * The clock starts at the moment the upload is seen to STOP — not the last
   * time the queue happened to report it busy — so a slow last file never
   * makes the card vanish the instant it completes. Completed work still
   * counts in the summary cards above.
   */
  const UPLOAD_SETTLE_MS = 1500;
  const COMPLETED_SHOW_MS = 3000;
  const HOLD_AFTER_UPLOAD_MS = UPLOAD_SETTLE_MS + COMPLETED_SHOW_MS;
  const uploadingKeysRef = React.useRef(new Set());
  const uploadStoppedAtRef = React.useRef(new Map());
  const [holdTick, setHoldTick] = useState(0);

  const isDoneTask = t =>
    !t?.isAssigned && (t?.status === 'Completed' || t?.status === 'Approved');

  const getDoneTaskKey = t =>
    String(t.listKey || t.originalPath || t.raw?.originalPath || t.id || '');

  // The upload queue is keyed by the submission's path; a KPI card that
  // turned Completed may still carry its own path, so the submission's
  // ".../{date}/{taskId}/{key}" ending is matched as well.
  const isTaskUploading = React.useCallback(
    t => {
      const ownRefs = [t.originalPath, t.raw?.originalPath]
        .map(ref => String(ref || '').trim())
        .filter(Boolean);
      const suffix =
        t.resolvedTaskId && t.leafKey
          ? `/${todayIso}/${t.resolvedTaskId}/${t.leafKey}`
          : '';
      let busy = false;
      pendingUploadMap.forEach((count, ref) => {
        if (
          Number(count) > 0 &&
          (ownRefs.includes(ref) || (!!suffix && String(ref).endsWith(suffix)))
        ) {
          busy = true;
        }
      });
      return busy;
    },
    [pendingUploadMap, todayIso],
  );

  // Phase of a completed task's card right now (see the note above). Called
  // while rendering, so the moment an upload stops is caught on the very
  // render that first sees it stopped.
  const getUploadPhase = t => {
    const key = getDoneTaskKey(t);
    if (isTaskUploading(t)) {
      uploadingKeysRef.current.add(key);
      uploadStoppedAtRef.current.delete(key);
      return 'uploading';
    }
    if (uploadingKeysRef.current.has(key)) {
      uploadingKeysRef.current.delete(key);
      uploadStoppedAtRef.current.set(key, Date.now());
    }
    const stoppedAt = uploadStoppedAtRef.current.get(key);
    if (!stoppedAt) return 'gone';
    const elapsed = Date.now() - stoppedAt;
    if (elapsed < UPLOAD_SETTLE_MS) return 'settling';
    if (elapsed < HOLD_AFTER_UPLOAD_MS) return 'completed';
    uploadStoppedAtRef.current.delete(key);
    return 'gone';
  };

  const visibleTasks = useMemo(
    () => tasks.filter(t => !isDoneTask(t) || getUploadPhase(t) !== 'gone'),
    // holdTick re-runs this while a card is settling or showing Completed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, isTaskUploading, holdTick],
  );

  // Tick while any card is settling or showing Completed, so it moves on to
  // the Completed badge and then off the list on time.
  const hasHeldCard = uploadStoppedAtRef.current.size > 0;
  useEffect(() => {
    if (!hasHeldCard) return undefined;
    const interval = setInterval(() => setHoldTick(tick => tick + 1), 250);
    return () => clearInterval(interval);
  }, [hasHeldCard]);

  // "Uploading" also covers the settling gap, so the badge does not flicker
  // to Completed and back between files.
  const isTaskStillUploading = t => {
    const phase = getUploadPhase(t);
    return phase === 'uploading' || phase === 'settling';
  };

  // Dashboard list: Not Approved tasks first (Re-pick card), then today's
  // tasks. A task of today that is on the rejected list is not repeated in
  // today's tasks.
  const dashboardListData = useMemo(() => {
    if (!rejectedTasks.length) return visibleTasks;
    const rejectedSuffixes = rejectedTasks.map(
      r => `/${r.date}/${r.taskId}/${r.key}`,
    );
    const remaining = visibleTasks.filter(t => {
      const path = String(t?.originalPath || t?.raw?.originalPath || '');
      return !rejectedSuffixes.some(suffix => path.endsWith(suffix));
    });
    return [
      ...visibleRejected.map(r => ({ ...r, _rejected: true })),
      ...remaining,
    ];
  }, [rejectedTasks, visibleRejected, visibleTasks]);

  // Keep task catalog in real-time sync with Firebase (new/edited/removed tasks).
  useEffect(() => {
    const unsubscribe = subscribeTaskCatalog(() => {
      // Cache is kept fresh by the service; UI reads it on next form open.
    });
    return unsubscribe;
  }, []);


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

  // Not Approved task card — same card as the task list. Sent for
  // resubmission: red, "Re-pick Task". Not sent: grey, "View Task" — the
  // details open view-only and OK removes the card.
  const renderRejectedTask = item => {
    if (!item.resubmissionRequired) {
      return renderViewOnlyRejectedTask(item);
    }
    // 24 hours gone and never re-picked — the task is closed. It reads like
    // the "no resubmission" card: view it, tap OK, and it is done.
    const window = getEntryWindow(item, nowTs);
    if (window.isLocked && !item.resubmitted) {
      return renderViewOnlyRejectedTask(item, {
        tagText: 'Resubmission Closed',
        note: `The 24-hour window closed on ${formatDeadline(window.deadlineAt)}.`,
      });
    }
    const isOpening = repickOpeningKey === item.entryKey;
    // Re-picked during this visit — shown like any other picked task.
    const isRepicked = !!item.resubmitted;
    // New media from the re-pick still uploading — same chip as other tasks.
    const pendingUploadCount = rejectedPendingUploads.get(item.entryKey) || 0;
    const isUploading = pendingUploadCount > 0;
    const uploadTotal = Math.max(
      rejectedUploadTotals.get(item.entryKey) || 0,
      pendingUploadCount,
    );
    const uploadedMedia = uploadTotal - pendingUploadCount;
    let statusMeta = STATUS_META['Not Approved'];
    if (isUploading) statusMeta = STATUS_META.Pending;
    else if (isRepicked) statusMeta = STATUS_META.Completed;
    // Same tag + priority chip as the normal task cards.
    const taskTag = resolveTaskTag(item);
    const priorityChip = resolveTaskPriorityChip(item);
    const chipColors = getPriorityChipColors(priorityChip);
    return (
      // Card keeps its red look until the task is approved (entry removed).
      <View style={[styles.taskCard, styles.rejectedTaskCard]}>
        <View style={styles.rejectedAccent} />
        <View style={styles.taskHeader}>
          <View style={styles.rejectedHeaderLeft}>
            <View style={styles.typeWrap}>
              <Text style={styles.taskType}>{taskTag}</Text>
            </View>
            <View style={styles.rejectedTag}>
              <Text style={styles.rejectedTagText}>
                {isRepicked ? 'Re-Submitted' : 'Re-pick Required'}
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.priorityWrap,
              {
                backgroundColor: chipColors.background,
                borderColor: chipColors.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="flag-variant-outline"
              size={12}
              color={chipColors.color}
            />
            <Text style={[styles.priorityText, { color: chipColors.color }]}>
              {priorityChip}
            </Text>
          </View>
        </View>

        <Text style={styles.taskTitle} numberOfLines={2}>
          {item.taskName || 'Task'}
        </Text>

        <View style={styles.rejectedMetaRow}>
          <MaterialCommunityIcons
            name="calendar-blank-outline"
            size={13}
            color={appTheme.colors.neutral.textMuted}
          />
          <Text style={styles.rejectedDate}>
            Picked on {formatDayOnly(item.date)}
          </Text>
        </View>

        {/* Time left to re-pick — the clock the executive is racing. Turns
            red in the last two hours. */}
        {!isRepicked && !!window.deadlineAt && (
          <View style={styles.rejectedMetaRow}>
            <MaterialCommunityIcons
              name="timer-sand"
              size={13}
              color={
                window.msLeft <= 2 * 60 * 60 * 1000
                  ? appTheme.colors.status.danger
                  : appTheme.colors.neutral.textMuted
              }
            />
            <Text
              style={[
                styles.rejectedDate,
                window.msLeft <= 2 * 60 * 60 * 1000 && styles.deadlineUrgent,
              ]}
            >
              Re-pick within {formatTimeLeft(window.msLeft)} · by{' '}
              {formatDeadline(window.deadlineAt)}
            </Text>
          </View>
        )}

        <View style={styles.taskFooter}>
          <View
            style={[
              styles.statusChip,
              { backgroundColor: statusMeta.backgroundColor },
            ]}
          >
            <MaterialCommunityIcons
              name={statusMeta.icon}
              size={14}
              color={statusMeta.textColor}
              style={styles.statusIcon}
            />
            <Text style={[styles.statusText, { color: statusMeta.textColor }]}>
              {statusMeta.label}
            </Text>
          </View>

          {isUploading ? (
            <View style={styles.uploadingChip}>
              <ActivityIndicator
                size="small"
                color={appTheme.colors.brand.primary}
              />
              <View>
                <Text style={styles.uploadingChipText}>
                  Uploading {uploadedMedia}/{uploadTotal}
                </Text>
                <View style={styles.uploadProgressTrack}>
                  <View
                    style={[
                      styles.uploadProgressFill,
                      {
                        width: `${Math.min(
                          100,
                          (uploadedMedia / uploadTotal) * 100,
                        )}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>
          ) : isRepicked ? (
            !!item.resubmittedAt && (
              <Text style={styles.taskDateRight}>
                {formatCompletionDate(item.resubmittedAt)}
              </Text>
            )
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, styles.repickBtn]}
              onPress={() => handleRepickRejected(item)}
              activeOpacity={0.8}
              disabled={!!repickOpeningKey}
            >
              {isOpening ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <MaterialCommunityIcons name="restore" size={16} color="#FFF" />
              )}
              <Text style={styles.actionBtnText}>Re-pick Task</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  // Not Approved and not actionable — either "do not send for resubmission"
  // or a re-pick whose 24-hour window closed. Info only, until viewed.
  const renderViewOnlyRejectedTask = (item, options = {}) => {
    const tagText = options.tagText || 'No Resubmission';
    const note = options.note || '';
    const isOpening = repickOpeningKey === item.entryKey;
    const taskTag = resolveTaskTag(item);
    const priorityChip = resolveTaskPriorityChip(item);
    const chipColors = getPriorityChipColors(priorityChip);
    const statusMeta = STATUS_META['Not Approved'];
    return (
      <View style={[styles.taskCard, styles.viewOnlyTaskCard]}>
        <View style={[styles.rejectedAccent, styles.viewOnlyAccent]} />
        <View style={styles.taskHeader}>
          <View style={styles.rejectedHeaderLeft}>
            <View style={styles.typeWrap}>
              <Text style={styles.taskType}>{taskTag}</Text>
            </View>
            <View style={[styles.rejectedTag, styles.viewOnlyTag]}>
              <Text style={[styles.rejectedTagText, styles.viewOnlyTagText]}>
                {tagText}
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.priorityWrap,
              {
                backgroundColor: chipColors.background,
                borderColor: chipColors.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="flag-variant-outline"
              size={12}
              color={chipColors.color}
            />
            <Text style={[styles.priorityText, { color: chipColors.color }]}>
              {priorityChip}
            </Text>
          </View>
        </View>

        <Text style={styles.taskTitle} numberOfLines={2}>
          {item.taskName || 'Task'}
        </Text>

        <View style={styles.rejectedMetaRow}>
          <MaterialCommunityIcons
            name="calendar-blank-outline"
            size={13}
            color={appTheme.colors.neutral.textMuted}
          />
          <Text style={styles.rejectedDate}>
            Picked on {formatDayOnly(item.date)}
          </Text>
        </View>

        {!!note && (
          <View style={styles.rejectedMetaRow}>
            <MaterialCommunityIcons
              name="timer-off-outline"
              size={13}
              color={appTheme.colors.neutral.textMuted}
            />
            <Text style={styles.rejectedDate}>{note}</Text>
          </View>
        )}

        <View style={styles.taskFooter}>
          <View
            style={[
              styles.statusChip,
              { backgroundColor: statusMeta.backgroundColor },
            ]}
          >
            <MaterialCommunityIcons
              name={statusMeta.icon}
              size={14}
              color={statusMeta.textColor}
              style={styles.statusIcon}
            />
            <Text style={[styles.statusText, { color: statusMeta.textColor }]}>
              {statusMeta.label}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleRepickRejected(item)}
            activeOpacity={0.8}
            disabled={!!repickOpeningKey}
          >
            {isOpening ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <MaterialCommunityIcons name="eye-outline" size={16} color="#FFF" />
            )}
            <Text style={styles.actionBtnText}>View Task</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderTask = ({ item }) => {
    if (item?._rejected) {
      return renderRejectedTask(item);
    }
    const taskRef = String(
      item?.originalPath || item?.raw?.originalPath || '',
    ).trim();
    const pendingUploadCount = taskRef
      ? Number(pendingUploadMap.get(taskRef) || 0)
      : 0;
    const isUploading =
      pendingUploadCount > 0 ||
      (isDoneTask(item) && isTaskStillUploading(item));
    const totalMedia =
      Number(item?.images || 0) + Number(item?.videos || 0);
    const uploadedMedia = Math.max(0, totalMedia - pendingUploadCount);
    const displayStatusKey = isUploading ? 'Pending' : item.status;
    const status = STATUS_META[displayStatusKey] ?? STATUS_META.Pending;
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
      // A planned task carries a left accent and a blue tag, so the day's
      // plan is distinguishable at a glance from self-picked work.
      <View style={[styles.taskCard, item.isAssigned && styles.assignedTaskCard]}>
        {item.isAssigned && <View style={styles.assignedAccent} />}
        <View style={styles.taskHeader}>
          <View
            style={[styles.typeWrap, item.isAssigned && styles.assignedTypeWrap]}
          >
            {item.isAssigned && (
              <MaterialCommunityIcons
                name="calendar-check-outline"
                size={12}
                color={appTheme.colors.brand.primary}
                style={styles.assignedTypeIcon}
              />
            )}
            <Text
              style={[styles.taskType, item.isAssigned && styles.assignedTypeText]}
            >
              {taskTag}
            </Text>
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
        {item.isAssigned && (
          <View style={styles.assignedDoneRow}>
            <MaterialCommunityIcons
              name={item.doneCount > 0 ? 'check-circle-outline' : 'repeat'}
              size={13}
              color={
                item.doneCount > 0
                  ? appTheme.colors.status.success
                  : '#64748B'
              }
            />
            <Text
              style={[
                styles.assignedDoneText,
                item.doneCount > 0 && styles.assignedDoneTextActive,
              ]}
            >
              {item.doneCount > 0
                ? `Done ${item.doneCount}× today`
                : 'Open all day · can be picked more than once'}
            </Text>
          </View>
        )}
        <View style={styles.taskFooter}>
          {/* Once an assigned task has been picked, "Pending" no longer
              fits — the card shows when it was last picked instead. */}
          {item.isAssigned && item.doneCount > 0 ? (
            <View style={styles.lastPickChip}>
              <MaterialCommunityIcons
                name="clock-check-outline"
                size={14}
                color={appTheme.colors.status.success}
                style={styles.statusIcon}
              />
              <Text style={styles.lastPickText}>
                Last pick {formatPickTime(item.lastPickAt)}
              </Text>
            </View>
          ) : (
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
          )}

          {isUploading ? (
            <View style={styles.uploadingChip}>
              <ActivityIndicator
                size="small"
                color={appTheme.colors.brand.primary}
              />
              <View>
                <Text style={styles.uploadingChipText}>
                  Uploading {uploadedMedia}/{totalMedia || pendingUploadCount}
                </Text>
                <View style={styles.uploadProgressTrack}>
                  <View
                    style={[
                      styles.uploadProgressFill,
                      {
                        width:
                          totalMedia > 0
                            ? `${Math.min(
                                100,
                                (uploadedMedia / totalMedia) * 100,
                              )}%`
                            : '0%',
                      },
                    ]}
                  />
                </View>
              </View>
            </View>
          ) : null}

          {!isUploading &&
            item.status !== 'Pending' &&
            !!getCompletionDisplayValue(item) && (
              <Text style={styles.taskDateRight}>
                {formatCompletionDate(getCompletionDisplayValue(item))}
              </Text>
            )}

          {!isUploading && item.status === 'Pending' && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleTaskAction(item)}
              activeOpacity={0.8}
            >
              <Text style={styles.actionBtnText}>
                {item.isAssigned && item.doneCount > 0 ? 'Pick Again' : 'Pick Task'}
              </Text>
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
            <TouchableOpacity
              style={styles.upcomingBtn}
              onPress={() => setUpcomingVisible(true)}
              activeOpacity={0.8}>
              <MaterialCommunityIcons
                name="calendar-clock-outline"
                size={15}
                color={appTheme.colors.brand.primary}
              />
              <Text style={styles.upcomingBtnText}>Upcoming</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* SCROLLING LIST AREA */}
        <View style={styles.listContainer}>
          <FlatList
            data={dashboardListData}
            keyExtractor={item =>
              item?._rejected
                ? `rejected_${item.entryKey}`
                : String(item.listKey || item.originalPath || item.id)
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
                    name={
                      !tasksError && metrics.completed > 0
                        ? 'check-circle-outline'
                        : 'clipboard-text-outline'
                    }
                    size={42}
                    color={
                      !tasksError && metrics.completed > 0
                        ? appTheme.colors.status.success
                        : appTheme.colors.neutral.textMuted
                    }
                  />
                  <Text style={styles.emptyTitle}>
                    {tasksError
                      ? 'Unable to load tasks'
                      : metrics.completed > 0
                        ? 'All tasks completed'
                        : 'No tasks found'}
                  </Text>
                  <Text style={styles.emptySubtitle}>
                    {tasksError ||
                      (metrics.completed > 0
                        ? `${metrics.completed} task${metrics.completed > 1 ? 's' : ''} submitted today. New tasks will appear here.`
                        : 'Your assigned tasks will appear here once they are available.')}
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

      <UpcomingTasksModal
        visible={upcomingVisible}
        onClose={() => setUpcomingVisible(false)}
        branch={executiveBranch}
      />

      {/* Task Details (same as Task Monitoring) for a Not Approved task */}
      <RepickTaskDetailModal
        task={detailTask}
        onClose={() => setDetailTask(null)}
        onRepick={handleDetailRepick}
        // View only, leave through OK — either never sent back, or sent back
        // and the 24-hour window has since closed.
        acknowledgeOnly={
          !!detailTask?._rejectedEntry &&
          (!detailTask._rejectedEntry.resubmissionRequired ||
            (!detailTask._rejectedEntry.resubmitted &&
              getEntryWindow(detailTask._rejectedEntry, nowTs).isLocked))
        }
        lockedNote={
          !!detailTask?._rejectedEntry &&
          detailTask._rejectedEntry.resubmissionRequired &&
          !detailTask._rejectedEntry.resubmitted &&
          getEntryWindow(detailTask._rejectedEntry, nowTs).isLocked
        }
        onAcknowledge={handleDetailAcknowledge}
      />

      {/* Unified Task Action Modal */}
      {actionModalVisible && TaskActionModal ? (
        <TaskActionModal
          visible={actionModalVisible}
          onClose={() => {
            setActionModalVisible(false);
            setRepickValues(null);
          }}
          onSaved={() => setTasksReloadToken(token => token + 1)}
          mode={actionModalMode}
          taskOptions={tasks}
          initialTask={actionModalTask}
          initialValues={actionModalMode === 'repick' ? repickValues : undefined}
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
    minHeight: 36,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: appTheme.colors.neutral.text,
    lineHeight: 22,
    includeFontPadding: false,
  },
  upcomingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(18, 59, 74, 0.18)',
    backgroundColor: 'rgba(18, 59, 74, 0.06)',
  },
  upcomingBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: appTheme.colors.brand.primary,
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
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
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
    marginBottom: 6,
    justifyContent: 'space-between',
  },
  typeWrap: {
    backgroundColor: 'rgba(185, 199, 209, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  // ── Calendar-assigned task (the day's plan) ──
  assignedTaskCard: {
    borderColor: 'rgba(18, 59, 74, 0.18)',
    overflow: 'hidden',
  },
  assignedAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: appTheme.colors.brand.primary,
  },
  assignedTypeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(18, 59, 74, 0.10)',
  },
  assignedTypeIcon: {
    marginTop: -1,
  },
  assignedTypeText: {
    color: appTheme.colors.brand.primary,
  },
  assignedDoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: -2,
    marginBottom: 8,
  },
  assignedDoneText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  assignedDoneTextActive: {
    color: appTheme.colors.status.success,
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
    fontSize: 15,
    fontWeight: '800',
    color: appTheme.colors.neutral.text,
    lineHeight: 20,
    marginBottom: 10,
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
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  lastPickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(22, 122, 69, 0.10)',
  },
  lastPickText: {
    fontSize: 11,
    fontWeight: '800',
    color: appTheme.colors.status.success,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appTheme.colors.brand.primaryDark,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 6,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  // Not Approved card in the task list
  rejectedTaskCard: {
    borderColor: 'rgba(180, 35, 24, 0.22)',
    paddingLeft: 18,
    overflow: 'hidden',
  },
  rejectedAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: appTheme.colors.status.danger,
  },
  rejectedHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  rejectedTag: {
    backgroundColor: 'rgba(180, 35, 24, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  rejectedTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: appTheme.colors.status.danger,
    letterSpacing: 0.3,
  },
  rejectedMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: -6,
    marginBottom: 8,
  },
  // Not Approved without resubmission — grey: info only, nothing to fix.
  viewOnlyTaskCard: {
    borderColor: 'rgba(100, 116, 139, 0.28)',
    paddingLeft: 18,
    overflow: 'hidden',
  },
  viewOnlyAccent: {
    backgroundColor: '#94A3B8',
  },
  viewOnlyTag: {
    backgroundColor: 'rgba(100, 116, 139, 0.12)',
  },
  viewOnlyTagText: {
    color: '#475569',
  },
  rejectedDate: {
    fontSize: 12,
    fontWeight: '600',
    color: appTheme.colors.neutral.textMuted,
  },
  // Last two hours of the resubmission window.
  deadlineUrgent: {
    color: appTheme.colors.status.danger,
  },
  repickBtn: {
    backgroundColor: appTheme.colors.status.danger,
  },
  uploadingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  uploadingChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: appTheme.colors.brand.primary,
    letterSpacing: 0.2,
  },
  uploadProgressTrack: {
    marginTop: 4,
    width: 70,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(18, 59, 74, 0.10)',
    overflow: 'hidden',
  },
  uploadProgressFill: {
    height: '100%',
    backgroundColor: appTheme.colors.brand.accent,
    borderRadius: 999,
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
