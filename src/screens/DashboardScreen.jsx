import React, {useMemo, useState} from 'react';
import {
  BackHandler,
  FlatList,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import appTheme from '../theme/appTheme';
import TaskActionModal from '../components/TaskActionModal';

const MY_TASKS = [
  {id: '1', title: 'Ward inspection review in Zone A', status: 'Pending', type: 'KPI Task', priority: 'High'},
  {id: '2', title: 'Meter reading follow-up for Block B', status: 'Pending', type: 'Meter Reading', priority: 'Medium'},
  {id: '3', title: 'Zone summary and compliance check', status: 'Completed', type: 'Summary', priority: 'Low'},
  {id: '4', title: 'Resident complaint verification', status: 'Pending', type: 'Complaint', priority: 'High'},
];

const STATUS_META = {
  Pending: {
    label: 'Pending',
    backgroundColor: '#FFF4E5',
    textColor: appTheme.colors.brand.accent,
    icon: 'clock-outline',
  },
  Completed: {
    label: 'Completed',
    backgroundColor: '#E8F5E9',
    textColor: appTheme.colors.status.success,
    icon: 'check-circle-outline',
  },
};

const DashboardScreen = ({navigation}) => {
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [actionModalVisible, setActionModalVisible] = useState(false);
  const [actionModalMode, setActionModalMode] = useState('add_kpi');

  const metrics = useMemo(() => {
    return {total: 12, pending: 8, completed: 4};
  }, []);

  const handleLogout = () => {
    setMenuOpen(false);
    BackHandler.exitApp();
  };

  const handleTaskAction = (task) => {
    if (task.status === 'Pending') {
      setActionModalMode('pick_task');
      setActionModalVisible(true);
    }
  };

  const handleAddTask = (mode) => {
    setFabOpen(false);
    setActionModalMode(mode);
    setActionModalVisible(true);
  };

  const renderTask = ({item}) => {
    const status = STATUS_META[item.status] ?? STATUS_META.Pending;
    
    let priorityColor = appTheme.colors.status.success;
    if (item.priority === 'High') priorityColor = appTheme.colors.status.danger;
    if (item.priority === 'Medium') priorityColor = appTheme.colors.status.warning;

    return (
      <View style={styles.taskCard}>
        <View style={styles.taskHeader}>
          <View style={styles.typeWrap}>
            <Text style={styles.taskType}>{item.type}</Text>
          </View>
          <View style={styles.priorityWrap}>
            <MaterialCommunityIcons name="flag-variant-outline" size={12} color={priorityColor} />
            <Text style={[styles.priorityText, {color: priorityColor}]}>{item.priority}</Text>
          </View>
        </View>

        <Text style={styles.taskTitle} numberOfLines={2}>
          {item.title}
        </Text>

        <View style={styles.taskFooter}>
          <View style={[styles.statusChip, {backgroundColor: status.backgroundColor}]}>
            <MaterialCommunityIcons name={status.icon} size={14} color={status.textColor} style={styles.statusIcon} />
            <Text style={[styles.statusText, {color: status.textColor}]}>{status.label}</Text>
          </View>

          {item.status === 'Pending' && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => handleTaskAction(item)} activeOpacity={0.8}>
              <Text style={styles.actionBtnText}>Pick Task</Text>
              <MaterialCommunityIcons name="arrow-right-circle" size={16} color="#FFF" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F4F7F9" />

      {/* Close FAB menu when touching outside via absolute fill instead of wrapping */}
      {fabOpen && (
        <Pressable 
          style={styles.overlayBlocker} 
          onPress={() => setFabOpen(false)} 
        />
      )}
      <View style={styles.container}>
          
          {/* STATIC HEADER AREA */}
          <View style={styles.staticTopSection}>
            <View style={styles.header}>
              <View>
                <Text style={styles.greeting}>Good Morning,</Text>
                <Text style={styles.userName}>Officer Sharma</Text>
              </View>
              <TouchableOpacity 
                style={styles.menuIconWrap} 
                onPress={() => setMenuOpen(true)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="dots-vertical" size={24} color={appTheme.colors.brand.primaryDark} />
              </TouchableOpacity>
            </View>

            <View style={styles.metricsRow}>
              <View style={[styles.metricCard, styles.metricTotal]}>
                <Text style={styles.metricLabelTotal}>Total Tasks</Text>
                <Text style={styles.metricValTotal}>{metrics.total}</Text>
              </View>
              <View style={[styles.metricCard, styles.metricPending]}>
                <Text style={styles.metricLabelGroup}>Pending</Text>
                <Text style={styles.metricValGroup}>{metrics.pending}</Text>
              </View>
              <View style={[styles.metricCard, styles.metricCompleted]}>
                <Text style={styles.metricLabelGroup}>Completed</Text>
                <Text style={styles.metricValCompleted}>{metrics.completed}</Text>
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Tasks</Text>
              
            </View>
          </View>

          {/* SCROLLING LIST AREA */}
          <View style={styles.listContainer}>
            <FlatList
              data={MY_TASKS}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 80 }]}
              renderItem={renderTask}
              onScroll={() => {
                 if (fabOpen) setFabOpen(false);
              }}
            />
          </View>

          {/* FAB BUTTON */}
          <View style={[styles.fabWrap, {bottom: Math.max(insets.bottom + 16, 16)}]}>
            {fabOpen && (
              <View style={styles.fabMenuPanel}>
                <TouchableOpacity 
                  style={styles.fabPanelItem} 
                  onPress={() => handleAddTask('add_kpi')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.fabPanelIcon, styles.fabIconKpi]}>
                    <MaterialCommunityIcons name="clipboard-plus-outline" size={18} color={appTheme.colors.brand.primaryDark} />
                  </View>
                  <View>
                    <Text style={styles.fabPanelTitle}>Add KPI Task</Text>
                    <Text style={styles.fabPanelSubtitle}>Create a new KPI</Text>
                  </View>
                </TouchableOpacity>

                <View style={styles.fabDivider} />

                <TouchableOpacity 
                  style={styles.fabPanelItem} 
                  onPress={() => handleAddTask('add_other')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.fabPanelIcon, styles.fabIconOther]}>
                    <MaterialCommunityIcons name="playlist-plus" size={18} color={appTheme.colors.brand.primaryDark} />
                  </View>
                  <View>
                    <Text style={styles.fabPanelTitle}>Add Other Task</Text>
                    <Text style={styles.fabPanelSubtitle}>Non-KPI assignment</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity 
              style={styles.fabButton}
              onPress={() => setFabOpen(!fabOpen)}
              activeOpacity={0.9}
            >
              <MaterialCommunityIcons name={fabOpen ? "close" : "plus"} size={26} color="#FFF" />
            </TouchableOpacity>
          </View>
          
        </View>

      {/* Menu Modal */}
      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuPanel}>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                navigation?.navigate?.('TaskMonitoring');
              }}
              style={({pressed}) => [styles.menuItem, pressed && styles.menuItemPressed]}
            >
              <View style={[styles.menuIcon, styles.menuIconPrimary]}>
                <MaterialCommunityIcons name="clipboard-text-outline" size={18} color={appTheme.colors.brand.primaryDark} />
              </View>
              <View style={styles.menuTextWrap}>
                <Text style={styles.menuTitle}>Task Monitoring</Text>
                <Text style={styles.menuSubtitle}>View overall stats</Text>
              </View>
            </Pressable>

            <View style={styles.menuDivider} />

            <Pressable
              onPress={handleLogout}
              style={({pressed}) => [styles.menuItem, pressed && styles.menuItemPressed]}
            >
              <View style={[styles.menuIcon, styles.menuIconDanger]}>
                <MaterialCommunityIcons name="logout-variant" size={18} color={appTheme.colors.status.danger} />
              </View>
              <View style={styles.menuTextWrap}>
                <Text style={styles.menuTitle}>Logout</Text>
                <Text style={styles.menuSubtitle}>Exit application</Text>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Unified Task Action Modal */}
      <TaskActionModal 
        visible={actionModalVisible} 
        onClose={() => setActionModalVisible(false)} 
        mode={actionModalMode} 
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F7F9',
  },
  container: {
    flex: 1,
  },
  staticTopSection: {
    paddingHorizontal: 20,
    backgroundColor: '#F4F7F9',
    zIndex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 22,
  },
  greeting: {
    fontSize: 14,
    color: appTheme.colors.neutral.textMuted,
    fontWeight: '600',
    marginBottom: 4,
  },
  userName: {
    fontSize: 24,
    color: appTheme.colors.brand.primaryDark,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  menuIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.4)',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  // --- Summary Metrics ---
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 12,
  },
  metricCard: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricTotal: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#FFF',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  metricPending: {
    backgroundColor: '#FFF4E5',
  },
  metricCompleted: {
    backgroundColor: '#E8F5E9',
  },
  metricValTotal: {
    fontSize: 24,
    fontWeight: '900',
    color: appTheme.colors.brand.primaryDark,
  },
  metricLabelTotal: {
    fontSize: 12,
    fontWeight: '700',
    color: appTheme.colors.neutral.textMuted,
    marginBottom: 4,
  },
  metricValGroup: {
    fontSize: 24,
    fontWeight: '900',
    color: appTheme.colors.brand.accent,
  },
  metricValCompleted: {
    fontSize: 24,
    fontWeight: '900',
    color: appTheme.colors.status.success,
  },
  metricLabelGroup: {
    fontSize: 12,
    fontWeight: '700',
    color: appTheme.colors.neutral.text,
    marginBottom: 4,
    opacity: 0.7,
  },
  // --- Section Header ---
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: appTheme.colors.neutral.text,
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '700',
    color: appTheme.colors.brand.secondary,
  },
  // --- List Container ---
  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  // --- Task Card ---
  taskCard: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.25)',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    justifyContent: 'space-between'
  },
  typeWrap: {
    backgroundColor: 'rgba(185, 199, 209, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  taskType: {
    fontSize: 11,
    fontWeight: '800',
    color: appTheme.colors.brand.primaryDark,
    letterSpacing: 0.5,
  },
  priorityWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.3)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priorityText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: appTheme.colors.neutral.text,
    lineHeight: 22,
    marginBottom: 16,
  },
  statusIcon: {
    marginRight: 4,
  },
  overlayBlocker: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  taskFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appTheme.colors.brand.primaryDark,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 6,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  // --- FAB Menu ---
  fabWrap: {
    position: 'absolute',
    right: 20,
    alignItems: 'flex-end',
    zIndex: 10,
  },
  fabMenuPanel: {
    marginBottom: 16,
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.4)',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    minWidth: 200,
  },
  fabPanelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  fabPanelIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  fabIconKpi: {
    backgroundColor: 'rgba(18, 59, 74, 0.1)',
  },
  fabIconOther: {
    backgroundColor: 'rgba(232, 155, 0, 0.15)',
  },
  fabPanelTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 14,
    fontWeight: '800',
  },
  fabPanelSubtitle: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  fabDivider: {
    height: 1,
    backgroundColor: 'rgba(185, 199, 209, 0.3)',
    marginVertical: 4,
  },
  fabButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: appTheme.colors.brand.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: appTheme.colors.brand.accent,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  // --- Menu Overlay ---
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
    paddingTop: 72,
    paddingRight: 20,
    alignItems: 'flex-end',
  },
  menuPanel: {
    width: 240,
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.3)',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: {width: 0, height: 10},
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  menuItemPressed: {
    backgroundColor: '#F4F7F9',
  },
  menuIconPrimary: {
    backgroundColor: 'rgba(18, 59, 74, 0.08)',
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuIconDanger: {
    backgroundColor: 'rgba(180, 35, 24, 0.08)',
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuTextWrap: {
    flex: 1,
  },
  menuTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 14,
    fontWeight: '900',
  },
  menuSubtitle: {
    marginTop: 2,
    color: appTheme.colors.neutral.textMuted,
    fontSize: 11,
  },
  menuDivider: {
    height: 1,
    marginVertical: 4,
    backgroundColor: 'rgba(185, 199, 209, 0.3)',
  },
});

export default DashboardScreen;
