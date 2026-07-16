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
  console.log('[buildStorageUrl]', {
    type,
    inputPath: path,
    resolvedContextDate:
      (parentData && parentData.date) ||
      (taskData && taskData.date) ||
      null,
    resolvedContextAt:
      (parentData && parentData._at) || (taskData && taskData._at) || null,
    fullPath,
    url,
  });
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
  // `date` is the ISO date of the DB path (set by the caller via mediaContext)
  // and is the source of truth for storage-path construction. `_at` gets
  // updated on re-pick and would produce a wrong storage URL if used first.
  const source =
    taskData?.date || taskData?._at || taskData?.createdOn;
  if (source) {
    const dateStr = String(source).split(' ')[0];
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
  // approvalHistory (if present) is the source of truth: the LATEST entry's
  // status decides current UI status. This way a user re-pick immediately
  // moves status back to Pending without clearing portal-set flags.
  const history = task?.approvalHistory;
  if (history && typeof history === 'object') {
    // Firebase may store numeric-keyed nodes as an array — handle both shapes.
    const ranked = Object.keys(history)
      .map(k => ({ key: k, num: parseInt(k, 10), entry: history[k] }))
      .filter(x => x.entry && typeof x.entry === 'object')
      .sort((a, b) => {
        if (Number.isFinite(a.num) && Number.isFinite(b.num)) {
          return b.num - a.num;
        }
        if (Number.isFinite(a.num)) return -1;
        if (Number.isFinite(b.num)) return 1;
        return String(b.key).localeCompare(String(a.key));
      });
    if (ranked.length > 0) {
      const latestStatus = String(
        ranked[0].entry?.status || ranked[0].entry?.action || '',
      )
        .toLowerCase()
        .trim();
      if (latestStatus === 'resubmitted') {
        return 'Pending';
      }
      if (latestStatus === 'not_approved' || latestStatus === 'notapproved') {
        return 'Not Approved';
      }
      if (latestStatus === 'approved') {
        return 'Approved';
      }
    }
  }

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
  baseDate = '',
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
            // Storage-path date MUST be the ISO date of the DB path being
            // walked — NOT `_at`, because `_at` gets overwritten on re-pick
            // and would then generate a wrong storage URL (pointing to a
            // path that doesn't exist).
            date: baseDate || date || _at,
            _at: _at || date,
          };

          const imageKeys = Object.keys(item).filter(name =>
            /^image\d+$/i.test(name),
          );
          const videoKeys = Object.keys(item).filter(name =>
            /^video\d+$/i.test(name),
          );

          // Build full path from filename + task data
          const imageSlots = imageKeys
            .map(k => {
              const filename = getFirstText(item?.[k]);
              const url = buildStorageUrl(item[k], 'image', mediaContext, mediaContext);
              if (!url) return null;
              return { slotKey: k, filename, url };
            })
            .filter(Boolean);
          const videoSlots = videoKeys
            .map(k => {
              const filename = getFirstText(item?.[k]);
              const url = buildStorageUrl(item[k], 'video', mediaContext, mediaContext);
              if (!url) return null;
              return { slotKey: k, filename, url };
            })
            .filter(Boolean);
          const imageUrls = imageSlots.map(s => s.url);
          const videoUrls = videoSlots.map(s => s.url);

          // Prefer the walked base date (DB path date) — `_at` can drift
          // forward on re-pick and would produce a wrong path.
          const isoDateForPath =
            baseDate || date || (_at ? String(_at).split(' ')[0] : '');
          const dateForPath = isoDateForPath && isoDateForPath.includes('-')
            ? isoDateForPath
            : '';
          const yearForPath = dateForPath ? dateForPath.split('-')[0] : '';
          const monthNumForPath = dateForPath
            ? parseInt(dateForPath.split('-')[1], 10)
            : NaN;
          const monthNameForPath =
            Number.isFinite(monthNumForPath) && monthNumForPath >= 1 && monthNumForPath <= 12
              ? monthNames[monthNumForPath - 1]
              : '';

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
              notApprovedRemark: getFirstText(item?.notApprovedRemark),
              wardNo: getFirstText(item?.wardNo, item?.WardNo, item?.ward),
              noOfParticipants: getFirstText(
                item?.noOfParticipants,
                item?.NoOfParticipants,
                item?.participants,
              ),
              maleCount: getFirstText(item?.maleCount, item?.MaleCount),
              femaleCount: getFirstText(item?.femaleCount, item?.FemaleCount),
              otherCount: getFirstText(item?.otherCount, item?.OtherCount),
              ageBelow18: getFirstText(item?.ageBelow18, item?.AgeBelow18),
              // Firebase may return a numeric-keyed topics node as either a
              // sparse array [null, val2, null, val4, val5] or as an object
              // {2:.., 4:.., 5:..}. Normalize either shape to {id: name}.
              topics: (() => {
                const src = item?.topics;
                if (!src || typeof src !== 'object') return null;
                const out = {};
                const entries = Array.isArray(src)
                  ? src.map((v, i) => [String(i), v])
                  : Object.entries(src);
                for (const [k, v] of entries) {
                  if (v === null || v === undefined) continue;
                  const key = String(k);
                  const val = String(v).trim();
                  if (key && val) {
                    out[key] = val;
                  }
                }
                return Object.keys(out).length > 0 ? out : null;
              })(),
              images: imageUrls.length,
              videos: videoUrls.length,
              imageUrls,
              videoUrls,
              imageSlots,
              videoSlots,
              taskCount: itemKey,
              taskKey: taskId,
              datePath: {
                year: yearForPath,
                month: monthNameForPath,
                isoDate: dateForPath,
              },
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
          notApprovedRemark: '',
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
    dateParts.isoDate,
  ).map(task => ({
    ...task,
    date: task.date || dateParts.isoDate,
  }));

  return filterActiveTasks(currentTasks, taskCatalog);
};
