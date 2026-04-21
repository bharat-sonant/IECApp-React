import React, {useEffect, useMemo, useState} from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import appTheme from '../theme/appTheme';
import CommonLoader from '../components/CommonLoader';
import TaskActionModal from '../components/TaskActionModal';
import {getData} from '../firebase/firebaseService';
import {clearLoginSession, loadLoginSession} from '../services/sessionService';
import {useAppFeedback} from '../components/AppFeedback';

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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
  const month = parsed.toLocaleString('en-US', {month: 'short'});
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
    return approvedRaw === '0' || approvedRaw === 'false' ? 'Not Approved' : 'Approved';
  }

  const rawStatus = getFirstText(task?.status, task?.Status, task?.taskStatus, task?.TaskStatus).toLowerCase();
  if (!rawStatus) {
    return 'Pending';
  }

  if (rawStatus.includes('approve')) {
    return 'Approved';
  }

  if (rawStatus === '1' || rawStatus.includes('complete') || rawStatus.includes('done')) {
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

const resolveLeafTitle = task =>
  getFirstText(
    task?.task,
    task?.Task,
    task?.title,
    task?.TaskTitle,
    task?.name,
    task?.Name,
    task?.desc,
    task?.Desc,
    task?.description,
    task?.Description,
    task?.remarks,
    task?.Remarks,
  ) || buildTaskTitle(task);

const resolveTaskCategory = task =>
  getFirstText(
    task?.taskCategory,
    task?.TaskCategory,
    task?.category,
    task?.Category,
  );

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

  return getFirstText(entry?.name, entry?.title, entry?.taskName, entry?.TaskName, entry?.label);
};

const compactArrayForLog = value => {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.filter(item => item !== null && item !== undefined);
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

  const wardNo = normalizeIdentityText(task?.resolvedWardNo, task?.raw?.wardNo, task?.raw?.WardNo);
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

  const pathIdentity = normalizeIdentityText(task?.originalPath, task?.raw?.originalPath);
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

  return baseIdentity || normalizeIdentityText(task?.title, task?.taskDate, task?.raw?._at, task?.raw?.approvedAt);
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
        taskDate: getFirstText(currentTask.raw?._at, currentTask.taskDate, task.taskDate),
        raw: currentTask.raw || task.raw,
        completedAt: getFirstText(currentTask.raw?._at, currentTask.raw?.createdAt, currentTask.raw?.updatedAt, task.completedAt),
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

const getTaskStatusRank = status => {
  const normalized = getFirstText(status).toLowerCase();
  if (normalized.includes('completed')) return 3;
  if (normalized.includes('approved')) return 2;
  if (normalized.includes('not approved') || normalized.includes('rejected')) return 1;
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

  const preferred = incomingRank > existingRank || (incomingRank === existingRank && incomingTime >= existingTime)
    ? {...existing, ...incoming}
    : {...incoming, ...existing};

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
  'title',
  'Title',
  'type',
  'Type',
  'wardNo',
  'video1',
  'video2',
]);

const isTaskLeafNode = item => {
  if (!isPlainObject(item)) {
    return false;
  }

  return Object.keys(item).some(key => TASK_FIELD_KEYS.has(key));
};

