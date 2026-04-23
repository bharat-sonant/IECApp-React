import React, { useRef, useState, useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Text,
  StatusBar,
  LogBox,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import ImageResizer from '@bam.tech/react-native-image-resizer';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';

// Suppress the TensorFlow model error at startup
LogBox.ignoreLogs(['Cannot read', 'this model does not support', 'TFLite']);

const ReusableCamera = ({ visible, onClose, onPictureTaken }) => {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [cameraPosition, setCameraPosition] = useState('back');
  const device = useCameraDevice(cameraPosition);
  const camera = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (visible && !hasPermission) {
      requestPermission();
    }
  }, [visible, hasPermission, requestPermission]);

  const toggleCamera = () => {
    setCameraPosition(prev => (prev === 'back' ? 'front' : 'back'));
  };

  const handleCapture = async () => {
    if (!camera.current || isProcessing) return;
    setIsProcessing(true);
    try {
      const photo = await camera.current.takePhoto({
        flash: 'auto',
      });

      // Standard Survey App compression: 1200x1200 max, 80% JPEG limit
      const resizedImage = await ImageResizer.createResizedImage(
        `file://${photo.path}`,
        1200,
        1200,
        'JPEG',
        80,
        0,
        null,
      );

      onPictureTaken(resizedImage.uri);
      onClose();
    } catch {
    } finally {
      setIsProcessing(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />

        {!hasPermission ? (
          <View style={styles.centerMode}>
            <Text style={styles.noAccessText}>
              Camera permission is required.
            </Text>
            <TouchableOpacity
              style={styles.requestBtn}
              onPress={requestPermission}
              activeOpacity={0.8}
            >
              <Text style={styles.requestBtnText}>Allow Camera Access</Text>
            </TouchableOpacity>
          </View>
        ) : !device ? (
          <View style={styles.centerMode}>
            <ActivityIndicator size="large" color="#FFF" />
          </View>
        ) : (
          <>
            <Camera
              ref={camera}
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={visible}
              photo={true}
            />

            {/* Seamless Absolute Overlay Grid */}
            <SafeAreaView
              style={styles.overlayContainer}
              edges={['top', 'bottom']}
              pointerEvents="box-none"
            >
              {/* TOP HEADER CONTROLS */}
              <View style={styles.topBar}>
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={onClose}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="close" size={26} color="#FFF" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.iconBtn}
                  activeOpacity={0.7}
                  onPress={() => {}}
                >
                  <MaterialCommunityIcons
                    name="flash-auto"
                    size={24}
                    color="#FFF"
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.spacer} />

              {/* BOTTOM CAMERA CONTROLS */}
              <View style={styles.bottomArea}>
                <View style={styles.controlsRow}>
                  <TouchableOpacity style={styles.iconBtnGhost} disabled />

                  {/* Premium Capture Ring effect */}
                  <TouchableOpacity
                    onPress={handleCapture}
                    style={styles.captureRing}
                    disabled={isProcessing}
                    activeOpacity={0.8}
                  >
                    <View style={styles.captureInner}>
                      {isProcessing && <ActivityIndicator color="#0B1F2A" />}
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.iconBtnFlip}
                    onPress={toggleCamera}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons
                      name="camera-flip-outline"
                      size={30}
                      color="#FFF"
                    />
                  </TouchableOpacity>
                </View>
                <Text style={styles.bottomInstructionText}>
                  Take Photo for Record
                </Text>
              </View>
            </SafeAreaView>
          </>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centerMode: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#081E26',
    paddingHorizontal: 24,
  },
  noAccessText: {
    color: '#FFF',
    fontSize: 16,
    marginBottom: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  requestBtn: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: '#E89B00',
    borderRadius: 12,
  },
  requestBtnText: {
    color: '#081E26',
    fontWeight: '800',
    fontSize: 16,
  },
  overlayContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  spacer: {
    flex: 1,
  },
  bottomArea: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingBottom: 40,
    paddingTop: 20,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 40,
    marginBottom: 20,
  },
  iconBtnGhost: {
    width: 50,
    height: 50,
  },
  iconBtnFlip: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 4,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomInstructionText: {
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});

export default ReusableCamera;
