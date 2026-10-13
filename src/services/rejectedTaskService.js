import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getData,
  initializeFirebaseApp,
  updateData,
} from '../firebase/firebaseService';
import { FIREBASE_CONFIG } from '../firebase/firebaseConfig';
import { ERROR_CATEGORY, logError } from './errorLogService';

/**
 * Rejected-task list — one entry per Not Approved task of an executive,
 * nested like the task records (date, taskId and key come from the path):
 *   IECData/IECRejectedTasks/{empId}/{date}/{taskId}/{key}
 *     { taskName, remark, rejectedBy, rejectedByName, rejectedAt,
 *       resubmissionRequired }
 * The portal writes an entry when a task is marked Not Approved and removes
 * it when the task is approved.
 *   resubmissionRequired true (or missing, older entries) — Re-pick card; on
 *     resubmit the app only marks it `resubmitted` (the Dashboard then shows
 *     it as Re-Submitted until approved).
 *   resubmissionRequired false — "Do Not Send for Resubmission": the
 *     executive is only informed (popup with the reason); once they tap OK
 *     the app marks it `acknowledged` and it never shows again.
 *
 * A task sent back must be re-picked within RESUBMISSION_WINDOW_HOURS of the
 * rejection. After that the entry is LOCKED: no Re-pick button, and a late
 * submission is refused. The window is DERIVED from `rejectedAt` — nothing is
 * stored, so the app and the portal can never disagree.
 */
const ROOT = 'IECData/IECRejectedTasks';

export const RESUBMISSION_WINDOW_HOURS = 24;
const WINDOW_MS = RESUBMISSION_WINDOW_HOURS * 60 * 60 * 1000;

