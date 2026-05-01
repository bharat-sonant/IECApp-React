import { getData } from '../firebase/firebaseService';
import { loadLoginSession } from '../services/sessionService';
import { CITY, getCityStoragePrefix } from '../firebase/firebaseConfig';
import { getTaskCatalog } from './taskCacheService';

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

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const resolveMediaContext = (taskData = null, parentData = null) => {
  const source = parentData || taskData || {};
  return {
    userId: extractUserId(source || taskData),
    taskId: extractTaskId(source || taskData),
    itemKey: extractItemKey(source || taskData),
    dateStr: getDateFromTaskData(source || taskData),
  };
};

const buildStorageUrl = (
  path,
  type = 'media',
  taskData = null,
  parentData = null,
) => {
  if (!path) return null;
  if (path.startsWith('http')) return path;

  // Construct full path from filename + task data
  let fullPath = path;

  if (!path.includes('IECData/') && (taskData || parentData)) {
    const { userId, taskId, itemKey, dateStr } = resolveMediaContext(
      taskData,
      parentData,
    );

    if (dateStr) {
      const year = dateStr.split('-')[0];
      const monthNum = parseInt(dateStr.split('-')[1], 10);
      const month = monthNames[monthNum - 1];

      // Construct the full Firebase Storage path
      // Format: {city}/IECData/IECTasksImages/{userId}/{year}/{month}/{dateStr}/{taskId}/{itemKey}/{filename}
      if (type === 'video') {
        fullPath = `${getCityStoragePrefix(CITY)}IECData/IECTasksVideos/${userId}/${year}/${month}/${dateStr}/${taskId}/${itemKey}/${path}`;
      } else {
        fullPath = `${getCityStoragePrefix(CITY)}IECData/IECTasksImages/${userId}/${year}/${month}/${dateStr}/${taskId}/${itemKey}/${path}`;
      }
    }
  }

  const encodedPath = encodeURIComponent(fullPath);
  
  // Use the task's timestamp as a cache buster to prevent RN from showing old cached images
  // if the same task/path was overwritten.
  let cacheBuster = '';
  const dateStrForBuster = getFirstText(taskData?._at, taskData?.date, parentData?._at, parentData?.date);
  if (dateStrForBuster) {
    const parsed = new Date(dateStrForBuster).getTime();
    if (!Number.isNaN(parsed)) {
      cacheBuster = `&cb=${parsed}`;
    }
  } else {
    // Fallback for local dev testing if they rapidly delete/recreate
    cacheBuster = `&cb=${Date.now()}`;
  }

  const url = `${CITY.firebaseStoragePath}${encodedPath}?alt=media${cacheBuster}`;
  return url;
};

const extractUserId = taskData => {
  if (!taskData) return 'unknown';
  return getFirstText(
    taskData?.userId,
    taskData?.userID,
    taskData?.createdBy,
    taskData?.created_by,
    taskData?.loginId,
    taskData?.employeeId,
    'unknown',
  );
};

const extractTaskId = taskData => {
  if (!taskData) return 'task';
  return getFirstText(
    taskData?.taskId,
    taskData?.taskID,
    taskData?.taskKey,
    taskData?.key,
    taskData?.id,
    'task',
  );
};

const extractItemKey = taskData => {
  if (!taskData) return '1';
  return getFirstText(
    taskData?.key,
    taskData?.itemKey,
    taskData?.mediaKey,
    taskData?.mediaCount,
    taskData?.count,
    taskData?.taskCount,
    '1',
  );
};

const extractUserIdFromPath = path => {
  if (typeof path !== 'string' || !path.trim()) {
    return '';
  }

  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const taskIndex = parts.findIndex(part => part === 'IECTasks');
  if (taskIndex >= 0 && parts.length > taskIndex + 1) {
    return getFirstText(parts[taskIndex + 1], '');
  }

  return '';
};

const resolveSessionUserId = session =>
  getFirstText(
    session?.loginId,
    session?.loginID,
    session?.login_id,
    session?.userId,
    session?.userID,
    session?.employee?.userId,
    session?.employee?.userID,
    session?.employee?.id,
    session?.employee?.employeeId,
    session?.employee?.employeeID,
    session?.employee?.loginId,
    session?.employee?.loginID,
    session?.employee?.login_id,
  );

