import React, {useEffect, useRef, useState} from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  StatusBar,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {launchImageLibrary} from 'react-native-image-picker';
import {Video as VideoCompressor, createVideoThumbnail} from 'react-native-compressor';
import appTheme from '../theme/appTheme';
import ReusableCamera from './ReusableCamera';
import {useAppFeedback} from './AppFeedback';

const inlineToastStyles = {
  warning: {
    label: 'Warning',
    icon: 'alert-outline',
    accentColor: appTheme.colors.status.warning,
    iconBg: 'rgba(199, 125, 0, 0.12)',
    surfaceBg: appTheme.colors.neutral.surface,
    labelText: appTheme.colors.neutral.text,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
  error: {
    label: 'Error',
    icon: 'alert-circle-outline',
    accentColor: appTheme.colors.status.danger,
    iconBg: 'rgba(180, 35, 24, 0.12)',
    surfaceBg: appTheme.colors.neutral.surface,
    labelText: appTheme.colors.neutral.text,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
  success: {
    label: 'Success',
    icon: 'check-circle-outline',
    accentColor: appTheme.colors.status.success,
    iconBg: 'rgba(22, 122, 69, 0.12)',
    surfaceBg: appTheme.colors.neutral.surface,
    labelText: appTheme.colors.neutral.text,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
  info: {
    label: 'Info',
    icon: 'information-outline',
    accentColor: appTheme.colors.brand.primaryDark,
    iconBg: 'rgba(18, 59, 74, 0.12)',
    surfaceBg: appTheme.colors.neutral.surface,
    labelText: appTheme.colors.neutral.text,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
};

const TaskActionModal = ({visible, onClose, mode}) => {
  const {showAlert, showToast} = useAppFeedback();
  const [selectedTaskParam, setSelectedTaskParam] = useState(null);
  const [ward, setWard] = useState('');
  const [participants, setParticipants] = useState('');
  const [remark, setRemark] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [inlineToast, setInlineToast] = useState(null);
  const inlineToastTimerRef = useRef(null);

  // Media states
  const [images, setImages] = useState([]);
  const [videos, setVideos] = useState([]);
  const [isCameraVisible, setIsCameraVisible] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);

  useEffect(() => {
    if (visible) {
      if (mode === 'pick_task') {
        setSelectedTaskParam('Pending inspection in Zone B');
      } else {
        setSelectedTaskParam(null);
      }
      setFieldErrors({});
      setInlineToast(null);
    } else {
      setWard('');
      setParticipants('');
      setRemark('');
      setImages([]);
      setVideos([]);
      setFieldErrors({});
      setInlineToast(null);
    }
  }, [visible, mode]);

  useEffect(() => {
    return () => {
      if (inlineToastTimerRef.current) {
        clearTimeout(inlineToastTimerRef.current);
      }
    };
  }, []);

  const updateField = (setter, fieldName) => value => {
    setter(value);
    setFieldErrors(prev => {
      if (!prev[fieldName]) {
        return prev;
      }
      const nextErrors = {...prev};
      delete nextErrors[fieldName];
      return nextErrors;
    });
  };

  const showInlineToast = (message, variant = 'warning') => {
    if (inlineToastTimerRef.current) {
      clearTimeout(inlineToastTimerRef.current);
    }

    setInlineToast({message, variant});
    inlineToastTimerRef.current = setTimeout(() => {
      setInlineToast(null);
    }, 2200);
  };

  const handleSave = () => {
    if (mode === 'pick_task' && !selectedTaskParam) {
      setFieldErrors({selectedTask: true});
      showInlineToast('Please select a task.', 'warning');
      return;
    }

    if (!ward.trim()) {
      setFieldErrors({ward: true});
      showInlineToast('Ward number is required.', 'warning');
      return;
    }

    if (!participants.trim()) {
      setFieldErrors({participants: true});
      showInlineToast('Participants count is required.', 'warning');
      return;
    }

    if (!/^\d+$/.test(participants.trim()) || Number(participants) <= 0) {
      setFieldErrors({participants: true});
      showInlineToast('Enter a valid participants count.', 'warning');
      return;
    }

    if (!remark.trim()) {
      setFieldErrors({remark: true});
      showInlineToast('Remark / description is required.', 'warning');
      return;
    }

    setFieldErrors({});
    showToast('Task details have been submitted.', 'success');
    onClose();
  };

  const captureImage = () => {
    if (images.length >= 5) {
      showInlineToast('You can only attach up to 5 images.', 'warning');
      return;
    }
    setIsCameraVisible(true);
  };

  const onPictureTaken = uri => {
    setImages(prev => [...prev, uri]);
  };

  const captureVideo = async () => {
    if (videos.length >= 2) {
      showInlineToast('You can only attach up to 2 videos.', 'warning');
      return;
    }
    try {
      const result = await launchImageLibrary({
        mediaType: 'video',
        videoQuality: 'high',
        selectionLimit: 1,
      });

      if (result.didCancel || result.errorCode || !result.assets) return;

      const videoUri = result.assets[0].uri;
      const compressedUri = await VideoCompressor.compress(videoUri, {
        compressionMethod: 'auto',
        maxSize: 720,
        minimumFileSizeForCompress: 0,
      });

      const finalVideoUri = compressedUri || videoUri;
      let thumbnailUri = null;

      try {
        const thumbnail = await createVideoThumbnail(finalVideoUri);
        thumbnailUri = thumbnail?.path || null;
      } catch (thumbnailError) {
        console.warn('Thumbnail error: ', thumbnailError);
      }

      setVideos(prev => [...prev, {uri: finalVideoUri, thumbnailUri}]);
    } catch (err) {
      console.warn('Video upload error: ', err);
      showAlert({title: 'Video Error', message: 'Video could not be processed. Please try again.'});
    }
  };

  const getPageTitle = () => {
    if (mode === 'add_kpi') return 'Add KPI Task';
    if (mode === 'add_other') return 'Add Other Task';
    return 'Complete Task';
  };

  const getDropdownPlaceholder = () => {
    if (mode === 'add_kpi') return '-- Task --';
    if (mode === 'add_other') return '-- Task --';
    return 'Selected task';
  };

  const inlineToastTheme = inlineToast ? inlineToastStyles[inlineToast.variant] ?? inlineToastStyles.warning : inlineToastStyles.warning;

  return (
    <>
      <ReusableCamera
        visible={isCameraVisible}
        onClose={() => setIsCameraVisible(false)}
        onPictureTaken={onPictureTaken}
      />
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
          <StatusBar barStyle="dark-content" backgroundColor="#FFF" />

          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={onClose} activeOpacity={0.6}>
              <MaterialCommunityIcons name="arrow-left" size={24} color={appTheme.colors.neutral.text} />
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>{getPageTitle()}</Text>
              <Text style={styles.headerSubtitle}>Please fill the required details below</Text>
            </View>
          </View>

          <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Selected Task</Text>
                <TouchableOpacity
                  style={[styles.pickerSelector, fieldErrors.selectedTask ? styles.inputError : null]}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (mode === 'pick_task') return;
                  }}>
                  <View style={styles.pickerContent}>
                    <MaterialCommunityIcons
                      name="clipboard-check-outline"
                      size={20}
                      color={appTheme.colors.brand.primary}
                      style={{marginRight: 10}}
                    />
                    <Text style={[styles.pickerText, !selectedTaskParam && styles.pickerPlaceholder]}>
                      {selectedTaskParam ? selectedTaskParam : getDropdownPlaceholder()}
                    </Text>
                  </View>
                  {mode !== 'pick_task' && (
                    <MaterialCommunityIcons
                      name="chevron-down"
                      size={22}
                      color={appTheme.colors.neutral.textMuted}
                    />
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.rowGrid}>
                <View style={[styles.inputGroup, {flex: 1, marginRight: 12}]}>
                  <Text style={styles.label}>Ward No. <Text style={styles.reqStar}>*</Text></Text>
                  <TextInput
                    style={[styles.input, fieldErrors.ward ? styles.inputError : null]}
                    placeholder="Ex: 14A"
                    placeholderTextColor="#94A3B8"
                    value={ward}
                    onChangeText={updateField(setWard, 'ward')}
                    keyboardType="default"
                  />
                </View>
                <View style={[styles.inputGroup, {flex: 1}]}>
                  <Text style={styles.label}>Participants <Text style={styles.reqStar}>*</Text></Text>
                  <TextInput
                    style={[styles.input, fieldErrors.participants ? styles.inputError : null]}
                    placeholder="Total count"
                    placeholderTextColor="#94A3B8"
                    value={participants}
                    onChangeText={updateField(setParticipants, 'participants')}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.mediaSection}>
                <View style={styles.mediaHeaderRow}>
                  <View>
                    <Text style={styles.mediaTitle}>Task Photos</Text>
                    <Text style={styles.mediaSubtitle}>Take clear pictures of the work</Text>
                  </View>
                  <Text style={styles.mediaCount}>{images.length} / 5</Text>
                </View>

                <View style={styles.mediaGrid}>
                  {images.length < 5 && (
                    <TouchableOpacity
                      style={[styles.previewCard, styles.uploadDashedBox]}
                      activeOpacity={0.7}
                      onPress={captureImage}>
                      <MaterialCommunityIcons name="camera-plus" size={32} color={appTheme.colors.brand.primary} />
                      <Text style={styles.uploadSmallText}>Add Photo</Text>
                    </TouchableOpacity>
                  )}

                  {images.map((imgUri, index) => (
                    <TouchableOpacity
                      key={index}
                      style={styles.previewCard}
                      activeOpacity={0.8}
                      onPress={() => setPreviewImage(imgUri)}>
                      <Image source={{uri: imgUri}} style={styles.previewImg} />
                      <TouchableOpacity
                        style={styles.removeMediaBtn}
                        onPress={() => {
                          const newImgs = [...images];
                          newImgs.splice(index, 1);
                          setImages(newImgs);
                        }}>
                        <MaterialCommunityIcons name="close" size={14} color="#FFF" />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.mediaSection}>
                <View style={styles.mediaHeaderRow}>
                  <View>
                    <Text style={styles.mediaTitle}>
                      Task Video <Text style={styles.optionalText}>(Optional)</Text>
                    </Text>
                    <Text style={styles.mediaSubtitle}>Keep it under 30 seconds</Text>
                  </View>
                  <Text style={styles.mediaCount}>{videos.length} / 2</Text>
                </View>

                <View style={styles.mediaGrid}>
                  {videos.length < 2 && (
                    <TouchableOpacity
                      style={[styles.previewCard, styles.uploadDashedBox]}
                      activeOpacity={0.7}
                      onPress={captureVideo}>
                      <MaterialCommunityIcons name="video-plus" size={32} color={appTheme.colors.brand.primary} />
                      <Text style={styles.uploadSmallText}>Add Video</Text>
                    </TouchableOpacity>
                  )}

                  {videos.map((videoItem, index) => (
                    <View key={index} style={styles.previewCard}>
                      {videoItem.thumbnailUri ? (
                        <Image source={{uri: videoItem.thumbnailUri}} style={styles.previewImg} />
                      ) : (
                        <View style={styles.videoPlaceholder}>
                          <MaterialCommunityIcons name="play-circle" size={38} color="#FFF" />
                        </View>
                      )}
                      <TouchableOpacity
                        style={styles.removeMediaBtn}
                        onPress={() => {
                          const newVids = [...videos];
                          newVids.splice(index, 1);
                          setVideos(newVids);
                        }}>
                        <MaterialCommunityIcons name="close" size={14} color="#FFF" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Remarks / Description <Text style={styles.reqStar}>*</Text></Text>
                <TextInput
                  style={[styles.input, styles.textArea, fieldErrors.remark ? styles.inputError : null]}
                  placeholder="Write observation details here..."
                  placeholderTextColor="#94A3B8"
                  multiline
                  numberOfLines={4}
                  value={remark}
                  onChangeText={updateField(setRemark, 'remark')}
                  textAlignVertical="top"
                />
              </View>

              <View style={{height: 100}} />
            </ScrollView>
          </KeyboardAvoidingView>

          {inlineToast ? (
            <View pointerEvents="none" style={styles.inlineToastWrap}>
              <View
                style={[
                  styles.inlineToast,
                  {
                    borderColor: inlineToastTheme.borderColor,
                    backgroundColor: inlineToastTheme.surfaceBg,
                  },
                ]}>
                <View style={[styles.inlineToastAccent, {backgroundColor: inlineToastTheme.accentColor}]} />
                <MaterialCommunityIcons
                  name={inlineToastTheme.icon}
                  size={18}
                  color={inlineToastTheme.accentColor}
                  style={styles.inlineToastIcon}
                />
                <View style={styles.inlineToastTextWrap}>
                  <Text style={[styles.inlineToastTitle, {color: inlineToastTheme.labelText}]}>{inlineToastTheme.label}</Text>
                  <Text style={styles.inlineToastText} numberOfLines={2}>{inlineToast.message}</Text>
                </View>
              </View>
            </View>
          ) : null}

          <View style={styles.bottomBar}>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSave} activeOpacity={0.85}>
              <Text style={styles.submitBtnText}>Submit Task</Text>
              <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" style={{marginLeft: 8}} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={!!previewImage} transparent={true} animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.fullScreenPreviewBg}>
          <SafeAreaView style={{flex: 1}}>
            <View style={styles.previewHeader}>
              <TouchableOpacity style={styles.previewCloseBtn} onPress={() => setPreviewImage(null)}>
                <MaterialCommunityIcons name="close" size={28} color="#FFF" />
              </TouchableOpacity>
            </View>
            {previewImage && <Image source={{uri: previewImage}} style={styles.fullScreenImg} resizeMode="contain" />}
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 20,
    paddingTop: 24,
  },
  inputGroup: {
    marginBottom: 20,
  },
  rowGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
    color: '#475569',
    marginBottom: 8,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  reqStar: {
    color: '#EF4444',
  },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#0F172A',
    minHeight: 56,
  },
  inputError: {
    borderColor: '#DC3545',
    backgroundColor: 'rgba(220, 53, 69, 0.04)',
  },
  textArea: {
    minHeight: 120,
    paddingTop: 16,
    paddingBottom: 16,
  },
  pickerSelector: {
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 16,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  pickerText: {
    fontSize: 16,
    color: '#0F172A',
    fontWeight: '600',
    flex: 1,
  },
  pickerPlaceholder: {
    color: '#94A3B8',
    fontWeight: '500',
  },
  divider: {
    height: 1.5,
    backgroundColor: '#E2E8F0',
    marginVertical: 24,
  },
  mediaSection: {
    marginBottom: 28,
  },
  mediaHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  mediaTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  optionalText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  mediaSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  mediaCount: {
    fontSize: 12,
    fontWeight: '700',
    color: appTheme.colors.brand.primary,
    backgroundColor: 'rgba(18, 59, 74, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: 8,
    paddingBottom: 4,
  },
  uploadDashedBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 0,
    shadowOpacity: 0,
  },
  uploadSmallText: {
    fontSize: 11,
    fontWeight: '700',
    color: appTheme.colors.brand.primary,
    marginTop: 6,
  },
  previewCard: {
    width: 100,
    height: 100,
    borderRadius: 16,
    marginRight: 12,
    marginBottom: 12,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 3},
    elevation: 3,
  },
  fullScreenPreviewBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    padding: 20,
  },
  previewCloseBtn: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  fullScreenImg: {
    flex: 1,
    width: '100%',
    marginBottom: 40,
  },
  previewImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeMediaBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineToastWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: 14,
    zIndex: 50,
  },
  inlineToast: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 84,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 8},
    elevation: 10,
    overflow: 'hidden',
  },
  inlineToastAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
  },
  inlineToastIcon: {
    marginRight: 12,
    marginTop: 1,
  },
  inlineToastTextWrap: {
    flex: 1,
    paddingRight: 4,
  },
  inlineToastTitle: {
    color: appTheme.colors.neutral.text,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  inlineToastText: {
    color: appTheme.colors.neutral.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 6,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFF',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: -6},
    elevation: 10,
  },
  submitBtn: {
    backgroundColor: appTheme.colors.brand.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: 16,
  },
  submitBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
});

export default TaskActionModal;