// "YYYY-MM-DD HH:mm[:ss]" or ISO -> Date. Android's Date cannot parse the
// space form, so the space becomes a 'T' first.
export const parseRejectedAt = value => {
  const text = asString(value);
  if (!text) return null;
  const date = new Date(text.includes('T') ? text : text.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Resubmission window of one rejected entry.
 * Returns { deadlineAt, isLocked, msLeft } — deadlineAt is null when the
 * entry has no usable timestamp, and such an entry is never locked.
 */
export const getEntryWindow = (entry, now = Date.now()) => {
  const start = parseRejectedAt(entry?.rejectedAt);
  if (!start) return { deadlineAt: null, isLocked: false, msLeft: 0 };
  const deadlineAt = new Date(start.getTime() + WINDOW_MS);
  const msLeft = deadlineAt.getTime() - now;
  return { deadlineAt, isLocked: msLeft <= 0, msLeft: Math.max(msLeft, 0) };
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Older rejections (from before this list existed) are picked up once per
// user by scanning the last BACKFILL_DAYS of their tasks.
const BACKFILL_DAYS = 30;
const backfillFlagKey = userId => `@iec_rejected_backfill_done_${userId}`;

const asString = value =>
  value === null || value === undefined ? '' : String(value).trim();

// In-app id of an entry (card keys, "shown" tracking) — not a DB key.
export const buildRejectedEntryKey = (date, taskId, key) =>
  `${asString(date)}_${asString(taskId)}_${asString(key)}`;

const entryPath = (userId, date, taskId, key) =>
  `${ROOT}/${asString(userId)}/${asString(date)}/${asString(taskId)}/${asString(key)}`;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Child nodes as [key, value] pairs. Firebase returns a node with numeric
// keys (taskId, key) as an array, so both shapes are handled.
const childEntries = node =>
  node && typeof node === 'object'
    ? Object.entries(node).filter(([, value]) => value && typeof value === 'object')
    : [];

// {date: {taskId: {key: entry}}} -> flat list, newest rejection first.
// Anything that is not a date at the top level (e.g. old flat test entries)
// is skipped.
const toList = node => {
  const list = [];
  childEntries(node).forEach(([date, byTask]) => {
    if (!DATE_KEY.test(date)) return;
    childEntries(byTask).forEach(([taskId, byKey]) => {
      childEntries(byKey).forEach(([key, value]) => {
        // Older entries have no flag — they were all sent back for re-pick.
        const sendBack = value.resubmissionRequired !== false;
        // Only a task sent back has a window; an info-only entry never
        // expires, it just waits to be acknowledged.
        const window = sendBack
          ? getEntryWindow(value)
          : { deadlineAt: null, isLocked: false, msLeft: 0 };
        list.push({
          ...value,
          entryKey: buildRejectedEntryKey(date, taskId, key),
          date,
          taskId,
          key,
          resubmissionRequired: sendBack,
          deadlineAt: window.deadlineAt,
          isLocked: window.isLocked,
          msLeft: window.msLeft,
        });
      });
    });
  });
  return list.sort((a, b) =>
    asString(b.rejectedAt).localeCompare(asString(a.rejectedAt)),
  );
};

// Task category (KPI / Priority / Other) of each rejected task, read from the
// task record itself so the card can show the same tag + priority as the
// normal task list. Cached per entry for the app session.
const categoryCache = new Map();

const withCategories = async (userId, list) => {
  await Promise.all(
    list.map(async entry => {
      if (entry.taskCategory || categoryCache.has(entry.entryKey)) return;
      const [year, monthNum] = asString(entry.date).split('-');
      const month = MONTH_NAMES[Number(monthNum) - 1];
      if (!year || !month) return;
      const category = await getData(
        `IECData/IECTasks/${userId}/${year}/${month}/${entry.date}/${entry.taskId}/${entry.key}/taskCategory`,
      );
      categoryCache.set(entry.entryKey, asString(category));
    }),
  );
  return list.map(entry => ({
    ...entry,
    taskCategory: entry.taskCategory || categoryCache.get(entry.entryKey) || '',
  }));
};

/**
 * Live listener on the executive's "To Resubmit" list.
 * onChange(list) fires immediately and on every change.
 * Returns an unsubscribe function.
 */
export const subscribeRejectedTasks = (userId, onChange) => {
  const id = asString(userId);
  if (!id) {
    onChange?.([]);
    return () => {};
  }

  let unsubscribe = () => {};
  let cancelled = false;

  (async () => {
    try {
      const { getDatabase, ref, onValue } = require('@react-native-firebase/database');
      const app = await initializeFirebaseApp();
      if (cancelled) return;
      const db = getDatabase(app, FIREBASE_CONFIG?.databaseURL);
      // Each snapshot gets a sequence number so a slow category lookup for an
      // older snapshot can never overwrite a newer list.
      let seq = 0;
      unsubscribe = onValue(
        ref(db, `${ROOT}/${id}`),
        async snapshot => {
          const current = ++seq;
          const list = await withCategories(
            id,
            toList(snapshot.exists() ? snapshot.val() : null),
          );
          if (!cancelled && current === seq) onChange?.(list);
        },
        error => logError(ERROR_CATEGORY.Startup, error, { step: 'subscribeRejectedTasks' }),
      );
    } catch (error) {
      logError(ERROR_CATEGORY.Startup, error, { step: 'subscribeRejectedTasks' });
    }
  })();

  return () => {
    cancelled = true;
    unsubscribe();
  };
};

/**
 * Mark a rejected task as resubmitted. The entry is kept so the Dashboard can
 * show it as a normal "Completed" card (like any submitted task) until the
 * approver acts: the portal removes it on approve, and a new rejection
 * overwrites it (back to Re-pick).
 */
export const markRejectedTaskResubmitted = async (
  userId,
  date,
  taskId,
  key,
  resubmittedAt,
) => {
  const id = asString(userId);
  if (!id || !date || !taskId || !key) return;
  const path = entryPath(id, date, taskId, key);
  // Only a task that is actually on the list — never create a half entry.
  if (!(await getData(path))) return;
  await updateData(path, {
    resubmitted: true,
    resubmittedAt: asString(resubmittedAt),
  });
};

/**
 * The executive viewed a "Not Approved — no resubmission" task and tapped
 * OK: mark the entries `acknowledged` (the card leaves the Dashboard for
 * good) and stamp the task record with `rejectionSeenAt`.
 */
export const acknowledgeRejectedTasks = async (userId, entries, seenAt) => {
  const id = asString(userId);
  if (!id || !Array.isArray(entries) || !entries.length) return;
  const at = asString(seenAt);
  await Promise.all(
    entries.map(async entry => {
      if (!entry.date || !entry.taskId || !entry.key) return;
      const [year, monthNum] = asString(entry.date).split('-');
      const month = MONTH_NAMES[Number(monthNum) - 1];
      await updateData(entryPath(id, entry.date, entry.taskId, entry.key), {
        acknowledged: true,
        acknowledgedAt: at,
      });
      if (year && month && entry.taskId && entry.key) {
        await updateData(
          `IECData/IECTasks/${id}/${year}/${month}/${entry.date}/${entry.taskId}/${entry.key}`,
          { rejectionSeenAt: at },
        );
      }
    }),
  );
};

// Is this task record currently Not Approved? Newest approvalHistory entry
// decides; records without history fall back to approvedStatus.
const getRejection = record => {
  const history = record?.approvalHistory;
  if (history && typeof history === 'object') {
    const keys = Object.keys(history)
      .map(k => parseInt(k, 10))
      .filter(n => Number.isFinite(n) && n > 0);
    if (keys.length) {
      const latest = history[String(Math.max(...keys))] || {};
      const status = asString(latest.status || latest.action).toLowerCase();
      if (status === 'not_approved' || status === 'notapproved') {
        return {
          remark: asString(latest.remark) || asString(record?.notApprovedRemark),
          rejectedBy: asString(latest.by),
          rejectedAt: asString(latest.at),
        };
      }
      return null;
    }
  }
  if (asString(record?.approvedStatus) === '0') {
    return {
      remark: asString(record?.notApprovedRemark),
      rejectedBy: asString(record?.approvedBy),
      rejectedAt: asString(record?.approvedAt),
    };
  }
  return null;
};

/**
 * One-time fill of the "To Resubmit" list with tasks rejected before the
 * list existed (last 30 days). Runs once per user; later rejections arrive
 * from the portal directly.
 */
export const backfillRejectedTasks = async userId => {
  const id = asString(userId);
  if (!id) return;
  try {
    if ((await AsyncStorage.getItem(backfillFlagKey(id))) === 'true') return;

    const now = new Date();
    const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - BACKFILL_DAYS);
    const pad = n => String(n).padStart(2, '0');
    const fromIso = `${fromDate.getFullYear()}-${pad(fromDate.getMonth() + 1)}-${pad(fromDate.getDate())}`;

    // Current month + the month BACKFILL_DAYS ago (same month → read once).
    const months = [
      [String(now.getFullYear()), MONTH_NAMES[now.getMonth()]],
      [String(fromDate.getFullYear()), MONTH_NAMES[fromDate.getMonth()]],
    ].filter((m, i, arr) => arr.findIndex(x => x[0] === m[0] && x[1] === m[1]) === i);

    // Entries the portal already wrote carry the approver's name — keep them.
    const existing = (await getData(`${ROOT}/${id}`)) || {};
    // Multi-path update: {"date/taskId/key": entry}.
    const entries = {};
    const entryTaskIds = {};
    const taskIds = new Set();
    for (const [year, month] of months) {
      const byDate = await getData(`IECData/IECTasks/${id}/${year}/${month}`);
      Object.entries(byDate || {}).forEach(([date, byTask]) => {
        if (date < fromIso || !byTask || typeof byTask !== 'object') return;
        Object.entries(byTask).forEach(([taskId, byKey]) => {
          if (!byKey || typeof byKey !== 'object') return;
          Object.entries(byKey).forEach(([key, record]) => {
            if (key === 'lastKey' || !record || typeof record !== 'object') return;
            // Index access works whether Firebase gave objects or arrays.
            if (existing?.[date]?.[taskId]?.[key]) return;
            // Closed without resubmission — nothing for the executive to fix.
            if (record.resubmissionRequired === false) return;
            const rejection = getRejection(record);
            if (!rejection) return;
            taskIds.add(taskId);
            const entryAt = `${date}/${taskId}/${key}`;
            entryTaskIds[entryAt] = taskId;
            entries[entryAt] = {
              taskName: '',
              ...rejection,
              rejectedByName: '',
            };
          });
        });
      });
    }

    // Task names from the task master.
    const names = {};
    await Promise.all(
      [...taskIds].map(async taskId => {
        names[taskId] = asString(await getData(`IECData/Tasks/${taskId}/name`));
      }),
    );
    Object.entries(entries).forEach(([entryAt, entry]) => {
      entry.taskName = names[entryTaskIds[entryAt]] || '';
    });

    if (Object.keys(entries).length) {
      await updateData(`${ROOT}/${id}`, entries);
    }
    await AsyncStorage.setItem(backfillFlagKey(id), 'true');
  } catch (error) {
    logError(ERROR_CATEGORY.Startup, error, { step: 'backfillRejectedTasks' });
  }
};