const getDateFromTaskData = taskData => {
  const _at = taskData?._at || taskData?.createdOn || taskData?.date;
  if (_at) {
    const dateStr = String(_at).split(' ')[0];
    if (dateStr.includes('-')) return dateStr;
  }
  return null;
};

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

const buildTaskTitle = task => {
  return (
    getFirstText(
      task?.title,
      task?.Title,
      task?.taskTitle,
      task?.TaskTitle,
      task?.taskName,
      task?.TaskName,
      task?.name,
      task?.Name,
      task?.subject,
      task?.Subject,
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
    task?.type,
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

const resolveTaskCategory = task => {
  const raw = getFirstText(
    task?.taskCategory,
    task?.TaskCategory,
    task?.category,
    task?.Category,
  ).toLowerCase();

  if (!raw) {
    return 'Other';
  }
  if (raw.includes('kpi')) {
    return 'KPI';
  }
  if (raw.includes('priority')) {
    return 'Priority';
  }
  return 'Other';
};

const resolveCatalogTaskTitle = (catalog, taskKey) => {
  if (!taskKey || !catalog || typeof catalog !== 'object') {
    return '';
  }
  const entry =
    resolveCatalogTaskRecord(catalog, taskKey) ||
    catalog[taskKey];
  if (!entry) {
    return '';
  }
  if (typeof entry === 'string') {
    return entry.trim();
  }
  return getFirstText(
    entry?.name,
    entry?.Name,
    entry?.title,
    entry?.Title,
    entry?.taskName,
    entry?.TaskName,
    entry?.label,
    entry?.Label,
  );
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

const filterActiveTasks = (tasks, taskCatalog = {}) => {
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks.filter(task => {
    const taskId = task?.taskId || task?.resolvedTaskId || task?.id;
    const catalogTask = resolveCatalogTaskRecord(taskCatalog, taskId);

    if (!catalogTask) {
      return !taskCatalog || Object.keys(taskCatalog).length === 0;
    }

    return isCatalogTaskVisible(catalogTask);
  });
};

const TASK_FIELD_KEYS = new Set([
  '_at',
  'address',
  'approvedAt',
  'ApprovedAt',
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

const isTraversableNode = value => Array.isArray(value) || isPlainObject(value);

const getCurrentDateParts = date => {
  const year = String(date.getFullYear());
  const month = date.toLocaleString('en-US', { month: 'long' });
  const monthPadded = String(date.getMonth() + 1).padStart(2, '0');
  const dayPadded = String(date.getDate()).padStart(2, '0');
  return {
    year,
    month,
    isoDate: `${year}-${monthPadded}-${dayPadded}`,
  };
};

const parseDate = value => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
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

const flattenTaskNode = (
  value,
  fallbackType,
  sourceLabel,
  taskCatalog = null,
  baseUserId = '',
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
      const nextTrail = [...trail, key];

      if (isTraversableNode(item)) {
        if (isTaskLeafNode(item)) {
          const taskId = getFirstText(
            nextTrail.length >= 2 ? nextTrail[nextTrail.length - 2] : '',
            item?.taskId,
            item?.TaskId,
            item?.taskKey,
            item?.TaskKey,
            item?.id,
            key,
          );
          const itemKey = getFirstText(
            key,
            item?.key,
            item?.itemKey,
            item?.mediaKey,
            item?.count,
            item?.taskCount,
            '1',
          );
          const id = getFirstText(item?.id, item?.Id, `${sourceLabel}-${index}`);
          const title =
            resolveCatalogTaskTitle(taskCatalog, taskId) ||
            resolveCatalogTaskTitle(taskCatalog, id) ||
            buildTaskTitle(item) ||
            taskId ||
            id;
          const status = resolveTaskStatus(item);
          const type = buildTaskType(item, fallbackType);
          const priority = resolveTaskPriority(item);
          const date = getFirstText(
            item?.date,
            item?.Date,
            item?.taskDate,
            item?.TaskDate,
            item?.createdOn,
            item?.CreatedOn,
          );
          const _at = getFirstText(
            item?._at,
            item?.createdOn,
            item?.CreatedOn,
            item?.timestamp,
          );
          const approvedAt = getFirstText(item?.approvedAt, item?.ApprovedAt);

          const fullPath = `${sourceLabel}:${nextTrail.join('/')}:${id || itemKey}`;
          const signature = `${fullPath}:${title}:${status}:${type}`;
          if (seen.has(signature)) {
            return [];
          }
          seen.add(signature);

          const mediaContext = {
            userId: baseUserId || extractUserId(item),
            taskId,
            itemKey,
            mediaKey: itemKey,
            date: date || _at,
            _at: _at || date,
          };

          const imageKeys = Object.keys(item).filter(name =>
            /^image\d+$/i.test(name),
          );
          const videoKeys = Object.keys(item).filter(name =>
            /^video\d+$/i.test(name),
          );

          // Build full path from filename + task data
          const imageUrls = imageKeys
            .map(k => buildStorageUrl(item[k], 'image', mediaContext, mediaContext))
            .filter(Boolean);
          const videoUrls = videoKeys
            .map(k => buildStorageUrl(item[k], 'video', mediaContext, mediaContext))
            .filter(Boolean);

          return [
            {
              id: fullPath,
              userId: baseUserId || extractUserId(item),
              taskId,
              key: itemKey,
              mediaKey: itemKey,
              listKey: fullPath,
              title,
              status,
              type,
              priority,
              taskCategory: resolveTaskCategory(item),
              date,
              _at,
              approvedAt,
              address: getFirstText(
                item?.address,
                item?.Address,
                item?.location,
                item?.Location,
              ),
              latLng: getFirstText(
                item?.latLng,
                item?.LatLng,
                item?.latitude && item?.longitude
                  ? `${item.latitude},${item.longitude}`
                  : '',
              ),
              remark: getFirstText(
                item?.remark,
                item?.Remark,
                item?.remarks,
                item?.Remarks,
              ),
              images: imageUrls.length,
              videos: videoUrls.length,
              imageUrls,
              videoUrls,
            },
          ];
        }

        return walk(item, nextTrail);
      }

      const taskKey = getFirstText(
        nextTrail.length >= 2 ? nextTrail[nextTrail.length - 2] : '',
        key,
      );
      const title =
        resolveCatalogTaskTitle(taskCatalog, taskKey) ||
        getFirstText(item) ||
        taskKey;
      if (!title) {
        return [];
      }
      const fullPath = `${sourceLabel}:${nextTrail.join('/')}:${getFirstText(key, `${sourceLabel}-${index}`)}`;
      const signature = `${fullPath}:${title}:Pending:${fallbackType}`;
      if (seen.has(signature)) {
        return [];
      }
      seen.add(signature);

      return [
        {
          id: fullPath,
          listKey: fullPath,
          title,
          status: 'Pending',
          type: fallbackType,
          priority: 'Medium',
          taskCategory: 'Other',
          date: '',
          _at: '',
          approvedAt: '',
          address: '',
          latLng: '',
          remark: '',
          images: 0,
          videos: 0,
          imageUrls: [],
          videoUrls: [],
        },
      ];
    });
  };

  return walk(value);
};

export const loadTasks = async selectedDate => {
  const session = await loadLoginSession();
  let loginId = resolveSessionUserId(session);

  const date = parseDate(selectedDate);
  const dateParts = getCurrentDateParts(date);
  const currentTaskPaths = loginId
    ? [`IECData/IECTasks/${loginId}/${dateParts.year}/${dateParts.month}/${dateParts.isoDate}`]
    : [];

  const [taskCatalog, currentResult] = await Promise.all([
    getTaskCatalog(),
    currentTaskPaths.length
      ? readFirstExistingPath(currentTaskPaths)
      : Promise.resolve({ path: null, value: null }),
  ]);

  if (!loginId) {
    loginId = extractUserIdFromPath(currentResult.path);
  }

  if (!loginId) {
    return [];
  }

  const currentTasks = flattenTaskNode(
    currentResult.value,
    'Task',
    'Task',
    taskCatalog,
    loginId,
  ).map(task => ({
    ...task,
    date: task.date || dateParts.isoDate,
  }));

  return filterActiveTasks(currentTasks, taskCatalog);
};