const buildTaskFromPrimitive = (item, key, index, fallbackType, sourceLabel, rootPath = '', nextPath = '') => {
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

const flattenTaskNode = (value, fallbackType, sourceLabel, rootPath = '', taskCatalog = null) => {
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
            fallbackId = nextTrail.length >= 2 ? nextTrail[nextTrail.length - 2] : key;
          } else if (sourceLabel?.includes('Priority')) {
            const parentKey = nextTrail.length >= 2 ? nextTrail[nextTrail.length - 2] : key;
            fallbackId = parentKey;
            fallbackWardNo = parentKey;
          }
          const resolvedTaskId = getFirstText(item?.taskId, item?.TaskId, item?.id, item?.Id, fallbackId);
          const resolvedWardNo = getFirstText(item?.wardNo, item?.WardNo, fallbackWardNo);
          const taskKey = getFirstText(fallbackId, key);
          const id = getFirstText(item?.taskId, item?.TaskId, item?.id, item?.Id, fallbackId, `${sourceLabel}-${index}`);
          const title =
            resolveLeafTitle(item) ||
            resolveCatalogTaskTitle(taskCatalog, resolvedTaskId) ||
            resolveCatalogTaskTitle(taskCatalog, id) ||
            resolvedTaskId ||
            id;
          const status = resolveTaskStatus(item);
          const priority = resolveTaskPriority(item);
          const type = buildTaskType(item, fallbackType);
          const taskCategory = resolveTaskCategory(item) || sourceLabel;
          const hasApprovalMeta = Boolean(getFirstText(item?.approvedBy, item?.ApprovedBy, item?.approvedAt, item?.ApprovedAt));
          const resolvedStatus =
            sourceLabel === 'Current' ? (hasApprovalMeta ? 'Approved' : 'Completed') : status;
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

          const signature = `${sourceLabel}:${nextPath}:${id}:${title}:${status}:${type}`;
          if (seen.has(signature)) {
            console.log('[DashboardTasks] duplicate leaf skipped:', signature);
            return [];
          }
          seen.add(signature);

          console.log('[DashboardTasks] status resolve:', {
            sourceLabel,
            path: nextPath,
            id,
            rawFields: {
              _at: item?._at,
              address: item?.address,
              approvedAt: item?.approvedAt,
              approvedBy: item?.approvedBy,
              approvedStatus: item?.approvedStatus,
              approvalStatus: item?.approvalStatus,
              completionStatus: item?.completionStatus,
              latLng: item?.latLng,
              noOfParticipants: item?.noOfParticipants,
              remark: item?.remark,
              status: item?.status,
              taskCategory: item?.taskCategory,
              type: item?.type,
              wardNo: item?.wardNo,
              video1: item?.video1,
              video2: item?.video2,
            },
            resolvedStatus: status,
          });

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
              raw: item,
              originalPath: rootPath && nextPath ? `${rootPath}/${nextPath}` : null,
            },
          ];
        }

        return walk(item, nextTrail);
      }

      const taskKey = getFirstText(nextTrail.length >= 2 ? nextTrail[nextTrail.length - 2] : '', key);
      const primitiveTitle = getFirstText(item) || resolveCatalogTaskTitle(taskCatalog, taskKey) || taskKey;
      if (!primitiveTitle) {
        return [];
      }

      const id = getFirstText(key, `${sourceLabel}-${index}`);
      const signature = `${sourceLabel}:${nextPath}:${id}:${primitiveTitle}:Pending:${fallbackType}`;
      if (seen.has(signature)) {
        console.log('[DashboardTasks] duplicate leaf skipped:', signature);
        return [];
      }
      seen.add(signature);

      console.log('[DashboardTasks] status resolve:', {
        sourceLabel,
        path: nextPath,
        id,
        taskKey,
        rawFields: {primitiveValue: item},
        resolvedStatus: 'Pending',
      });

      return [buildTaskFromPrimitive(primitiveTitle, key, index, fallbackType, sourceLabel, rootPath, nextPath)];
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
    const pathIdentity = getFirstText(task.originalPath, task.raw?.originalPath);

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
    const preferred = {...existing};

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
  const monthName = now.toLocaleString('en-US', {month: 'long'});
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
    console.log('[DashboardTasks] checking path:', path);
    const value = await getData(path);
    if (hasTaskData(value)) {
      console.log('[DashboardTasks] path hit:', {
        path,
        keys: Array.isArray(value)
          ? value
              .map((item, index) => (item === null || item === undefined ? null : String(index)))
              .filter(Boolean)
          : Object.keys(value),
        value: compactArrayForLog(value),
      });
      return {path, value};
    }

    console.log('[DashboardTasks] path empty:', path);
  }

  console.log('[DashboardTasks] no matching path found:', paths);
  return {path: null, value: null};
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

