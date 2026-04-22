import { getData } from '../firebase/firebaseService';
import { loadLoginSession } from '../services/sessionService';

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
          const taskKey = getFirstText(
            nextTrail.length >= 2 ? nextTrail[nextTrail.length - 2] : '',
            key,
          );
          const id = getFirstText(
            item?.id,
            item?.Id,
            item?.taskId,
            item?.TaskId,
            key,
            `${sourceLabel}-${index}`,
          );
          const title =
            buildTaskTitle(item) ||
            resolveCatalogTaskTitle(taskCatalog, taskKey) ||
            resolveCatalogTaskTitle(taskCatalog, id) ||
            taskKey ||
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

          const fullPath = `${sourceLabel}:${nextTrail.join('/')}:${id}`;
          const signature = `${fullPath}:${title}:${status}:${type}`;
          if (seen.has(signature)) {
            return [];
          }
          seen.add(signature);

          return [
            {
              id: fullPath,
              taskKey,
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
              remark: getFirstText(
                item?.remark,
                item?.Remark,
                item?.remarks,
                item?.Remarks,
              ),
              images: Object.keys(item).filter(name => /^image\d+$/i.test(name))
                .length,
              videos: Object.keys(item).filter(name => /^video\d+$/i.test(name))
                .length,
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
        getFirstText(item) ||
        resolveCatalogTaskTitle(taskCatalog, taskKey) ||
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
          remark: '',
          images: 0,
          videos: 0,
        },
      ];
    });
  };

  return walk(value);
};

export const loadTasks = async selectedDate => {
  const session = await loadLoginSession();
  const loginId = getFirstText(
    session?.loginId,
    session?.employee?.userId,
    session?.employee?.id,
    session?.employee?.loginId,
  );

  if (!loginId) {
    return [];
  }

  const date = parseDate(selectedDate);
  const dateParts = getCurrentDateParts(date);
  const currentTaskPaths = [
    `IECData/IECTasks/${loginId}/${dateParts.year}/${dateParts.month}/${dateParts.isoDate}`,
  ];

  const [taskCatalog, currentResult] = await Promise.all([
    getData('IECData/Tasks'),
    readFirstExistingPath(currentTaskPaths),
  ]);

  const currentTasks = flattenTaskNode(
    currentResult.value,
    'Task',
    'Task',
    taskCatalog,
  ).map(task => ({
    ...task,
    date: task.date || dateParts.isoDate,
  }));

  return currentTasks;
};
