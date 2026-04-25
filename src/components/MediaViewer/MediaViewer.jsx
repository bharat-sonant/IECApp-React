import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  ScrollView,
  TouchableOpacity,
  View,
  Animated,
  Dimensions,
} from 'react-native';
import RNFS from 'react-native-fs';
import { NativeModules } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { createVideoThumbnail } from 'react-native-compressor';
import appTheme from '../../theme/appTheme';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

const { MediaDownload } = NativeModules;

const toastStyles = {
  success: {
    label: 'Success',
    accentColor: appTheme.colors.status.success,
    icon: 'check-circle-outline',
    iconBg: 'rgba(22, 122, 69, 0.12)',
    labelBg: 'rgba(22, 122, 69, 0.06)',
    labelText: appTheme.colors.neutral.text,
    surfaceBg: appTheme.colors.neutral.surface,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
  error: {
    label: 'Error',
    accentColor: appTheme.colors.status.danger,
    icon: 'close-circle-outline',
    iconBg: 'rgba(180, 35, 24, 0.12)',
    labelBg: 'rgba(22, 122, 69, 0.06)',
    labelText: appTheme.colors.neutral.text,
    surfaceBg: appTheme.colors.neutral.surface,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
  info: {
    label: 'Info',
    accentColor: appTheme.colors.brand.primaryDark,
    icon: 'information-outline',
    iconBg: 'rgba(18, 59, 74, 0.12)',
    labelBg: 'rgba(22, 122, 69, 0.06)',
    labelText: appTheme.colors.neutral.text,
    surfaceBg: appTheme.colors.neutral.surface,
    borderColor: 'rgba(185, 199, 209, 0.95)',
  },
};

const MediaRow = ({
  item,
  onPreview,
  onDownload,
  onDownloadWithLatLng,
  downloading,
  downloadingWithLatLng,
  index,
  showLatLngOptions,
  videoThumbnailUri,
}) => {
  const [imgLoading, setImgLoading] = React.useState(true);
  const [thumbLoading, setThumbLoading] = React.useState(true);

  return (
    <View style={styles.rowCard}>
      <Text style={styles.serialNumber}>{index + 1}</Text>
      {item.type === 'image' ? (
        <Pressable style={styles.thumbnailWrap} onPress={onPreview}>
          {imgLoading && (
            <View style={styles.thumbnailLoader}>
              <ActivityIndicator size="small" color={appTheme.colors.brand.primary} />
            </View>
          )}
          <Image 
            source={{ uri: item.uri }} 
            style={styles.thumbnail} 
            resizeMode="cover"
            onLoadStart={() => setImgLoading(true)}
            onLoadEnd={() => setImgLoading(false)}
          />
        </Pressable>
      ) : (
        <View style={styles.thumbnailWrap}>
          <View style={styles.videoThumb}>
            {videoThumbnailUri ? (
              <>
                {thumbLoading && (
                  <View style={styles.thumbnailLoader}>
                    <ActivityIndicator size="small" color={appTheme.colors.brand.primary} />
                  </View>
                )}
                <Image
                  source={{ uri: videoThumbnailUri }}
                  style={styles.videoThumbImage}
                  resizeMode="cover"
                  onLoadStart={() => setThumbLoading(true)}
                  onLoadEnd={() => setThumbLoading(false)}
                />
              </>
            ) : (
              <View style={[styles.thumbnailLoader, { backgroundColor: '#1E293B' }]}>
                <MaterialCommunityIcons name="video-box" size={32} color="#64748B" />
              </View>
            )}
            <View style={styles.videoThumbOverlay} />
           
          </View>
        </View>
      )}

      <View style={styles.rowMeta} />

      {showLatLngOptions ? (
        <View style={styles.downloadIconStack}>
          <TouchableOpacity
            style={[styles.iconAction, downloadingWithLatLng && styles.iconBusy]}
            onPress={onDownloadWithLatLng}
            disabled={downloading || downloadingWithLatLng}
          >
            {downloadingWithLatLng ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <MaterialCommunityIcons
                name="map-marker-radius-outline"
                size={18}
                color="#fff"
              />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconAction, downloading && styles.iconBusy]}
            onPress={onDownload}
            disabled={downloading || downloadingWithLatLng}
          >
            {downloading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <MaterialCommunityIcons name="download" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.singleIconWrap}>
          <TouchableOpacity
            style={[styles.iconAction, downloading && styles.iconBusy]}
            onPress={onDownload}
            disabled={downloading}
          >
            {downloading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <MaterialCommunityIcons
                name="download"
                size={18}
                color="#fff"
              />
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const MediaViewer = ({
  visible,
  images = [],
  videos = [],
  taskMeta = {},
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const slideAnim = React.useRef(new Animated.Value(Dimensions.get('window').width)).current;
  const previewSlideAnim = React.useRef(new Animated.Value(Dimensions.get('window').width)).current;

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

  React.useEffect(() => {
    if (!!previewUri) {
      Animated.spring(previewSlideAnim, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    } else {
      previewSlideAnim.setValue(Dimensions.get('window').width);
    }
  }, [previewUri, previewSlideAnim]);

  console.log('[MediaViewer] render', {
    visible,
    imagesCount: images.length,
    videosCount: videos.length,
    taskId: taskMeta?.id || taskMeta?.taskId || '(empty)',
    imagesArray: images,
    videosArray: videos,
  });
  const [previewUri, setPreviewUri] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloadingUri, setDownloadingUri] = useState('');
  const [downloadingLatLngUri, setDownloadingLatLngUri] = useState('');
  const [toastState, setToastState] = useState(null);
  const [videoThumbnails, setVideoThumbnails] = useState({});
  const toastTimerRef = React.useRef(null);
  const latLng =
    typeof taskMeta?.latLng === 'string' ? taskMeta.latLng.trim() : '';
  const hasLatLng = !!latLng;
  const toastMessage = toastState?.message ?? '';
  const toastVariant = toastState?.variant ?? 'info';
  const toastTheme = toastStyles[toastVariant] ?? toastStyles.info;
  const hasToast = Boolean(toastState && toastMessage);

  const showToast = (message, variant = 'info') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    if (typeof message !== 'string' || !message.trim()) {
      console.log('[MediaViewer] toast skipped - empty message');
      return;
    }

    console.log('[MediaViewer] toast show', {
      variant,
      message: message.trim(),
    });
    setToastState({ message: message.trim(), variant });
    toastTimerRef.current = setTimeout(() => {
      setToastState(null);
    }, 2600);
  };

  useEffect(() => {
    if (!visible) {
      console.log('[MediaViewer] closed');
      setPreviewUri('');
      setDownloadingUri('');
      setDownloadingLatLngUri('');
      setToastState(null);
      return;
    }

    console.log('[MediaViewer] taskMeta:', taskMeta);
    console.log('[MediaViewer] latLng:', latLng || '(missing)');

    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, [visible, taskMeta, latLng]);

  const imageItems = useMemo(
    () => {
      console.log('[MediaViewer] mapping imageItems from:', images);
      return images
        .map((uri, index) => {
          if (typeof uri !== 'string' || !uri.trim()) {
            return null;
          }

          const fileName = `Image ${index + 1}.jpg`;
          return {
            id: `image-${index}`,
            type: 'image',
            uri,
            fileName,
            label: `Image ${index + 1}`,
          };
        })
        .filter(Boolean);
    },
    [images],
  );

  const videoItems = useMemo(
    () => {
      console.log('[MediaViewer] mapping videoItems from:', videos);
      return videos
        .map((uri, index) => {
          if (typeof uri !== 'string' || !uri.trim()) {
            return null;
          }

          const fileName = `Video ${index + 1}.mp4`;
          return {
            id: `video-${index}`,
            type: 'video',
            uri,
            fileName,
            label: `Video ${index + 1}`,
          };
        })
        .filter(Boolean);
    },
    [videos],
  );

  const hasMediaItems = imageItems.length > 0 || videoItems.length > 0;

  useEffect(() => {
    let isMounted = true;
    console.log('[MediaViewer] thumbnail build check', {
      videoCount: videoItems.length,
    });

    const buildThumbnails = async () => {
      const nextThumbs = {};
      console.log('[MediaViewer] thumbnail build start');

      await Promise.all(
        videoItems.map(async item => {
          try {
            // Wrap createVideoThumbnail in a timeout to prevent it from hanging the bridge/network
            const thumbnailPromise = createVideoThumbnail(item.uri);
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Thumbnail generation timed out')), 5000)
            );
            const result = await Promise.race([thumbnailPromise, timeoutPromise]);
            
            if (result?.path && isMounted) {
              nextThumbs[item.uri] = result.path;
            }
          } catch (error) {
            console.log('[MediaViewer] Thumbnail generation failed/timed out for', item.uri, error);
          }
        }),
      );

      if (isMounted) {
        setVideoThumbnails(nextThumbs);
        console.log('[MediaViewer] thumbnail build complete', {
          count: Object.keys(nextThumbs).length,
        });
      }
    };

    if (videoItems.length) {
      buildThumbnails();
    } else {
      setVideoThumbnails({});
    }

    return () => {
      isMounted = false;
    };
  }, [videoItems]);

  if (!visible || !hasMediaItems) {
    return null;
  }

  const handleDownload = async (item, options = {}) => {
    if (!item?.uri) {
      console.log('[MediaViewer] download skipped - missing uri');
      return;
    }

    const { withLatLng = false } = options;
    console.log('[MediaViewer] download start', {
      id: item?.id || '(empty)',
      type: item?.type || '(empty)',
      withLatLng,
      fileName: item?.fileName || '(auto)',
    });

    try {
      if (withLatLng) {
        setDownloadingLatLngUri(item.uri);
      } else {
        setDownloadingUri(item.uri);
      }

      const rawFileName = item.fileName || `media_${Date.now()}`;
      const baseName = rawFileName.replace(/\.[^.]+$/, '');
      const extension = rawFileName.substring(rawFileName.lastIndexOf('.'));
      
      const safeTaskId = String(taskMeta?.taskId || taskMeta?.id || 'Task').replace(/[^a-zA-Z0-9]/g, '_');
      const safeKey = String(taskMeta?.key || taskMeta?.mediaKey || '1').replace(/[^a-zA-Z0-9]/g, '_');
      const taskTimeRaw = String(taskMeta?._at || taskMeta?.date || '').replace(/[^a-zA-Z0-9]/g, '');
      const timeSuffix = taskTimeRaw ? `_${taskTimeRaw}` : '';
      
      const finalName =
        withLatLng && item.type === 'image'
          ? `Edited_${safeTaskId}_${safeKey}${timeSuffix}_${baseName}.jpg`
          : `${safeTaskId}_${safeKey}${timeSuffix}_${baseName}${extension}`;

      if (withLatLng && item.type === 'image') {
        if (!latLng || !MediaDownload?.downloadImageWithLatLng) {
          throw new Error('Lat/Lng download is not available right now.');
        }

        const [latitude = '', longitude = ''] = latLng.split(',');
        const savedLocation = await MediaDownload.downloadImageWithLatLng(
          item.uri,
          String(latitude).trim(),
          String(longitude).trim(),
          finalName,
          taskMeta?.address ?? '',
          taskMeta?._at ?? taskMeta?.date ?? '',
        );
        showToast('Image saved with Lat/Lng', 'success');
        console.log('[MediaViewer] Saved with Lat/Lng at', savedLocation);
      } else {
        const safeDownloadsDir = RNFS.DownloadDirectoryPath || `${RNFS.ExternalStorageDirectoryPath}/Download`;
        
        // Ensure the directory exists to prevent 'No such file or directory' errors
        const dirExists = await RNFS.exists(safeDownloadsDir);
        if (!dirExists) {
          try {
            await RNFS.mkdir(safeDownloadsDir);
          } catch (e) {
            console.log('[MediaViewer] Failed to create download dir, falling back to Documents', e);
          }
        }

        // If it still doesn't exist, fallback to DocumentDirectoryPath which is always accessible
        const finalDir = (await RNFS.exists(safeDownloadsDir)) ? safeDownloadsDir : RNFS.DocumentDirectoryPath;
        
        if (!finalDir) {
          throw new Error('Download folder is not available on this device.');
        }

        const safeFileName = finalName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const destination = `${finalDir}/${safeFileName}`;
        
        const result = await RNFS.downloadFile({
          fromUrl: item.uri,
          toFile: destination,
          background: false, // background: true can cause timeouts on Android
          readTimeout: 60000,
          connectionTimeout: 30000,
          discretionary: false,
        }).promise;

        if (result.statusCode === 200) {
          console.log('[MediaViewer] download success', {
            destination,
            statusCode: result.statusCode,
          });
          showToast(`${finalName} saved to Downloads`, 'success');
        } else {
          throw new Error(`Download failed with status ${result.statusCode}`);
        }
      }
    } catch (error) {
      console.log('[MediaViewer] download failed', {
        message: error?.message || '(no message)',
        raw: error,
      });
      showToast(error?.message || 'Download failed', 'error');
    } finally {
      if (withLatLng) {
        setDownloadingLatLngUri('');
      } else {
        setDownloadingUri('');
      }
      console.log('[MediaViewer] download end', {
        withLatLng,
      });
    }
  };

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons
        name="folder-image-outline"
        size={42}
        color="#A8B2C3"
      />
      <Text style={styles.emptyTitle}>No media available</Text>
      <Text style={styles.emptySubtitle}>
        This task does not have any images or videos.
      </Text>
    </View>
  );

  const renderSection = (title, items, kind) => {
    if (!items.length) {
      return null;
    }

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionCount}>{items.length}</Text>
        </View>
        <View style={styles.listHeader}>
          <Text style={[styles.listHeaderText, styles.listHeaderSn]}>S.No</Text>
          <Text style={[styles.listHeaderText, styles.listHeaderMedia]}>
            {kind === 'image' ? 'Images' : 'Videos'}
          </Text>
          <Text style={[styles.listHeaderText, styles.listHeaderAction]}>
            Action
          </Text>
        </View>
        {items.map((item, index) => (
          <MediaRow
            key={item.id}
            item={item}
            index={index}
            downloading={downloadingUri === item.uri}
            downloadingWithLatLng={downloadingLatLngUri === item.uri}
            showLatLngOptions={kind === 'image' && hasLatLng}
            videoThumbnailUri={videoThumbnails[item.uri]}
            onPreview={() => setPreviewUri(item.uri)}
            onDownload={() => handleDownload(item)}
            onDownloadWithLatLng={() =>
              handleDownload(item, { withLatLng: true })
            }
          />
        ))}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={true}
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: appTheme.colors.neutral.background,
          transform: [{ translateX: slideAnim }],
        }}
      >
        <View style={styles.backdrop}>
        <StatusBar
          barStyle="dark-content"
          backgroundColor={appTheme.colors.neutral.background}
          translucent={false}
        />
        <SafeAreaView
          style={styles.safeArea}
          edges={['top', 'left', 'right']}
        >
          <View style={styles.container}>
            <View style={styles.headerShell}>
              <View style={styles.headerTextBlock}>
                <Text style={styles.headerTitle}>
                  Images and videos from the task
                </Text>
                <Text style={styles.headerSubtitle}>
                  {imageItems.length} photos
                  {videoItems.length ? ` • ${videoItems.length} videos` : ''}
                </Text>
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                <MaterialCommunityIcons name="close" size={18} color="#fff" />
              </TouchableOpacity>
            </View>


            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              {renderSection('Images', imageItems, 'image')}
              {renderSection('Videos', videoItems, 'video')}
              {!imageItems.length && !videoItems.length ? renderEmpty() : null}
            </ScrollView>
          </View>
        </SafeAreaView>

        <Modal
          visible={!!previewUri}
          transparent
          animationType="none"
          onRequestClose={() => setPreviewUri('')}
        >
          <View style={styles.previewBackdrop}>
            <Animated.View
              style={[
                styles.previewCard,
                { transform: [{ translateX: previewSlideAnim }] },
              ]}
            >
              <View style={styles.previewTopBar}>
                <View style={styles.previewTitleBlock}>
                  <Text style={styles.previewEyebrow}>Image Preview</Text>
                  <Text style={styles.previewTitle} numberOfLines={1}>
                    {previewUri ? 'Media from task' : ''}
                  </Text>
                </View>
                <Pressable
                  style={styles.previewCloseButton}
                  onPress={() => setPreviewUri('')}
                >
                  <MaterialCommunityIcons
                    name="close"
                    size={18}
                    color="#fff"
                  />
                </Pressable>
              </View>
              <View style={styles.previewFrame}>
                {previewUri ? (
                  <>
                    {previewLoading && (
                      <View style={styles.previewLoader}>
                        <ActivityIndicator size="large" color="#fff" />
                      </View>
                    )}
                    <Image
                      source={{ uri: previewUri }}
                      style={styles.previewImage}
                      onLoadStart={() => setPreviewLoading(true)}
                      onLoadEnd={() => setPreviewLoading(false)}
                    />
                  </>
                ) : null}
              </View>
            </Animated.View>
          </View>
        </Modal>

        <Modal
          transparent
          visible={hasToast}
          animationType="fade"
          onRequestClose={() => setToastState(null)}
        >
          <View style={styles.toastOverlay} pointerEvents="box-none">
            <View
              style={[styles.toastWrap, { top: insets.top + 14 }]}
              pointerEvents="none"
            >
              <View
                style={[
                  styles.toastCard,
                  {
                    borderColor: toastTheme.borderColor,
                    backgroundColor: toastTheme.surfaceBg,
                  },
                ]}
              >
                <View
                  style={[
                    styles.toastAccent,
                    { backgroundColor: toastTheme.accentColor },
                  ]}
                />
                <View
                  style={[
                    styles.toastIconWrap,
                    { backgroundColor: toastTheme.iconBg },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={toastTheme.icon}
                    size={18}
                    color={toastTheme.accentColor}
                  />
                </View>
                <View style={styles.toastTextWrap}>
                  <Text style={styles.toastTitle}>{toastTheme.label}</Text>
                  <Text style={styles.toastText} numberOfLines={2}>
                    {toastMessage}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      </View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: appTheme.colors.neutral.background,
  },
  safeArea: {
    flex: 1,
    backgroundColor: appTheme.colors.neutral.background,
  },
  container: {
    flex: 1,
    backgroundColor: appTheme.colors.neutral.background,
  },
  headerShell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: appTheme.colors.brand.primary,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appTheme.colors.brand.accent,
  },
  headerTextBlock: {
    flex: 1,
    paddingRight: 12,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 19,
    fontWeight: '800',
  },
  headerSubtitle: {
    marginTop: 5,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '600',
  },
  headerBar: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appTheme.colors.brand.primary,
    paddingHorizontal: 8,
  },
  headerBarText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  headerBarMedia: {
    flex: 1,
    marginLeft: 10,
  },
  headerBarAction: {
    width: 92,
    textAlign: 'center',
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 8,
    paddingBottom: 20,
  },
  section: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: appTheme.colors.neutral.border,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: appTheme.colors.neutral.surface,
  },
  sectionHeader: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    backgroundColor: appTheme.colors.brand.softTint,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: appTheme.colors.brand.primaryDark,
  },
  sectionCount: {
    minWidth: 26,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    color: appTheme.colors.brand.primary,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  listHeader: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appTheme.colors.brand.primary,
    paddingHorizontal: 8,
  },
  listHeaderText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  listHeaderSn: {
    width: 34,
    textAlign: 'center',
  },
  listHeaderMedia: {
    flex: 1,
  },
  listHeaderAction: {
    width: 96,
    textAlign: 'center',
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: appTheme.colors.neutral.border,
  },
  serialNumber: {
    width: 34,
    fontSize: 13,
    fontWeight: '800',
    color: appTheme.colors.neutral.text,
    textAlign: 'center',
  },
  thumbnailWrap: {
    width: 120,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#D9DEE9',
    marginRight: 10,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  videoThumb: {
    flex: 1,
    backgroundColor: '#152935',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoThumbImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  videoThumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  videoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  videoBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  rowMeta: {
    flex: 1,
    paddingRight: 10,
  },
  downloadIconStack: {
    width: 96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  singleIconWrap: {
    width: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconAction: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: appTheme.colors.brand.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBusy: {
    backgroundColor: appTheme.colors.brand.primaryDark,
  },
  emptyState: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: '800',
    color: appTheme.colors.neutral.text,
  },
  emptySubtitle: {
    marginTop: 6,
    textAlign: 'center',
    color: appTheme.colors.neutral.textMuted,
    fontSize: 13,
    paddingHorizontal: 18,
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 17, 28, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  previewCard: {
    width: '100%',
    maxWidth: 620,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  previewFrame: {
    width: '100%',
    height: 520,
    overflow: 'hidden',
    backgroundColor: '#101922',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  previewTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: appTheme.colors.brand.primaryDark,
  },
  previewTitleBlock: {
    flex: 1,
    paddingRight: 12,
  },
  previewEyebrow: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  previewTitle: {
    marginTop: 4,
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  previewCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: appTheme.colors.brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 30,
  },
  previewLoader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  thumbnailLoader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F8FA',
    zIndex: 1,
  },
  toastOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  toastCard: {
    width: '100%',
    backgroundColor: appTheme.colors.neutral.surface,
    borderWidth: 1,
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 84,
    paddingHorizontal: 12,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
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
});

export default MediaViewer;
