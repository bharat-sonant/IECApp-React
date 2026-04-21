import React, {useEffect, useRef} from 'react';
import {ActivityIndicator, Animated, Easing, Image, Modal, StyleSheet, Text, View} from 'react-native';
import appTheme from '../theme/appTheme';

const CommonLoader = ({
  visible = false,
  message = 'Loading...',
  subMessage = '',
}) => {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();

    return () => {
      loop.stop();
      pulse.stopAnimation();
    };
  }, [pulse, visible]);

  if (!visible) {
    return null;
  }

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.logoShell}>
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  transform: [
                    {
                      scale: pulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.96, 1.08],
                      }),
                    },
                  ],
                  opacity: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.3, 0.68],
                  }),
                },
              ]}
            />
            <View style={styles.logoFrame}>
              <Image
                source={require('../assets/images/AppLogo.png')}
                resizeMode="contain"
                style={styles.logo}
              />
            </View>
          </View>

          <View style={styles.spinnerWrap}>
            <ActivityIndicator size="large" color={appTheme.colors.brand.accent} />
          </View>

          <Text style={styles.message}>{message}</Text>
          {!!subMessage && <Text style={styles.subMessage}>{subMessage}</Text>}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 30, 38, 0.56)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  content: {
    alignItems: 'center',
  },
  logoShell: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  pulseRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    borderColor: 'rgba(232, 155, 0, 0.28)',
  },
  logoFrame: {
    width: 80,
    height: 80,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.55)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 8},
    elevation: 8,
  },
  logo: {
    width: 60,
    height: 60,
  },
  spinnerWrap: {
    marginBottom: 14,
  },
  message: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 2,
  },
  subMessage: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default CommonLoader;
