import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import appTheme from '../theme/appTheme';
import { loadLoginSession } from '../services/sessionService';
import { useLocation } from '../context/LocationContext';

const LauncherScreen = ({ navigation }) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pulse = useRef(new Animated.Value(1)).current;
  const drift1 = useRef(new Animated.Value(0)).current;
  const drift2 = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const compact = height < 700;
  const logoSize = Math.min(width * 0.38, 150);
  const { stopTracking } = useLocation();

  useEffect(() => {
    // Stop location tracking when showing launcher (logged out)
    stopTracking();
    
    let isActive = true;
    const goToNextScreen = setTimeout(async () => {
      let session = null;
      try {
        session = await loadLoginSession();
      } catch {
        session = null;
      }

      if (!isActive) {
        return;
      }

      navigation.replace(session ? 'Dashboard' : 'Login');
    }, 2000);

    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.03,
            duration: 1100,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 1100,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(drift1, {
            toValue: 1,
            duration: 7000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(drift1, {
            toValue: 0,
            duration: 7000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(drift2, {
            toValue: 1,
            duration: 8500,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(drift2, {
            toValue: 0,
            duration: 8500,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ),
    ]).start();

    return () => {
      isActive = false;
      clearTimeout(goToNextScreen);
      pulse.stopAnimation();
      drift1.stopAnimation();
      drift2.stopAnimation();
      fade.stopAnimation();
    };
  }, [drift1, drift2, fade, navigation, pulse, stopTracking]);

  const drift1Y = drift1.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -18],
  });
  const drift1X = drift1.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 12],
  });
  const drift2Y = drift2.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 22],
  });
  const drift2X = drift2.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -14],
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={appTheme.colors.neutral.background}
      />
      <View style={styles.container}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.blobOne,
            { transform: [{ translateX: drift1X }, { translateY: drift1Y }] },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.blobTwo,
            { transform: [{ translateX: drift2X }, { translateY: drift2Y }] },
          ]}
        />

        <Animated.View
          style={[
            styles.centerWrap,
            {
              opacity: fade,
              paddingTop: insets.top + 16,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.logoShell,
              {
                width: logoSize + 38,
                height: logoSize + 38,
                borderRadius: (logoSize + 38) / 2,
                transform: [{ scale: pulse }],
              },
            ]}
          >
            <View
              style={[
                styles.logoInner,
                {
                  width: logoSize + 14,
                  height: logoSize + 14,
                  borderRadius: (logoSize + 14) / 2,
                },
              ]}
            >
              <Image
                source={require('../assets/images/AppLogo.png')}
                resizeMode="contain"
                style={{ width: logoSize, height: logoSize }}
              />
            </View>
          </Animated.View>

          <Text style={[styles.caption, compact && styles.captionCompact]}>
            Field Operations
          </Text>
          <Text
            style={[styles.motivation, compact && styles.motivationCompact]}
          >
            Stay ready, stay sharp.
          </Text>

          <View style={styles.loadingRow}>
            <View style={styles.loadingDot} />
            <View style={styles.loadingDot} />
            <View style={styles.loadingDot} />
          </View>
        </Animated.View>

        <View style={styles.footerWrap}>
          <Text style={styles.footer}>
            Powered by{' '}
            <Text style={appTheme.colors.brand.secondary}>
              Wevois Labes Pvt Ltd
            </Text>
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: appTheme.colors.neutral.background,
  },
  container: {
    flex: 1,
    backgroundColor: appTheme.colors.neutral.background,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blobOne: {
    position: 'absolute',
    top: -70,
    right: -50,
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: 'rgba(18, 59, 74, 0.08)',
  },
  blobTwo: {
    position: 'absolute',
    bottom: -90,
    left: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(232, 155, 0, 0.09)',
  },
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoShell: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18, 59, 74, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(18, 59, 74, 0.08)',
    marginBottom: 14,
  },
  logoInner: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  caption: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 5,
    color: appTheme.colors.neutral.textMuted,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  captionCompact: {
    fontSize: 12,
  },
  motivation: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: appTheme.colors.neutral.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  motivationCompact: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 14,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: appTheme.colors.brand.accent,
    opacity: 0.85,
  },
  footerWrap: {
    position: 'absolute',
    bottom: 14,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  footer: {
    fontSize: 11,
    letterSpacing: 0.5,
    color: appTheme.colors.neutral.textMuted,
    fontWeight: '600',
  },
});

export default LauncherScreen;
