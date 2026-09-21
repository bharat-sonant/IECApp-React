import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import appTheme from '../theme/appTheme';

// Same "Task Details" screen as Task Monitoring — slides in from the right,
// shows the task with its media, and offers Re-pick for a Not Approved task.

const STATUS_META = {
  Pending: {
    backgroundColor: '#FFF4E5',
    color: appTheme.colors.status.warning,
  },
  Approved: {
    backgroundColor: '#E8F5E9',
    color: appTheme.colors.status.success,
  },
  Completed: {
    backgroundColor: '#E8F5E9',
    color: appTheme.colors.status.success,
  },
  'Not Approved': {
    backgroundColor: '#FDECEC',
    color: appTheme.colors.status.danger,
  },
};

const formatDisplayDate = value => {
  if (!value) {
    return '-';
  }
  let date = value;
  if (typeof value === 'string') {
    const [year, month, day] = value.split('-').map(Number);
    date = new Date(year, month - 1, day);
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

/**
 * acknowledgeOnly — a task Not Approved WITHOUT resubmission: the executive
 * can view it but not re-pick it, and can only leave through "OK" (no back
 * arrow, hardware back ignored). onAcknowledge(task) runs on OK.
 */
const RepickTaskDetailModal = ({
  task,
  onClose,
  onRepick,
  acknowledgeOnly = false,
  onAcknowledge,
}) => {
  const [mediaViewerOpen, setMediaViewerOpen] = useState(false);
  const slideAnim = useRef(
    new Animated.Value(Dimensions.get('window').width),
  ).current;

  useEffect(() => {
    if (task) {
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    } else {
      slideAnim.setValue(Dimensions.get('window').width);
    }
  }, [task, slideAnim]);

  const slideOut = useCallback(
    done => {
      Animated.timing(slideAnim, {
        toValue: Dimensions.get('window').width,
        duration: 220,
        useNativeDriver: true,
      }).start(done);
    },
    [slideAnim],
  );

  const handleClose = useCallback(() => {
    slideOut(() => onClose?.());
  }, [slideOut, onClose]);

  const handleRepick = useCallback(() => {
    const target = task;
    slideOut(() => onRepick?.(target));
  }, [slideOut, onRepick, task]);

  const handleAcknowledge = useCallback(() => {
    const target = task;
    slideOut(() => onAcknowledge?.(target));
  }, [slideOut, onAcknowledge, task]);

  const MediaViewer = mediaViewerOpen
    ? require('./MediaViewer/MediaViewer').default
    : null;

  const statusMeta = STATUS_META[task?.status];

  return (
    <>
      <Modal
        visible={!!task}
        transparent
        animationType="none"
        onRequestClose={acknowledgeOnly ? () => {} : handleClose}
      >
        <Animated.View
          style={[
            styles.detailScreen,
            { transform: [{ translateX: slideAnim }] },
          ]}
        >
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
            <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

            {/* Minimal header */}
            <View
              style={[
                styles.detailHeaderBar,
                acknowledgeOnly && styles.detailHeaderBarNoBack,
              ]}
            >
              {!acknowledgeOnly && (
                <TouchableOpacity
                  style={styles.detailBackBtn}
                  onPress={handleClose}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name="arrow-left"
                    size={22}
                    color={appTheme.colors.neutral.text}
                  />
                </TouchableOpacity>
              )}
              <Text style={styles.detailHeaderTitle}>Task Details</Text>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.detailScrollContent}
            >
              {/* Meta row + title */}
              <View style={styles.detailMetaTop}>
                <Text style={styles.detailMetaCategory}>
                  {task?.taskCategory || task?.sourceLabel || 'Other'}
                </Text>
                <Text style={styles.detailMetaDot}>·</Text>
                <Text style={styles.detailMetaDate}>
                  {formatDisplayDate(task?.date)}
                </Text>
              </View>
              <Text style={styles.detailMainTitle}>{task?.title}</Text>

              {/* Status pill */}
              <View
                style={[
                  styles.detailStatusInline,
                  {
                    backgroundColor: statusMeta?.backgroundColor ?? '#FFF4E5',
                  },
                ]}
              >
                <View
                  style={[
                    styles.detailStatusDot,
                    {
                      backgroundColor:
                        statusMeta?.color ?? appTheme.colors.status.warning,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.detailStatusInlineText,
                    {
                      color:
                        statusMeta?.color ?? appTheme.colors.status.warning,
                    },
                  ]}
                >
                  {task?.status}
                </Text>
              </View>

              {/* Media stats inline */}
              <View style={styles.detailInlineStats}>
                <View style={styles.detailInlineStat}>
                  <Text style={styles.detailInlineStatValue}>
                    {task?.images || 0}
                  </Text>
                  <Text style={styles.detailInlineStatLabel}>Photos</Text>
                </View>
                <View style={styles.detailInlineSep} />
                <View style={styles.detailInlineStat}>
                  <Text style={styles.detailInlineStatValue}>
                    {task?.videos || 0}
                  </Text>
                  <Text style={styles.detailInlineStatLabel}>Videos</Text>
                </View>
                {(task?.images > 0 || task?.videos > 0) && (
                  <TouchableOpacity
                    style={styles.detailMediaLink}
                    onPress={() => setMediaViewerOpen(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.detailMediaLinkText}>View Media</Text>
                    <MaterialCommunityIcons
                      name="arrow-right"
                      size={14}
                      color={appTheme.colors.brand.primary}
                    />
                  </TouchableOpacity>
                )}
              </View>

              {/* Remark */}
              <View style={styles.detailBlock}>
                <Text style={styles.detailBlockLabel}>Remark</Text>
                <Text style={styles.detailBlockBody}>
                  {task?.remark || '—'}
                </Text>
              </View>

              {/* Not Approved Reason */}
              {task?.status === 'Not Approved' ? (
                <View style={[styles.detailBlock, styles.detailBlockWarn]}>
                  <View style={styles.detailBlockLabelRow}>
                    <MaterialCommunityIcons
                      name="alert-circle"
                      size={13}
                      color={appTheme.colors.status.danger}
                    />
                    <Text
                      style={[
                        styles.detailBlockLabel,
                        { color: appTheme.colors.status.danger, marginBottom: 0 },
                      ]}
                    >
                      Reason
                    </Text>
                  </View>
                  <Text style={styles.detailBlockBody}>
                    {task?.notApprovedRemark || 'No reason provided.'}
                  </Text>
                </View>
              ) : null}

              <View style={{ height: 24 }} />
            </ScrollView>

            {acknowledgeOnly ? (
              // Not sent back for resubmission — view only, OK to close.
              <View style={styles.repickFooter}>
                <View style={styles.noResubmitNote}>
                  <MaterialCommunityIcons
                    name="information-outline"
                    size={16}
                    color={appTheme.colors.neutral.textMuted}
                  />
                  <Text style={styles.noResubmitNoteText}>
                    No resubmission required. If you picked the wrong task,
                    pick the correct one from Add Task.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.repickButton}
                  activeOpacity={0.85}
                  onPress={handleAcknowledge}
                >
                  <MaterialCommunityIcons
                    name="check"
                    size={16}
                    color="#FFF"
                  />
                  <Text style={styles.repickButtonText}>OK</Text>
                </TouchableOpacity>
              </View>
            ) : task?.status === 'Not Approved' ? (
              <View style={styles.repickFooter}>
                <TouchableOpacity
                  style={styles.repickButton}
                  activeOpacity={0.85}
                  onPress={handleRepick}
                >
                  <MaterialCommunityIcons
                    name="refresh"
                    size={16}
                    color="#FFF"
                  />
                  <Text style={styles.repickButtonText}>Re-pick Task</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </SafeAreaView>
        </Animated.View>
      </Modal>

      {mediaViewerOpen && MediaViewer ? (
        <MediaViewer
          visible={mediaViewerOpen}
          images={task?.imageUrls || []}
          videos={task?.videoUrls || []}
          taskMeta={task}
          onClose={() => setMediaViewerOpen(false)}
        />
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  detailScreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  detailHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 6,
  },
  detailBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHeaderTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  detailScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
  },
  detailMetaTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  detailMetaCategory: {
    color: appTheme.colors.brand.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  detailMetaDot: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  detailMetaDate: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  detailMainTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '800',
    marginBottom: 12,
  },
  detailStatusInline: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 5,
    borderRadius: 999,
    marginBottom: 20,
  },
  detailStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  detailStatusInlineText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  detailInlineStats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#F1F5F9',
    marginBottom: 18,
  },
  detailInlineStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  detailInlineStatValue: {
    color: appTheme.colors.neutral.text,
    fontSize: 17,
    fontWeight: '900',
  },
  detailInlineStatLabel: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  detailInlineSep: {
    width: 1,
    height: 16,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 16,
  },
  detailMediaLink: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(18, 59, 74, 0.18)',
  },
  detailMediaLinkText: {
    color: appTheme.colors.brand.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  detailBlock: {
    marginBottom: 18,
  },
  detailBlockWarn: {
    backgroundColor: 'rgba(180, 35, 24, 0.05)',
    borderLeftWidth: 3,
    borderLeftColor: appTheme.colors.status.danger,
    paddingLeft: 12,
    paddingVertical: 10,
    paddingRight: 12,
    borderRadius: 8,
  },
  detailBlockLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  detailBlockLabel: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  detailBlockBody: {
    color: appTheme.colors.neutral.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },
  repickFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#EEF2F7',
    backgroundColor: '#FFF',
  },
  repickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: appTheme.colors.brand.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  repickButtonText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // No back arrow in view-only mode — keep the title where it was.
  detailHeaderBarNoBack: {
    paddingLeft: 20,
    minHeight: 64,
  },
  noResubmitNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    marginBottom: 10,
  },
  noResubmitNoteText: {
    flex: 1,
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
});

export default RepickTaskDetailModal;
