import React, {createContext, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import appTheme from '../theme/appTheme';

const FeedbackContext = createContext(null);

const toastStyles = {
  info: {
    label: 'Info',
    icon: 'information-outline',
    accentColor: appTheme.colors.brand.primaryDark,
    iconBg: 'rgba(18, 59, 74, 0.12)',
    labelBg: 'rgba(22, 122, 69, 0.06)',
    labelText: appTheme.colors.neutral.text,
    surfaceBg: appTheme.colors.neutral.surface,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
  success: {
    label: 'Success',
    icon: 'check-circle-outline',
    accentColor: appTheme.colors.status.success,
    iconBg: 'rgba(22, 122, 69, 0.12)',
    labelBg: 'rgba(22, 122, 69, 0.06)',
    labelText: appTheme.colors.neutral.text,
    surfaceBg: appTheme.colors.neutral.surface,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
  warning: {
    label: 'Warning',
    icon: 'alert-outline',
    accentColor: appTheme.colors.status.warning,
    iconBg: 'rgba(199, 125, 0, 0.12)',
    labelBg: 'rgba(22, 122, 69, 0.06)',
    labelText: appTheme.colors.neutral.text,
    surfaceBg: appTheme.colors.neutral.surface,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
  error: {
    label: 'Error',
    icon: 'close-circle-outline',
    accentColor: appTheme.colors.status.danger,
    iconBg: 'rgba(180, 35, 24, 0.12)',
    labelBg: 'rgba(22, 122, 69, 0.06)',
    labelText: appTheme.colors.neutral.text,
    surfaceBg: appTheme.colors.neutral.surface,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
};

export const AppFeedbackProvider = ({children}) => {
  const [alertState, setAlertState] = useState(null);
  const [toastState, setToastState] = useState(null);
  const toastTimerRef = useRef(null);

  const dismissAlert = () => setAlertState(null);

  const showAlert = useMemo(() => {
    return (configOrTitle, maybeMessage, maybeButtons) => {
      if (typeof configOrTitle === 'string') {
        setAlertState({
          title: configOrTitle,
          message: maybeMessage ?? '',
          buttons: maybeButtons ?? [{text: 'OK'}],
        });
        return;
      }

      const config = configOrTitle ?? {};
      setAlertState({
        title: config.title ?? 'Notice',
        message: config.message ?? '',
        buttons: config.buttons?.length ? config.buttons : [{text: 'OK'}],
      });
    };
  }, []);

  const showToast = useMemo(() => {
    return (message, variant = 'info') => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      setToastState({message, variant});
      toastTimerRef.current = setTimeout(() => {
        setToastState(null);
      }, 2400);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const contextValue = useMemo(() => ({showAlert, showToast, dismissAlert}), [showAlert, showToast]);
  const alertButtons = alertState?.buttons ?? [];
  const toastTheme = toastState ? toastStyles[toastState.variant] ?? toastStyles.info : toastStyles.info;

  return (
    <FeedbackContext.Provider value={contextValue}>
      {children}

      <Modal transparent visible={!!alertState} animationType="fade" onRequestClose={dismissAlert}>
        <Pressable style={styles.overlay} onPress={dismissAlert}>
          <Pressable style={styles.alertCard} onPress={() => {}}>
            <View style={styles.alertHeader}>
              <View style={styles.alertIconWrap}>
                <MaterialCommunityIcons name="alert-circle-outline" size={22} color={appTheme.colors.brand.accent} />
              </View>
              <View style={styles.alertTextWrap}>
                <Text style={styles.alertTitle}>{alertState?.title}</Text>
                <Text style={styles.alertMessage}>{alertState?.message}</Text>
              </View>
            </View>

            <View style={styles.buttonRow}>
              {alertButtons.map((button, index) => (
                <Pressable
                  key={`${button.text}-${index}`}
                  style={({pressed}) => [
                    styles.alertButton,
                    button.style === 'cancel' && styles.alertButtonSecondary,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => {
                    dismissAlert();
                    button.onPress?.();
                  }}
                >
                  <Text style={[styles.alertButtonText, button.style === 'cancel' && styles.alertButtonTextSecondary]}>
                    {button.text}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {toastState ? (
        <View style={styles.toastWrap} pointerEvents="box-none">
          <View
            style={[
              styles.toast,
              {
                borderColor: toastTheme.borderColor,
                backgroundColor: toastTheme.surfaceBg,
              },
            ]}>
            <View style={[styles.toastAccent, {backgroundColor: toastTheme.accentColor}]} />
            <View style={[styles.toastIconWrap, {backgroundColor: toastTheme.iconBg}]}>
              <MaterialCommunityIcons name={toastTheme.icon} size={18} color={toastTheme.accentColor} />
            </View>
            <View style={styles.toastTextWrap}>
              <Text style={[styles.toastTitle, {color: toastTheme.labelText}]}>{toastTheme.label}</Text>
              <Text style={styles.toastText} numberOfLines={2}>
                {toastState.message}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </FeedbackContext.Provider>
  );
};

export const useAppFeedback = () => {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error('useAppFeedback must be used within AppFeedbackProvider');
  }
  return ctx;
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 31, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  alertCard: {
    backgroundColor: appTheme.colors.neutral.surface,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: {width: 0, height: 10},
    elevation: 10,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  alertIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(232, 155, 0, 0.12)',
    marginRight: 12,
  },
  alertTextWrap: {
    flex: 1,
  },
  alertTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 17,
    fontWeight: '900',
  },
  alertMessage: {
    marginTop: 6,
    color: appTheme.colors.neutral.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  alertButton: {
    minWidth: 88,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: appTheme.colors.brand.primaryDark,
    alignItems: 'center',
  },
  alertButtonSecondary: {
    backgroundColor: '#E9EEF2',
  },
  alertButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  alertButtonTextSecondary: {
    color: appTheme.colors.neutral.text,
  },
  toastWrap: {
    position: 'absolute',
    top: 14,
    left: 16,
    right: 16,
    zIndex: 999,
  },
  toast: {
    width: '100%',
    backgroundColor: appTheme.colors.neutral.surface,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 84,
    paddingHorizontal: 12,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 8},
    elevation: 10,
  },
  toastAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
  },
  toastIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 1,
  },
  toastTextWrap: {
    flex: 1,
    paddingRight: 4,
  },
  toastTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  toastText: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 6,
  },
  pressed: {
    opacity: 0.92,
  },
});
