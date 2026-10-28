import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import appTheme from '../theme/appTheme';
import {getData} from '../firebase/firebaseService';
import {
  daysLeftInMonth,
  loadUpcomingAssignedTasks,
} from '../services/assignedTaskService';

// Topics shown on a card; any beyond this show as "...".
const MAX_TOPICS = 5;

const pad = value => String(value).padStart(2, '0');

const getTodayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Thu, 30 Oct", whether it is tomorrow, and how many days away it is.
const describeDate = isoDate => {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAway = Math.round((date - today) / 86400000);
  return {
    label: `${WEEKDAYS[date.getDay()]}, ${day} ${MONTHS[month - 1]}`,
    fullLabel: `${WEEKDAYS[date.getDay()]}, ${day} ${MONTHS[month - 1]} ${year}`,
    isTomorrow: daysAway === 1,
    daysAway,
    opensIn: daysAway === 1 ? 'Tomorrow' : `In ${daysAway} days`,
  };
};

/**
 * Read-only list of tasks the portal has planned for the executive's site on
 * the coming days. Nothing here can be picked — a task opens on its own day.
 */
const UpcomingTasksModal = ({visible, onClose, branch}) => {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState([]);

  // The task opened for viewing: { date, task } — read-only, nothing to pick.
  const [viewing, setViewing] = useState(null);
  const [description, setDescription] = useState('');
  const [descLoading, setDescLoading] = useState(false);

  useEffect(() => {
    if (!visible) setViewing(null);
  }, [visible]);

  // Description lives on the task master, not on the calendar entry.
  useEffect(() => {
    const taskId = viewing?.task?.taskId;
    setDescription('');
    if (!taskId) return undefined;
    let active = true;
    setDescLoading(true);
    getData(`IECData/Tasks/${taskId}/desc`)
      .then(value => {
        if (active) setDescription(String(value || '').trim());
      })
      .finally(() => {
        if (active) setDescLoading(false);
      });
    return () => {
      active = false;
    };
  }, [viewing]);

  const today = getTodayIso();
  const [, todayMonth] = today.split('-').map(Number);
  const monthName = MONTHS[todayMonth - 1];
  const isLastDay = daysLeftInMonth(today) === 0;
  const rangeText = isLastDay
    ? `Today is the last day of ${monthName}`
    : `From tomorrow till the end of ${monthName}`;
  const emptyText = isLastDay
    ? `No more days left in ${monthName}.`
    : `No tasks planned for the rest of ${monthName}.`;

  useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    setLoading(true);
    loadUpcomingAssignedTasks(getTodayIso(), branch)
      .then(result => {
        if (active) setDays(result);
      })
      .catch(() => {
        if (active) setDays([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible, branch]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            viewing && styles.sheetDetail,
            {paddingBottom: insets.bottom + 16},
          ]}>
          <View style={styles.handle} />

          {/* The header turns into the detail's own bar while a task is open,
              with Back on the left — so it is always clear where you are. */}
          {viewing ? (
            <View style={styles.header}>
              <TouchableOpacity
                onPress={() => setViewing(null)}
                style={styles.headerBack}
                hitSlop={10}>
                <MaterialCommunityIcons name="arrow-left" size={22} color="#1E293B" />
              </TouchableOpacity>
              <View style={styles.headerText}>
                <Text style={styles.title}>Task Details</Text>
                <View style={styles.viewOnlyInline}>
                  <MaterialCommunityIcons name="eye-outline" size={14} color="#64748B" />
                  <Text style={styles.viewOnlyInlineText}>View only</Text>
                </View>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={10}>
                <MaterialCommunityIcons name="close" size={22} color="#475569" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <MaterialCommunityIcons
                  name="calendar-clock-outline"
                  size={20}
                  color={appTheme.colors.brand.primary}
                />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.title}>Upcoming Tasks</Text>
                <Text style={styles.subtitle}>{rangeText}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={10}>
                <MaterialCommunityIcons name="close" size={22} color="#475569" />
              </TouchableOpacity>
            </View>
          )}

          {viewing ? (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}>
              {/* Title block */}
              <View style={styles.hero}>
                <View style={styles.heroTag}>
                  <MaterialCommunityIcons
                    name="calendar-check-outline"
                    size={12}
                    color="#FFFFFF"
                  />
                  <Text style={styles.heroTagText}>Assigned Task</Text>
                </View>
                <Text style={styles.heroTitle}>{viewing.task.title}</Text>
              </View>

              {/* When */}
              <View style={styles.infoRow}>
                <View style={styles.infoTile}>
                  <MaterialCommunityIcons
                    name="calendar-month-outline"
                    size={18}
                    color={appTheme.colors.brand.primary}
                  />
                  <Text style={styles.infoLabel}>Date</Text>
                  <Text style={styles.infoValue}>
                    {describeDate(viewing.date).fullLabel}
                  </Text>
                </View>
                <View style={styles.infoTile}>
                  <MaterialCommunityIcons
                    name="timer-sand"
                    size={18}
                    color={appTheme.colors.brand.primary}
                  />
                  <Text style={styles.infoLabel}>Opens</Text>
                  <Text style={styles.infoValue}>
                    {describeDate(viewing.date).opensIn}
                  </Text>
                </View>
              </View>

              {/* Description */}
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <MaterialCommunityIcons
                    name="text-box-outline"
                    size={16}
                    color={appTheme.colors.brand.primary}
                  />
                  <Text style={styles.sectionTitle}>Description</Text>
                </View>
                {descLoading ? (
                  <ActivityIndicator
                    size="small"
                    color={appTheme.colors.brand.primary}
                    style={styles.detailLoader}
                  />
                ) : (
                  <Text
                    style={[
                      styles.detailText,
                      !description && styles.detailTextMuted,
                    ]}>
                    {description || 'No description added for this task.'}
                  </Text>
                )}
              </View>

              {/* Topics — one per line, numbered, so long names read fully */}
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <MaterialCommunityIcons
                    name="format-list-checks"
                    size={16}
                    color={appTheme.colors.brand.primary}
                  />
                  <Text style={styles.sectionTitle}>Topics to cover</Text>
                  <View style={styles.countPill}>
                    <Text style={styles.countPillText}>
                      {viewing.task.topics.length}
                    </Text>
                  </View>
                </View>
                {viewing.task.topics.length > 0 ? (
                  viewing.task.topics.map((topic, index) => (
                    <View
                      key={topic}
                      style={[
                        styles.topicRow,
                        index === viewing.task.topics.length - 1 &&
                          styles.topicRowLast,
                      ]}>
                      <View style={styles.topicIndex}>
                        <Text style={styles.topicIndexText}>{index + 1}</Text>
                      </View>
                      <Text style={styles.topicRowText}>{topic}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={[styles.detailText, styles.detailTextMuted]}>
                    No topics pre-selected — choose them when you pick the task.
                  </Text>
                )}
              </View>

              {/* Why it cannot be picked yet */}
              <View style={styles.lockBanner}>
                <MaterialCommunityIcons
                  name="lock-clock"
                  size={18}
                  color="#B45309"
                />
                <Text style={styles.lockText}>
                  You can pick this task on{' '}
                  <Text style={styles.lockTextStrong}>
                    {describeDate(viewing.date).label}
                  </Text>{' '}
                  from the Dashboard.
                </Text>
              </View>
            </ScrollView>
          ) : loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color={appTheme.colors.brand.primary} />
              <Text style={styles.centerText}>Loading upcoming tasks...</Text>
            </View>
          ) : days.length === 0 ? (
            <View style={styles.centerBox}>
              <MaterialCommunityIcons name="calendar-blank-outline" size={40} color="#94A3B8" />
              <Text style={styles.centerText}>{emptyText}</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}>
              {days.map(day => {
                const {label, isTomorrow} = describeDate(day.date);
                return (
                  <View key={day.date} style={styles.dayBlock}>
                    <View style={styles.dayHeader}>
                      <Text style={styles.dayLabel}>{label}</Text>
                      {isTomorrow && (
                        <View style={styles.tomorrowTag}>
                          <Text style={styles.tomorrowText}>Tomorrow</Text>
                        </View>
                      )}
                      <Text style={styles.dayCount}>
                        {day.tasks.length} task{day.tasks.length > 1 ? 's' : ''}
                      </Text>
                    </View>

                    {day.tasks.map(task => (
                      <TouchableOpacity
                        key={task.id}
                        style={styles.taskCard}
                        activeOpacity={0.7}
                        onPress={() => setViewing({date: day.date, task})}>
                        <View style={styles.taskTitleRow}>
                          <Text style={styles.taskTitle}>{task.title}</Text>
                          <MaterialCommunityIcons
                            name="chevron-right"
                            size={20}
                            color="#94A3B8"
                          />
                        </View>
                        {task.topics.length > 0 && (
                          <View style={styles.topicWrap}>
                            {task.topics.slice(0, MAX_TOPICS).map(topic => (
                              <View key={topic} style={styles.topicChip}>
                                <Text style={styles.topicText} numberOfLines={1}>
                                  {topic}
                                </Text>
                              </View>
                            ))}
                            {task.topics.length > MAX_TOPICS && (
                              <Text style={styles.moreText}>...</Text>
                            )}
                          </View>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })}
              <Text style={styles.footNote}>
                Tap a task to view it. Each task can be picked on its own day.
              </Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    maxHeight: '82%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(18, 59, 74, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '900',
    color: appTheme.colors.neutral.text,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748B',
  },
  closeBtn: {
    padding: 4,
  },
  centerBox: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  centerText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
  list: {
    marginTop: 4,
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  dayBlock: {
    marginBottom: 16,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dayLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: appTheme.colors.neutral.text,
  },
  tomorrowTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: appTheme.colors.brand.primary,
  },
  tomorrowText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  dayCount: {
    marginLeft: 'auto',
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  taskCard: {
    padding: 12,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5EAF0',
    borderLeftWidth: 4,
    borderLeftColor: appTheme.colors.brand.primary,
    backgroundColor: '#F8FAFC',
  },
  taskTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: appTheme.colors.neutral.text,
  },
  // --- Task detail ---
  sheetDetail: {
    minHeight: '72%',
  },
  headerBack: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewOnlyInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  // Line height matched to the 14px icon so both sit on one centre line.
  viewOnlyInlineText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '600',
    color: '#64748B',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  hero: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: appTheme.colors.brand.primary,
  },
  heroTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  heroTagText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: '#FFFFFF',
  },
  heroTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  infoRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  infoTile: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5EAF0',
    backgroundColor: '#F8FAFC',
    gap: 4,
  },
  infoLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '800',
    color: appTheme.colors.neutral.text,
  },
  section: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5EAF0',
    backgroundColor: '#FFFFFF',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: appTheme.colors.neutral.text,
  },
  countPill: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(18, 59, 74, 0.08)',
    alignItems: 'center',
  },
  countPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: appTheme.colors.brand.primary,
  },
  detailText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334155',
  },
  detailTextMuted: {
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  detailLoader: {
    alignSelf: 'flex-start',
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  topicRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  topicIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(18, 59, 74, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topicIndexText: {
    fontSize: 11,
    fontWeight: '800',
    color: appTheme.colors.brand.primary,
  },
  topicRowText: {
    flex: 1,
    paddingTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#334155',
  },
  lockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F6D9AB',
    backgroundColor: '#FFF8EB',
  },
  lockText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#92400E',
  },
  lockTextStrong: {
    fontWeight: '800',
  },
  topicWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  topicChip: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#E8EEF3',
  },
  topicText: {
    maxWidth: 220,
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  moreText: {
    alignSelf: 'center',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#64748B',
  },
  footNote: {
    marginTop: 4,
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
  },
});

export default UpcomingTasksModal;
