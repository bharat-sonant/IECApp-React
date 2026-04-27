import {getData} from '../firebase/firebaseService';
import CryptoJS from 'crypto-js';
import DeviceInfo from 'react-native-device-info';

export const APP_VERSION = DeviceInfo.getVersion() || '1.0.0.1';
export const LATEST_VERSION_PATH = 'Settings/LatestVersions/IECNativeApp';
export const AVAILABLE_DESIGNATIONS_URL =
  'https://firebasestorage.googleapis.com/v0/b/dtdnavigator.appspot.com/o/Common%2FIECAvailableDesignations.json?alt=media&token=eb5d1dd0-0461-4b0d-a57a-5fc6c469acd5';

const EMPLOYEE_GENERAL_DETAILS_PATH = userId =>
  `Employees/${String(userId).trim()}/GeneralDetails`;

let availableDesignationsPromise = null;

const asObject = value => (value && typeof value === 'object' ? value : null);

const asString = value =>
  value === null || value === undefined ? '' : String(value).trim();

const normalizeDesignationId = value => asString(value);

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

const deriveAesKey = userName => CryptoJS.SHA256(asString(userName));

export const encryptPasswordLikeLegacyApp = (password, userName) => {
  const key = deriveAesKey(userName);
  const encrypted = CryptoJS.AES.encrypt(asString(password), key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });

  return asString(encrypted.toString());
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

export const validateAppVersion = async () => {
  const payload = await getData(LATEST_VERSION_PATH);

  if (payload === null || payload === undefined) {
    return {
      ok: false,
      message: 'Version Expired',
    };
  }

  let latestVersion = APP_VERSION;

  if (typeof payload === 'string' || typeof payload === 'number') {
    latestVersion = asString(payload) || APP_VERSION;
  } else {
    const data = asObject(payload) ?? {};
    latestVersion =
      asString(data.version) ||
      asString(data.Version) ||
      asString(data.appVersion) ||
      asString(data.latestVersion) ||
      asString(data.value) ||
      APP_VERSION;
  }

  if (latestVersion.toLowerCase() !== APP_VERSION.toLowerCase()) {
    return {
      ok: false,
      message: 'Version Expired',
    };
  }

  return {
    ok: true,
    version: latestVersion,
  };
};

export const readEmployeeGeneralDetails = async userId => {
  const payload = await getData(EMPLOYEE_GENERAL_DETAILS_PATH(userId));
  return normalizeEmployeeDetails(payload);
};

export const readAvailableDesignations = async () => {
  if (!availableDesignationsPromise) {
    availableDesignationsPromise = (async () => {
      const response = await fetch(AVAILABLE_DESIGNATIONS_URL);
      if (!response.ok) {
        throw new Error('Unable to load available designations.');
      }
      const payload = await response.json();
      const designationIds = extractDesignationIds(payload);
      return designationIds;
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

export const matchesPassword = (storedPassword, enteredPassword, userId) => {
  const stored = asString(storedPassword);
  const entered = asString(enteredPassword);

  if (!stored || !entered) {
    return false;
  }

  if (stored === entered) {
    return true;
  }

  const encryptedEntered = encryptPasswordLikeLegacyApp(entered, userId);
  return stored === encryptedEntered;
};

export const validateEmployeeLogin = async (userId, password) => {
  const loginId = asString(userId);
  const loginPassword = asString(password);

  if (loginId.includes('.')) {
    return {
      ok: false,
      message: 'Invalid user name or password',
    };
  }

  const details = await readEmployeeGeneralDetails(loginId);

  if (!details) {
    return {
      ok: false,
      message: 'Invalid user name or password',
    };
  }

  const employeeStatus = resolveEmployeeStatus(details);
  const employeeDesignationId = resolveEmployeeDesignationId(details);
  const storedPassword = resolveStoredPassword(details);

  if (!employeeStatus || !employeeDesignationId || !storedPassword) {
    return {
      ok: false,
      message: 'You are not authorized to use',
    };
  }

  if (employeeStatus !== '1') {
    return {
      ok: false,
      message: 'You are not authorized to use',
    };
  }

  if (!matchesPassword(storedPassword, loginPassword, loginId)) {
    return {
      ok: false,
      message: 'Invalid user or password',
    };
  }

  const allowedDesignations = await readAvailableDesignations();

  if (!allowedDesignations.includes(employeeDesignationId)) {
    return {
      ok: false,
      message: 'You are not authorized to use',
    };
  }

  return {
    ok: true,
    employee: details,
    loginId,
    loginType: loginId,
    loggedInName: resolveEmployeeName(details),
    designationId: employeeDesignationId,
  };
};
