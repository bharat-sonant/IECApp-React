import { getData } from '../firebase/firebaseService';

/**
 * Calendar-assigned tasks.
 *
 * The portal plans work per DAY and per SITE:
 *   IECData/IECTaskCalendar/{YYYY-MM-DD}/{taskId}/{key}
 *     { taskName, topics: { topicId: topicName },
 *       sites: 'all' | { "Sikar": true, ... }, _at, _by }
 *
 * Nothing is written per executive, so an executive added later is covered
 * automatically: the app reads the day's plan and keeps the entries meant for
 * its own site. Such a task reaches the Dashboard as a KPI task that is
 * already chosen. `topics` holds only the topics to PRE-TICK — the submit
 * screen still lists every topic of the task, and any can be changed.
 */
const ROOT = 'IECData/IECTaskCalendar';

const asString = value =>
  value === null || value === undefined ? '' : String(value).trim();

// Site names are compared trimmed and case-insensitively — the portal's list
// and the employee record are typed by different people.
const siteKey = value => asString(value).toUpperCase();

// Firebase returns numeric-keyed nodes as arrays; handle both shapes.
const childEntries = node =>
  node && typeof node === 'object'
    ? Object.entries(node).filter(
        ([, value]) => value && typeof value === 'object',
      )
    : [];

/**
 * Site ("branch") of an executive.
 *
 * It lives on the employee master, NOT on the IEC user record — the portal
 * reads the same path when it builds its site list, so both sides agree.
 * Returns '' when the employee has no branch; such an executive then only
 * receives assignments made for all sites.
 */
export const loadExecutiveBranch = async empId => {
  const id = asString(empId);
  if (!id) return '';
  try {
    return asString(await getData(`Employees/${id}/GeneralDetails/branch`));
  } catch (error) {
    return '';
  }
};

/** Is this assignment meant for the executive's site? */
export const isForSite = (sites, branch) => {
  if (sites === 'all' || siteKey(sites) === 'ALL') return true;
  if (!sites || typeof sites !== 'object') return false;
  const wanted = siteKey(branch);
  if (!wanted) return false;
  return Object.keys(sites).some(
    site => sites[site] === true && siteKey(site) === wanted,
  );
};

// {topicId: topicName} — Firebase may hand back a sparse array.
const normalizeTopics = topics => {
  if (!topics || typeof topics !== 'object') return null;
  const out = {};
  const entries = Array.isArray(topics)
    ? topics.map((value, index) => [String(index), value])
    : Object.entries(topics);
  entries.forEach(([id, name]) => {
    const key = asString(id);
    const value = asString(name);
    if (key && value) out[key] = value;
  });
  return Object.keys(out).length > 0 ? out : null;
};

/**
 * The day's assignments for one executive's site, shaped like the other
 * Dashboard task cards so they can be merged straight into the list.
 * Returns [] when nothing is planned — never throws.
 */
export const loadAssignedTasks = async (isoDate, branch) => {
  const date = asString(isoDate);
  if (!date) return [];

  let node = null;
  try {
    node = await getData(`${ROOT}/${date}`);
  } catch (error) {
    return [];
  }
  if (!node) return [];

  const tasks = [];
  childEntries(node).forEach(([taskId, byKey]) => {
    childEntries(byKey).forEach(([key, entry]) => {
      if (!isForSite(entry.sites, branch)) return;
      const topics = normalizeTopics(entry.topics);
      const title = asString(entry.taskName) || `Task ${taskId}`;
      tasks.push({
        id: `assigned-${taskId}-${key}`,
        resolvedTaskId: asString(taskId),
        resolvedWardNo: '',
        taskKey: asString(taskId),
        leafKey: asString(key),
        listKey: `Assigned:${date}:${taskId}:${key}`,
        title,
        status: 'Pending',
        type: 'Assigned Task',
        priority: 'low',
        sourceLabel: 'Assigned',
        taskCategory: 'KPI',
        taskDate: date,
        imageUrls: [],
        videoUrls: [],
        images: 0,
        videos: 0,
        description: '',
        // Planned work — the Dashboard tags it, and the topic picker opens
        // with these topics pre-ticked.
        isAssigned: true,
        assignedTopics: topics,
        raw: {
          taskId: asString(taskId),
          name: title,
          topics,
          assignedFrom: 'calendar',
        },
        originalPath: `${ROOT}/${date}/${taskId}/${key}`,
      });
    });
  });

  return tasks;
};
