import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import appTheme from '../theme/appTheme';

const TaskDetailModal = ({ visible, onClose, onStart, task, viewOnly = false }) => {
  const slideAnim = React.useRef(new Animated.Value(Dimensions.get('window').width)).current;

  React.useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    } else {
      slideAnim.setValue(Dimensions.get('window').width);
    }
  }, [visible, slideAnim]);

  if (!task) return null;

  const description = 
    task.remark || 
    task.Remark || 
    task.remarks || 
    task.Remarks || 
    task.desc || 
    task.Desc || 
    task.description || 
    task.Description || 
    task.details || 
    task.Details || 
    task.TaskDesc || 
    task.TaskDetails || 
    task.raw?.remark || 
    task.raw?.Remark || 
    task.raw?.remarks || 
    task.raw?.Remarks || 
    task.raw?.desc || 
    task.raw?.Desc || 
    task.raw?.description || 
    task.raw?.Description || 
    task.raw?.details || 
    task.raw?.Details || 
    task.raw?.TaskDesc || 
    task.raw?.TaskDetails || 
    'No description available for this task.';

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: '#FFF',
          transform: [{ translateX: slideAnim }],
        }}
      >
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
        
        {/* Header */}
        <View style={styles.header}>
         
          <Text style={styles.headerTitle}>Task Detail</Text>
          <View style={styles.headerRight} />
        </View>

        {/* Content */}
        <ScrollView 
          style={styles.content} 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.titleSection}>
            <View style={styles.tagRow}>
                <View style={styles.categoryTag}>
                    <Text style={styles.categoryText}>{task.taskCategory || 'Task'}</Text>
                </View>
                {task.priority === 'High' && (
                    <View style={[styles.priorityTag, styles.highPriority]}>
                        <Text style={styles.priorityText}>High Priority</Text>
                    </View>
                )}
            </View>
            <Text style={styles.taskTitle}>{task.title}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.descriptionSection}>
            <Text style={styles.sectionLabel}>Description & Guidelines</Text>
            <Text style={styles.descriptionText}>{description}</Text>
          </View>
          
          <View style={styles.infoBox}>
            <MaterialCommunityIcons name="information-outline" size={20} color={appTheme.colors.brand.secondary} />
            <Text style={styles.infoText}>
                Please read the instructions carefully before starting the task. You will need to capture photos and videos as proof of completion.
            </Text>
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          {viewOnly ? (
            <TouchableOpacity
              style={[styles.startBtn, { backgroundColor: '#64748B' }]}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Text style={styles.startBtnText}>Close Details</Text>
              <MaterialCommunityIcons
                name="close-circle"
                size={22}
                color="#FFF"
              />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.startBtn}
              onPress={() => onStart(task)}
              activeOpacity={0.8}
            >
              <Text style={styles.startBtnText}>Start Task</Text>
              <MaterialCommunityIcons
                name="play-circle"
                size={22}
                color={appTheme.colors.brand.accent}
              />
            </TouchableOpacity>
          )}
        </View>
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: appTheme.colors.neutral.text,
  },
  headerRight: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  titleSection: {
    marginBottom: 20,
  },
  tagRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  categoryTag: {
    backgroundColor: appTheme.colors.brand.softTint,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
    color: appTheme.colors.brand.primary,
    textTransform: 'uppercase',
  },
  priorityTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  highPriority: {
    backgroundColor: 'rgba(180, 35, 24, 0.1)',
  },
  priorityText: {
    fontSize: 11,
    fontWeight: '600',
    color: appTheme.colors.status.danger,
    textTransform: 'uppercase',
  },
  taskTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: appTheme.colors.neutral.text,
    lineHeight: 32,
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginBottom: 24,
  },
  descriptionSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: appTheme.colors.brand.secondary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  descriptionText: {
    fontSize: 16,
    color: appTheme.colors.neutral.text,
    lineHeight: 24,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 13,
    color: appTheme.colors.neutral.textMuted,
    lineHeight: 18,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    backgroundColor: '#FFF',
  },
  startBtn: {
    backgroundColor: appTheme.colors.brand.primary,
    flexDirection: 'row',
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: appTheme.colors.brand.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  startBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginRight: 10,
  },
});

export default TaskDetailModal;
