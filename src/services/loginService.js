import {getData} from '../Firebase/firebaseService';
import {FIREBASE_CONFIG} from '../Firebase/firebaseConfig';

export const APP_VERSION = '1.0.0.1';
export const LATEST_VERSION_PATH = 'Settings/LatestVersions/IECNativeApp';
export const AVAILABLE_DESIGNATIONS_PATH = 'Common/IECAvailableDesignations.json';

const EMPLOYEE_GENERAL_DETAILS_PATH = userId =>
  `Employees/${String(userId).trim()}/GeneralDetails`;

let availableDesignationsPromise = null;

const asObject = value => (value && typeof value === 'object' ? value : null);

const asString = value =>
  value === null || value === undefined ? '' : String(value).trim();

const normalizeDesignationId = value => asString(value);

const buildStorageDownloadUrl = filePath => {
  const bucket =
    FIREBASE_CONFIG?.storageBucket?.replace(/^gs:\/\//, '') ??
    'devtest-62768.firebasestorage.app';
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, '%2F');

  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
};

const extractDesignationIds = payload => {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload
      .map(item =>
        normalizeDesignationId(
          item?.designationId ??
            item?.DesignationId ??
            item?.id ??
            item?.value ??
            item
        ),
      )
      .filter(Boolean);
  }

  if (typeof payload === 'object') {
    return Object.values(payload)
      .map(item =>
        normalizeDesignationId(
          item?.designationId ??
            item?.DesignationId ??
            item?.id ??
            item?.value ??
            item
        ),
      )
      .filter(Boolean);
  }

  const singleValue = normalizeDesignationId(payload);
  return singleValue ? [singleValue] : [];
};

const normalizeEmployeeDetails = payload => {
  if (!payload) return null;

  if (payload.GeneralDetails && typeof payload.GeneralDetails === 'object') {
    return payload.GeneralDetails;
  }

  return payload;
};

export const readLatestAppVersion = async () => {
  const payload = await getData(LATEST_VERSION_PATH);

  if (typeof payload === 'string' || typeof payload === 'number') {
    return asString(payload) || APP_VERSION;
  }

  const data = asObject(payload) ?? {};

  return (
    asString(data.version) ||
    asString(data.Version) ||
    asString(data.appVersion) ||
    asString(data.latestVersion) ||
    asString(data.value) ||
    APP_VERSION
  );
};

export const readEmployeeGeneralDetails = async userId => {
  const payload = await getData(EMPLOYEE_GENERAL_DETAILS_PATH(userId));
  return normalizeEmployeeDetails(payload);
};

export const readAvailableDesignations = async () => {
  if (!availableDesignationsPromise) {
    availableDesignationsPromise = (async () => {
      const downloadUrl = buildStorageDownloadUrl(AVAILABLE_DESIGNATIONS_PATH);
      const response = await fetch(downloadUrl);
      const payload = await response.json();
      return extractDesignationIds(payload);
    })();
  }

  return availableDesignationsPromise;
};

export const resolveEmployeeName = details =>
  asString(details?.name ?? details?.Name ?? details?.employeeName ?? details?.fullName ?? '');

export const resolveEmployeeStatus = details =>
  asString(details?.status ?? details?.Status ?? details?.active ?? '');

export const resolveEmployeeDesignationId = details =>
  asString(details?.designationId ?? details?.DesignationId ?? details?.designationID ?? '');

export const resolveStoredPassword = details =>
  asString(
    details?.password ??
      details?.Password ??
      details?.loginPassword ??
      details?.employeePassword ??
      details?.pass ??
      details?.encryptedPassword
  );

export const matchesPassword = (storedPassword, enteredPassword) => {
  const stored = asString(storedPassword);
  const entered = asString(enteredPassword);

  if (!stored || !entered) {
    return false;
  }

  return stored === entered;
};

export const validateEmployeeLogin = async (userId, password) => {
  const details = await readEmployeeGeneralDetails(userId);

  if (!details) {
    return {
      ok: false,
      message: 'Invalid user ID or password.',
    };
  }

  if (resolveEmployeeStatus(details) !== '1') {
    return {
      ok: false,
      message: 'Your account is inactive. Please contact admin.',
    };
  }

  if (!matchesPassword(resolveStoredPassword(details), password)) {
    return {
      ok: false,
      message: 'Invalid user ID or password.',
    };
  }

  const allowedDesignations = await readAvailableDesignations();
  const employeeDesignationId = resolveEmployeeDesignationId(details);

  if (allowedDesignations.length > 0 && !allowedDesignations.includes(employeeDesignationId)) {
    return {
      ok: false,
      message: 'You are not allowed for this app version.',
    };
  }

  return {
    ok: true,
    employee: details,
    loginId: asString(userId),
    loginType: employeeDesignationId,
    loggedInName: resolveEmployeeName(details),
    designationId: employeeDesignationId,
  };
};