const DashboardScreen = ({navigation}) => {
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
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
  const {showAlert} = useAppFeedback();

  const metrics = useMemo(() => {
    const pendingCount = tasks.filter(task => task.status === 'Pending').length;
    const completedCount = tasks.filter(task => task.status === 'Completed' || task.status === 'Approved').length;
    return {total: tasks.length, pending: pendingCount, completed: completedCount};
  }, [tasks]);

  useEffect(() => {
    console.log(
      '[DashboardTasks] tasks state updated:',
      tasks.map(task => ({
        id: task.id,
        title: task.title,
        status: task.status,
        type: task.type,
        priority: task.priority,
        sourceLabel: task.sourceLabel,
        taskDate: task.taskDate,
      })),
    );
    console.log('[DashboardTasks] tasks summary:', {
      total: tasks.length,
      pending: tasks.filter(task => task.status === 'Pending').length,
      approved: tasks.filter(task => task.status === 'Approved').length,
      completed: tasks.filter(task => task.status === 'Completed').length,
      notApproved: tasks.filter(task => task.status === 'Not Approved').length,
    });
  }, [tasks]);

  useEffect(() => {
    let isActive = true;

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
        setLoginId(session.loginId || session.employee?.userId || session.employee?.id || '');
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

      try {
        const dateParts = getCurrentDateParts();
        console.log('[DashboardTasks] load start:', {
          loginId,
          reloadToken: tasksReloadToken,
          dateParts,
        });

        const kpiPaths = [
          `IECData/IECKPITasks/${loginId}`,
        ];

        const priorityPaths = [
          `IECData/IECPriorityTasks/${loginId}/${dateParts.isoDate}`,
        ];

        const currentTaskPaths = [
          `IECData/IECTasks/${loginId}/${dateParts.year}/${dateParts.monthName}/${dateParts.isoDate}`,
        ];

        console.log('[DashboardTasks] source paths:', {
          priorityPaths,
          currentTaskPaths,
        });

        const [taskCatalog, kpiResult, priorityResult, currentResult] = await Promise.all([
          getData('IECData/Tasks'),
          readFirstExistingPath(kpiPaths),
          readFirstExistingPath(priorityPaths),
          readFirstExistingPath(currentTaskPaths),
        ]);

        console.log('[DashboardTasks] raw source values:', {
          taskCatalog,
          kpiResult,
          priorityResult,
          currentResult: {
            ...currentResult,
            value: compactArrayForLog(currentResult.value),
          },
        });

        const kpiTasks = flattenTaskNode(kpiResult.value, 'KPI Task', 'KPI', kpiResult.path, taskCatalog);
        const priorityTasks = flattenTaskNode(priorityResult.value, 'Priority Task', 'Priority', priorityResult.path, taskCatalog);
        const currentTasks = flattenTaskNode(currentResult.value, 'Current Task', 'Current', currentResult.path, taskCatalog);
        const currentStatusMap = buildCurrentStatusMap(currentTasks);
        const displayableCurrentTasks = buildDisplayableCurrentTasks(currentTasks);

        const assignedTasks = applyCurrentStatusMap(mergeAssignedTasks(kpiTasks, priorityTasks), currentStatusMap);
        const combinedTasks = [...assignedTasks, ...displayableCurrentTasks];
        const dedupedTasks = dedupeDashboardTasks(combinedTasks).sort((left, right) => {
          const leftRank = getDashboardTaskOrderRank(left);
          const rightRank = getDashboardTaskOrderRank(right);
          if (leftRank !== rightRank) {
            return leftRank - rightRank;
          }

          const statusDelta = getTaskStatusRank(right.status) - getTaskStatusRank(left.status);
          if (statusDelta !== 0) {
            return statusDelta;
          }

          return String(left.title || '').localeCompare(String(right.title || ''));
        });

        console.log(
          '[DashboardTasks] normalized task list:',
          dedupedTasks.map(task => ({
            id: task.id,
            title: task.title,
            status: task.status,
            type: task.type,
            priority: task.priority,
            sourceLabel: task.sourceLabel,
            taskDate: task.taskDate,
          })),
        );

        if (isActive) {
          setTasks(dedupedTasks);
          console.log('[DashboardTasks] setTasks applied:', dedupedTasks.length);
        }
      } catch (error) {
        if (isActive) {
          setTasks([]);
          setTasksError(error?.message || 'Unable to load tasks.');
          console.log('[DashboardTasks] load error:', error?.message || error);
        }
      } finally {
        if (isActive) {
          setTasksLoading(false);
          setTasksRefreshing(false);
        }
      }
    };

    loadTasks();

    return () => {
      isActive = false;
    };
  }, [loginId, tasksReloadToken]);

  const handleRefreshTasks = async () => {
    console.log('[DashboardTasks] refresh requested');
    setTasksRefreshing(true);
    setTasksError('');

    try {
      const session = await loadLoginSession();
      const refreshedLoginId = session?.loginId || session?.employee?.userId || session?.employee?.id || '';
      console.log('[DashboardTasks] refresh session:', {
        refreshedLoginId,
      });
      setLoginId(refreshedLoginId);
      setTasksReloadToken(token => token + 1);
    } catch (error) {
      console.log('[DashboardTasks] refresh error:', error?.message || error);
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
            await clearLoginSession();
            navigation.replace('Login');
          },
        },
      ],
    });
  };

  const handleTaskAction = (task) => {
    if (task.status === 'Pending') {
      setActionModalTask(task);
      setActionModalMode('pick_task');
      setActionModalVisible(true);
    }
  };

  const handleAddTask = (mode) => {
    setFabOpen(false);
    setActionModalTask(null);
    setActionModalMode(mode);
    setActionModalVisible(true);
  };

  const renderTask = ({item}) => {
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
          <View style={[styles.priorityWrap, {backgroundColor: priorityBackgroundColor, borderColor: priorityBorderColor}]}>
            <MaterialCommunityIcons name="flag-variant-outline" size={12} color={priorityColor} />
            <Text style={[styles.priorityText, {color: priorityColor}]}>{taskPriorityChip}</Text>
          </View>
        </View>

        <Text style={styles.taskTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <View style={styles.taskFooter}>
          <View style={[styles.statusChip, {backgroundColor: status.backgroundColor}]}>
            <MaterialCommunityIcons name={status.icon} size={14} color={status.textColor} style={styles.statusIcon} />
            <Text style={[styles.statusText, {color: status.textColor}]}>{status.label}</Text>
          </View>

          {!!getCompletionDisplayValue(item) && (
            <Text style={styles.taskDateRight}>{formatCompletionDate(getCompletionDisplayValue(item))}</Text>
          )}

          {item.status === 'Pending' && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => handleTaskAction(item)} activeOpacity={0.8}>
              <Text style={styles.actionBtnText}>Pick Task</Text>
              <MaterialCommunityIcons name="arrow-right-circle" size={16} color="#FFF" />
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
        subMessage="Fetching your assigned work from Firebase"
      />

      {/* Close FAB menu when touching outside via absolute fill instead of wrapping */}
      {fabOpen && (
        <Pressable 
          style={styles.overlayBlocker} 
          onPress={() => setFabOpen(false)} 
        />
      )}
      <View style={styles.container}>
          
          {/* STATIC HEADER AREA */}
          <View style={styles.staticTopSection}>
            <View style={styles.header}>
              <View>
                <Text style={styles.greeting}>Good Morning,</Text>
                <Text style={styles.userName}>{employeeName}</Text>
              </View>
              <TouchableOpacity 
                style={styles.menuIconWrap} 
                onPress={() => setMenuOpen(true)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="dots-vertical" size={24} color={appTheme.colors.brand.primaryDark} />
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
              keyExtractor={item => String(item.listKey || item.originalPath || item.id)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 80 }]}
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
                      {tasksError || 'Your assigned tasks will appear here once they are available.'}
                    </Text>
                  </View>
                ) : null
              }
              onScroll={() => {
                 if (fabOpen) setFabOpen(false);
              }}
            />
            {!!tasksError && !tasksLoading && <Text style={styles.errorText}>{tasksError}</Text>}
          </View>

          {/* FAB BUTTON */}
          <View style={[styles.fabWrap, {bottom: Math.max(insets.bottom + 16, 16)}]}>
            {fabOpen && (
              <View style={styles.fabMenuPanel}>
                <TouchableOpacity 
                  style={styles.fabPanelItem} 
                  onPress={() => handleAddTask('add_kpi')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.fabPanelIcon, styles.fabIconKpi]}>
                    <MaterialCommunityIcons name="clipboard-plus-outline" size={18} color={appTheme.colors.brand.primaryDark} />
                  </View>
                  <View>
                    <Text style={styles.fabPanelTitle}>Add KPI Task</Text>
                    <Text style={styles.fabPanelSubtitle}>Create a new KPI</Text>
                  </View>
                </TouchableOpacity>

                <View style={styles.fabDivider} />

                <TouchableOpacity 
                  style={styles.fabPanelItem} 
                  onPress={() => handleAddTask('add_other')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.fabPanelIcon, styles.fabIconOther]}>
                    <MaterialCommunityIcons name="playlist-plus" size={18} color={appTheme.colors.brand.primaryDark} />
                  </View>
                  <View>
                    <Text style={styles.fabPanelTitle}>Add Other Task</Text>
                    <Text style={styles.fabPanelSubtitle}>Non-KPI assignment</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity 
              style={styles.fabButton}
              onPress={() => setFabOpen(!fabOpen)}
              activeOpacity={0.9}
            >
              <MaterialCommunityIcons name={fabOpen ? "close" : "plus"} size={26} color="#FFF" />
            </TouchableOpacity>
          </View>
          
        </View>

      {/* Menu Modal */}
      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuPanel}>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                navigation?.navigate?.('TaskMonitoring');
              }}
              style={({pressed}) => [styles.menuItem, pressed && styles.menuItemPressed]}
            >
              <View style={[styles.menuIcon, styles.menuIconPrimary]}>
                <MaterialCommunityIcons name="clipboard-text-outline" size={18} color={appTheme.colors.brand.primaryDark} />
              </View>
              <View style={styles.menuTextWrap}>
                <Text style={styles.menuTitle}>Task Monitoring</Text>
                <Text style={styles.menuSubtitle}>View overall stats</Text>
              </View>
            </Pressable>

            <View style={styles.menuDivider} />

            <Pressable
              onPress={handleLogout}
              style={({pressed}) => [styles.menuItem, pressed && styles.menuItemPressed]}
            >
              <View style={[styles.menuIcon, styles.menuIconDanger]}>
                <MaterialCommunityIcons name="logout-variant" size={18} color={appTheme.colors.status.danger} />
              </View>
              <View style={styles.menuTextWrap}>
                <Text style={styles.menuTitle}>Logout</Text>
                <Text style={styles.menuSubtitle}>Exit application</Text>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Unified Task Action Modal */}
      <TaskActionModal 
        visible={actionModalVisible} 
        onClose={() => setActionModalVisible(false)} 
        onSaved={() => setTasksReloadToken(token => token + 1)}
        mode={actionModalMode}
        taskOptions={tasks}
        initialTask={actionModalTask}
      />
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
    justifyContent: 'space-between'
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
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
    paddingTop: 72,
    paddingRight: 20,
    alignItems: 'flex-end',
  },
  menuPanel: {
    width: 240,
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.3)',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: {width: 0, height: 10},
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
