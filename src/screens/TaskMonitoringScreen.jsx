import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import appTheme from '../theme/appTheme';
import { useTaskMonitoring } from '../actions/taskMonitoringActions';

const STATUS_META = {
  Pending: {
    label: 'Pending',
    icon: 'clock-outline',
    backgroundColor: '#FFF4E5',
    color: appTheme.colors.status.warning,
  },
  Approved: {
    label: 'Approved',
    icon: 'check-circle-outline',
    backgroundColor: '#E8F5E9',
    color: appTheme.colors.status.success,
  },
  Completed: {
    label: 'Completed',
    icon: 'checkbox-marked-circle-outline',
    backgroundColor: '#E8F5E9',
    color: appTheme.colors.status.success,
  },
  'Not Approved': {
    label: 'Not Approved',
    icon: 'close-circle-outline',
    backgroundColor: '#FDECEC',
    color: appTheme.colors.status.danger,
  },
};

const FILTERS = ['All', 'Pending', 'Approved', 'Not Approved'];

const formatDate = date => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDisplayDate = value => {
  if (!value) {
    return '-';
  }
  const date = typeof value === 'string' ? parseDate(value) : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const parseDate = value => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const getMonthLabel = date => {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const getDaysInMonth = date => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPadding = firstDay.getDay();
  const days = [];
  for (let i = 0; i < startPadding; i += 1) {
    days.push(null);
  }
  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    days.push(new Date(year, month, day));
  }
  return days;
};

