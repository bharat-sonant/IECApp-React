import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import appTheme from '../theme/appTheme';
import {
  getPendingMediaUploadsCount,
  subscribePendingMediaQueue,
} from '../services/pendingUploadService';

const PendingUploadIndicator = ({ style }) => {
  const [count, setCount] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;
  const arrow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let isMounted = true;

    const refresh = async () => {
      try {
        const c = await getPendingMediaUploadsCount();
        if (isMounted) {
          setCount(c);
        }
      } catch {
        // Ignore
      }
    };

    refresh();

    const unsubscribe = subscribePendingMediaQueue(c => {
      if (isMounted) {
        setCount(Number(c) || 0);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!count) {
      return undefined;
    }
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const arrowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(arrow, {
          toValue: 1,
          duration: 1100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(arrow, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    pulseLoop.start();
    arrowLoop.start();
    return () => {
      pulseLoop.stop();
      arrowLoop.stop();
      pulse.setValue(0);
      arrow.setValue(0);
    };
  }, [count, pulse, arrow]);

  if (!count) {
    return null;
  }

  const arrowTranslate = arrow.interpolate({
    inputRange: [0, 1],
    outputRange: [2, -2],
  });
  const arrowOpacity = arrow.interpolate({
    inputRange: [0, 0.2, 0.8, 1],
    outputRange: [0, 1, 1, 0],
  });
  const dotOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons
          name="cloud-outline"
          size={11}
          color={appTheme.colors.brand.primary}
        />
        <Animated.View
          style={{
            position: 'absolute',
            transform: [{ translateY: arrowTranslate }],
            opacity: arrowOpacity,
          }}
        >
          <MaterialCommunityIcons
            name="arrow-up"
            size={7}
            color={appTheme.colors.brand.primary}
          />
        </Animated.View>
      </View>
      <Text style={styles.count}>{count}</Text>
      <Text style={styles.label}>Uploading</Text>
      <Animated.View style={[styles.dot, { opacity: dotOpacity }]} />
    </View>
  );
};

const CHIP_HEIGHT = 24;
const ICON_SIZE = 18;

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: CHIP_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(18, 59, 74, 0.14)',
    borderWidth: 1,
    paddingLeft: 3,
    paddingRight: 9,
    borderRadius: CHIP_HEIGHT / 2,
    gap: 5,
    alignSelf: 'center',
  },
  iconWrap: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18, 59, 74, 0.08)',
    overflow: 'hidden',
  },
  count: {
    fontSize: 11,
    fontWeight: '800',
    color: appTheme.colors.brand.primary,
    letterSpacing: 0.2,
    lineHeight: 14,
    includeFontPadding: false,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: appTheme.colors.neutral.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    lineHeight: 12,
    includeFontPadding: false,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: appTheme.colors.brand.accent,
    marginLeft: 1,
  },
});

export default PendingUploadIndicator;