const formatApprovedAt = timestamp => {
  if (!timestamp) return '-';
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '-';
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${month} ${year} ${hours}:${minutes} ${ampm}`;
};

const ListSeparator = () => <View style={styles.listSeparator} />;

const TaskMonitoringScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const {
    selectedFilter,
    setSelectedFilter,
    selectedDate,
    setSelectedDate,
    calendarMonth,
    setCalendarMonth,
    tasks,
    filteredTasks,
    stats,
    moveCalendarMonth,
    moveCalendarYear,
    loadTasks,
  } = useTaskMonitoring();

  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [mediaViewerOpen, setMediaViewerOpen] = useState(false);
  const [mediaImages, setMediaImages] = useState([]);
  const [mediaVideos, setMediaVideos] = useState([]);
  const MediaViewer = mediaViewerOpen
    ? require('../components/MediaViewer/MediaViewer').default
    : null;

  const calendarDays = useMemo(
    () => getDaysInMonth(calendarMonth),
    [calendarMonth],
  );

  const priorityColor = priority => {
    const p = String(priority).toLowerCase();
    if (p.includes('high')) return appTheme.colors.status.danger;
    if (p.includes('medium')) return appTheme.colors.status.warning;
    return appTheme.colors.status.success;
  };

  const handleOpenDatePicker = useCallback(() => {
    console.log('[TaskMonitoring] open date picker', {
      selectedDate,
    });
    setCalendarMonth(parseDate(selectedDate));
    setDatePickerOpen(true);
  }, [selectedDate, setCalendarMonth]);

  useEffect(() => {
    console.log('[TaskMonitoring] screen mounted', {
      selectedDate,
      selectedFilter,
      tasksCount: tasks.length,
      filteredCount: filteredTasks.length,
    });

    return () => {
      console.log('[TaskMonitoring] screen unmounted');
    };
  }, []);

  useEffect(() => {
    console.log('[TaskMonitoring] render state', {
      selectedFilter,
      selectedDate,
      calendarMonth: getMonthLabel(calendarMonth),
      tasksCount: tasks.length,
      filteredCount: filteredTasks.length,
      stats,
      datePickerOpen,
      filterMenuOpen,
      hasSelectedTask: Boolean(selectedTask),
      mediaViewerOpen,
    });
  }, [
    calendarMonth,
    datePickerOpen,
    filterMenuOpen,
    filteredTasks.length,
    mediaViewerOpen,
    selectedDate,
    selectedFilter,
    selectedTask,
    stats,
    tasks.length,
  ]);

  const renderTask = ({ item }) => {
    const status = STATUS_META[item.status] ?? STATUS_META.Pending;
    const isActionable =
      item.status === 'Pending' || item.status === 'Not Approved';
    const priorityText = item.type
      ? String(item.type).charAt(0).toUpperCase() +
        String(item.type).slice(1).toLowerCase()
      : 'Medium';
    const categoryText = item.taskCategory || 'Other';

    return (
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => {
          console.log('[TaskMonitoring] task selected', {
            id: item?.id || '(empty)',
            title: item?.title || '(empty)',
            status: item?.status || '(empty)',
            images: item?.images ?? 0,
            videos: item?.videos ?? 0,
          });
          setSelectedTask(item);
        }}
      >
        <View style={styles.cardTopRow}>
          <View style={styles.typeChip}>
            <Text style={styles.typeChipText}>{categoryText}</Text>
          </View>
          <View style={styles.priorityChip}>
            <MaterialCommunityIcons
              name="flag-variant-outline"
              size={12}
              color={priorityColor(priorityText)}
            />
            <Text
              style={[
                styles.priorityText,
                { color: priorityColor(priorityText) },
              ]}
            >
              {priorityText}
            </Text>
          </View>
        </View>

        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title}
        </Text>

        <View style={styles.cardFooter}>
          <View
            style={[
              styles.statusChip,
              { backgroundColor: status.backgroundColor },
            ]}
          >
            <MaterialCommunityIcons
              name={status.icon}
              size={14}
              color={status.color}
            />
            <Text style={[styles.statusText, { color: status.color }]}>
              {status.label}
            </Text>
          </View>
          {isActionable ? (
            <View style={styles.mediaChip}>
              <MaterialCommunityIcons
                name="camera-burst"
                size={14}
                color={appTheme.colors.neutral.textMuted}
              />
              <Text style={styles.mediaText}>
                {item.images} photos, {item.videos} videos
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={appTheme.colors.neutral.background}
      />

      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation?.goBack?.()}
          activeOpacity={0.75}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={22}
            color={appTheme.colors.brand.primaryDark}
          />
        </TouchableOpacity>
        <View style={styles.topBarTextWrap}>
          <Text style={styles.screenTitle}>Task Monitoring</Text>
          <Text style={styles.screenSubtitle}>
            Monitor task progress and review submissions
          </Text>
        </View>
      </View>

      <View style={[styles.screenBody, { paddingBottom: insets.bottom }]}>
        <View style={styles.compactPanel}>
          <TouchableOpacity
            style={styles.dateChip}
            onPress={handleOpenDatePicker}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name="calendar-month-outline"
              size={16}
              color={appTheme.colors.brand.primaryDark}
            />
            <Text style={styles.dateChipText}>
              {formatDisplayDate(selectedDate)}
            </Text>
            <MaterialCommunityIcons
              name="chevron-down"
              size={18}
              color={appTheme.colors.neutral.textMuted}
            />
          </TouchableOpacity>

          <View style={styles.statusRow}>
            <View style={styles.statusMiniChip}>
              <Text style={styles.statusMiniText}>Pending {stats.pending}</Text>
            </View>
            <View style={styles.statusMiniChip}>
              <Text style={styles.statusMiniText}>
                Approved {stats.approved}
              </Text>
            </View>
            <View style={styles.statusMiniChip}>
              <Text style={styles.statusMiniText}>
                Not Approved {stats.notApproved}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Tasks ({filteredTasks.length})
          </Text>
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setFilterMenuOpen(true)}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name="filter-variant"
              size={20}
              color="#FFFFFF"
            />
          </TouchableOpacity>
        </View>

        <View style={styles.listArea}>
          {filteredTasks.length ? (
            <FlatList
              data={filteredTasks}
              keyExtractor={item => item.id}
              renderItem={renderTask}
              style={styles.taskList}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: insets.bottom + 24 },
              ]}
              ItemSeparatorComponent={ListSeparator}
            />
          ) : (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="folder-search-outline"
                size={34}
                color={appTheme.colors.neutral.textMuted}
              />
              <Text style={styles.emptyTitle}>No tasks found</Text>
              <Text style={styles.emptyText}>
                Try a different date or filter.
              </Text>
            </View>
          )}
        </View>
      </View>

      <Modal
        visible={filterMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterMenuOpen(false)}
      >
        <Pressable
          style={styles.menuOverlay}
          onPress={() => setFilterMenuOpen(false)}
        >
          <View style={styles.filterMenu}>
            {FILTERS.map(filter => {
              const active = selectedFilter === filter;
              return (
                <TouchableOpacity
                  key={filter}
                  style={[
                    styles.filterMenuItem,
                    active && styles.filterMenuItemActive,
                  ]}
                  onPress={() => {
                    setSelectedFilter(filter);
                    setFilterMenuOpen(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.filterMenuText,
                      active && styles.filterMenuTextActive,
                    ]}
                  >
                    {filter}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={datePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDatePickerOpen(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setDatePickerOpen(false)}
        >
          <Pressable style={styles.datePickerCard} onPress={() => {}}>
            <View style={styles.datePickerAccent} />
            <View style={styles.datePickerHeader}>
              <View style={styles.datePickerTitleWrap}>
                <Text style={styles.datePickerTitle}>Select Date</Text>
                <Text style={styles.datePickerSubtitle}>
                  Tap a day to filter tasks
                </Text>
              </View>
            </View>

            <View style={styles.datePickerControlRow}>
              <View style={styles.datePickerNavRow}>
                <TouchableOpacity
                  style={styles.datePickerNav}
                  onPress={() => moveCalendarYear(-1)}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons
                    name="skip-previous"
                    size={20}
                    color={appTheme.colors.neutral.text}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.datePickerNav}
                  onPress={() => moveCalendarMonth(-1)}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons
                    name="chevron-left"
                    size={22}
                    color={appTheme.colors.neutral.text}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.datePickerMonthPill}>
                <Text style={styles.datePickerMonthInline}>
                  {getMonthLabel(calendarMonth)}
                </Text>
              </View>

              <View style={styles.datePickerNavRow}>
                <TouchableOpacity
                  style={styles.datePickerNav}
                  onPress={() => moveCalendarMonth(1)}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={22}
                    color={appTheme.colors.neutral.text}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.datePickerNav}
                  onPress={() => moveCalendarYear(1)}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons
                    name="skip-next"
                    size={20}
                    color={appTheme.colors.neutral.text}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.weekRow}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
                (day, index) => (
                  <Text key={`${day}-${index}`} style={styles.weekDay}>
                    {day}
                  </Text>
                ),
              )}
            </View>

            <View style={styles.calendarGrid}>
              {calendarDays.map((day, index) => {
                if (!day) {
                  return (
                    <View key={`empty-${index}`} style={styles.calendarCell} />
                  );
                }

                const dayKey = formatDate(day);
                const active = dayKey === selectedDate;

                return (
                  <TouchableOpacity
                    key={dayKey}
                    style={[
                      styles.calendarCell,
                      styles.calendarDay,
                      active && styles.calendarDayActive,
                    ]}
                    onPress={() => {
                      setSelectedDate(dayKey);
                      setCalendarMonth(
                        new Date(day.getFullYear(), day.getMonth(), 1),
                      );
                      setDatePickerOpen(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.calendarDayText,
                        active && styles.calendarDayTextActive,
                      ]}
                    >
                      {day.getDate()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.datePickerActions}>
              <TouchableOpacity
                style={styles.secondaryAction}
                onPress={() => {
                  setSelectedDate(formatDate(new Date()));
                  setCalendarMonth(new Date());
                  setDatePickerOpen(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryActionText}>Today</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryAction}
                onPress={() => setDatePickerOpen(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryActionText}>Close</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!selectedTask}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedTask(null)}
      >
        <Pressable
          style={styles.detailOverlay}
          onPress={() => setSelectedTask(null)}
        >
          <Pressable style={styles.detailCard} onPress={() => {}}>
            <View style={styles.detailHeader}>
              <View style={styles.detailHeaderText}>
                <Text style={styles.detailType}>
                  {selectedTask?.taskCategory || selectedTask?.sourceLabel || 'Other'}
                </Text>
                <Text style={styles.detailTitle}>{selectedTask?.title}</Text>
              </View>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setSelectedTask(null)}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={20}
                  color={appTheme.colors.neutral.text}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.detailMetaRow}>
              <View style={styles.detailMetaItem}>
                <MaterialCommunityIcons
                  name="calendar-month-outline"
                  size={16}
                  color={appTheme.colors.neutral.textMuted}
                />
                <Text style={styles.detailMetaText}>
                  {formatDisplayDate(selectedTask?.date)}
                </Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <View style={styles.detailPill}>
                <MaterialCommunityIcons
                  name={
                    STATUS_META[selectedTask?.status]?.icon ?? 'clock-outline'
                  }
                  size={14}
                  color={
                    STATUS_META[selectedTask?.status]?.color ??
                    appTheme.colors.status.warning
                  }
                />
                <Text
                  style={[
                    styles.detailPillText,
                    {
                      color:
                        STATUS_META[selectedTask?.status]?.color ??
                        appTheme.colors.status.warning,
                    },
                  ]}
                >
                  {selectedTask?.status}
                </Text>
              </View>
              <View style={styles.detailPill}>
                <MaterialCommunityIcons
                  name="image-multiple-outline"
                  size={14}
                  color={appTheme.colors.neutral.textMuted}
                />
                <Text style={styles.detailPillText}>
                  {selectedTask?.images} photos
                </Text>
              </View>
              <View style={styles.detailPill}>
                <MaterialCommunityIcons
                  name="video-outline"
                  size={14}
                  color={appTheme.colors.neutral.textMuted}
                />
                <Text style={styles.detailPillText}>
                  {selectedTask?.videos} videos
                </Text>
              </View>
            </View>

            {(selectedTask?.images > 0 || selectedTask?.videos > 0) && (
              <TouchableOpacity
                style={styles.viewMediaButton}
                onPress={() => {
                  console.log('[TaskMonitoring] view media requested', {
                    taskId: selectedTask?.id || '(empty)',
                    title: selectedTask?.title || '(empty)',
                    images: selectedTask?.imageUrls?.length || 0,
                    videos: selectedTask?.videoUrls?.length || 0,
                  });
                  const imgs = selectedTask?.imageUrls || [];
                  const vids = selectedTask?.videoUrls || [];
                  setMediaImages(imgs);
                  setMediaVideos(vids);
                  setMediaViewerOpen(true);
                }}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons
                  name="image-multiple"
                  size={18}
                  color="#FFFFFF"
                />
                <Text style={styles.viewMediaButtonText}>View Media</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.detailRemarkLabel}>Remark</Text>
            <Text style={styles.detailRemark}>{selectedTask?.remark}</Text>
          </Pressable>
        </Pressable>
      </Modal>

      {mediaViewerOpen && MediaViewer ? (
      <MediaViewer
        visible={mediaViewerOpen}
        images={mediaImages}
        videos={mediaVideos}
        taskMeta={selectedTask}
        onClose={() => setMediaViewerOpen(false)}
      />
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: appTheme.colors.neutral.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appTheme.colors.neutral.surface,
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.8)',
    marginRight: 12,
  },
  topBarTextWrap: {
    flex: 1,
  },
  screenTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 20,
    fontWeight: '900',
  },
  screenSubtitle: {
    marginTop: 3,
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
  },
  screenBody: {
    flex: 1,
    paddingHorizontal: 20,
  },
  compactPanel: {
    backgroundColor: appTheme.colors.neutral.surface,
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#F5F8FA',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  dateChipText: {
    color: appTheme.colors.neutral.text,
    fontSize: 13,
    fontWeight: '800',
  },
  statusRow: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusMiniChip: {
    backgroundColor: '#F5F8FA',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusMiniText: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  filterButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appTheme.colors.brand.primaryDark,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.18)',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 31, 42, 0.20)',
  },
  filterMenu: {
    position: 'absolute',
    top: 112,
    right: 20,
    backgroundColor: appTheme.colors.neutral.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.9)',
    padding: 6,
    minWidth: 170,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  filterMenuItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  filterMenuItemActive: {
    backgroundColor: '#F5F8FA',
  },
  filterMenuText: {
    color: appTheme.colors.neutral.text,
    fontSize: 13,
    fontWeight: '700',
  },
  filterMenuTextActive: {
    color: appTheme.colors.brand.primaryDark,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 12,
  },
  sectionTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 17,
    fontWeight: '900',
  },
  listArea: {
    flex: 1,
    marginTop: 12,
  },
  taskList: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: appTheme.colors.neutral.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.88)',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  cardPressed: {
    opacity: 0.98,
  },
  listSeparator: {
    height: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeChip: {
    backgroundColor: '#F2F5F8',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
  },
  typeChipText: {
    color: appTheme.colors.neutral.text,
    fontSize: 12,
    fontWeight: '800',
  },
  priorityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
  },
  priorityText: {
    fontSize: 12,
    fontWeight: '800',
  },
  cardTitle: {
    marginTop: 12,
    color: appTheme.colors.neutral.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  cardMeta: {
    marginTop: 8,
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  cardFooter: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
  },
  mediaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mediaText: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyState: {
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appTheme.colors.neutral.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.9)',
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    marginTop: 10,
    color: appTheme.colors.neutral.text,
    fontSize: 15,
    fontWeight: '900',
  },
  emptyText: {
    marginTop: 4,
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 31, 42, 0.42)',
    justifyContent: 'center',
    padding: 16,
  },
  datePickerCard: {
    backgroundColor: appTheme.colors.neutral.surface,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.9)',
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  datePickerAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: appTheme.colors.brand.primaryDark,
  },
  datePickerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  datePickerTitleWrap: {
    flex: 1,
    paddingRight: 8,
  },
  datePickerTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 16,
    fontWeight: '900',
  },
  datePickerSubtitle: {
    marginTop: 3,
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  datePickerNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  datePickerControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
    marginBottom: 12,
  },
  datePickerNav: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F8FA',
  },
  datePickerMonthPill: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F8FA',
    paddingHorizontal: 10,
  },
  datePickerMonthInline: {
    color: appTheme.colors.brand.primaryDark,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekDay: {
    flex: 1,
    textAlign: 'center',
    color: appTheme.colors.neutral.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -2,
  },
  calendarCell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  calendarDay: {
    borderRadius: 16,
    backgroundColor: '#F8FAFB',
  },
  calendarDayActive: {
    backgroundColor: appTheme.colors.brand.primaryDark,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  calendarDayText: {
    color: appTheme.colors.neutral.text,
    fontSize: 13,
    fontWeight: '800',
  },
  calendarDayTextActive: {
    color: '#FFFFFF',
  },
  datePickerActions: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  secondaryAction: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#F5F8FA',
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.6)',
  },
  secondaryActionText: {
    color: appTheme.colors.neutral.text,
    fontSize: 13,
    fontWeight: '800',
  },
  primaryAction: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: appTheme.colors.brand.primaryDark,
    paddingVertical: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 31, 42, 0.48)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  detailCard: {
    backgroundColor: appTheme.colors.neutral.surface,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.9)',
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailHeaderText: {
    flex: 1,
  },
  detailType: {
    color: appTheme.colors.brand.accent,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailTitle: {
    marginTop: 6,
    color: appTheme.colors.neutral.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F5F8',
  },
  detailMetaRow: {
    marginTop: 14,
    gap: 8,
  },
  detailMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailMetaText: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  detailRow: {
    marginTop: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  detailPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F5F8FA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  detailPillText: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  detailRemarkLabel: {
    marginTop: 16,
    color: appTheme.colors.neutral.text,
    fontSize: 13,
    fontWeight: '900',
  },
  detailRemark: {
    marginTop: 6,
    color: appTheme.colors.neutral.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  viewMediaButton: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: appTheme.colors.brand.primaryDark,
    borderRadius: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  viewMediaButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});

export default TaskMonitoringScreen;
