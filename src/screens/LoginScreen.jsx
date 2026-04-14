import React, {useMemo, useState} from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import appTheme from '../theme/appTheme';

const LoginScreen = ({navigation}) => {
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});

  const cardWidth = useMemo(() => {
    const maxWidth = 460;
    const sidePadding = Math.max(20, width * 0.06);
    return Math.min(width - sidePadding * 2, maxWidth);
  }, [width]);

  const logoSize = useMemo(() => {
    if (width < 360 || height < 700) {
      return 54;
    }
    if (width < 420) {
      return 62;
    }
    return 70;
  }, [width, height]);

  const kickerStyle = useMemo(
    () => [styles.kicker, {fontSize: width < 360 ? 11 : 12}],
    [width],
  );
  const titleStyle = useMemo(
    () => [styles.title, {fontSize: width < 360 ? 26 : 30, lineHeight: (width < 360 ? 26 : 30) + 8}],
    [width],
  );
  const subtitleStyle = useMemo(
    () => [styles.subtitle, {fontSize: width < 360 ? 13 : 14, lineHeight: (width < 360 ? 13 : 14) + 8}],
    [width],
  );
  const fieldHeight = width < 360 ? 50 : 54;

  const canSubmit = username.trim().length > 0 && password.trim().length > 0;

  const handleLogin = () => {
    const nextErrors = {};

    if (!username.trim()) {
      nextErrors.username = 'Username is required.';
    }

    if (!password.trim()) {
      nextErrors.password = 'Password is required.';
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    navigation.replace('Dashboard');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={appTheme.colors.neutral.background} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            styles.screen,
            {
              paddingTop: insets.top + 16,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View style={styles.backgroundAccentOne} />
          <View style={styles.backgroundAccentTwo} />

          <View style={styles.headerWrap}>
            <View style={[styles.logoFrame, {width: logoSize + 24, height: logoSize + 24}]}>
              <Image
                source={require('../assets/images/AppLogo.png')}
                resizeMode="contain"
                style={{width: logoSize, height: logoSize}}
              />
            </View>

            <Text style={kickerStyle}>Employee Portal</Text>
            <Text style={titleStyle}>Sign in to continue</Text>
            <Text style={subtitleStyle}>
              Use your username and password to access the app.
            </Text>
          </View>

          <View style={[styles.panel, {width: cardWidth}]}>
            <Text style={styles.panelLabel}>Login</Text>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldTitle}>Username</Text>
              <View style={[styles.inputShell, {minHeight: fieldHeight}]}>
                <MaterialCommunityIcons
                  name="account-outline"
                  size={19}
                  color={appTheme.colors.neutral.textMuted}
                  style={styles.leftIcon}
                />
                <TextInput
                  value={username}
                  onChangeText={text => {
                    setUsername(text);
                    if (errors.username) {
                      setErrors(prev => ({...prev, username: ''}));
                    }
                  }}
                  placeholder="Enter username"
                  placeholderTextColor={appTheme.colors.neutral.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  style={styles.input}
                />
              </View>
              {!!errors.username && <Text style={styles.errorText}>{errors.username}</Text>}
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldTitle}>Password</Text>
              <View style={[styles.inputShell, {minHeight: fieldHeight}]}>
                <MaterialCommunityIcons
                  name="lock-outline"
                  size={19}
                  color={appTheme.colors.neutral.textMuted}
                  style={styles.leftIcon}
                />
                <TextInput
                  value={password}
                  onChangeText={text => {
                    setPassword(text);
                    if (errors.password) {
                      setErrors(prev => ({...prev, password: ''}));
                    }
                  }}
                  placeholder="Enter password"
                  placeholderTextColor={appTheme.colors.neutral.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  style={styles.input}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  onPress={() => setShowPassword(prev => !prev)}
                  hitSlop={10}
                  style={styles.eyeButton}
                >
                  <MaterialCommunityIcons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={19}
                    color={appTheme.colors.neutral.textMuted}
                  />
                </Pressable>
              </View>
              {!!errors.password && <Text style={styles.errorText}>{errors.password}</Text>}
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={handleLogin}
              style={({pressed}) => [
                styles.loginBtn,
                !canSubmit && styles.loginBtnDisabled,
                pressed && canSubmit && styles.loginBtnPressed,
              ]}
            >
              <MaterialCommunityIcons
                name="login-variant"
                size={19}
                color={canSubmit ? appTheme.colors.brand.accent : 'rgba(255,255,255,0.65)'}
              />
              <Text style={[styles.loginBtnText, !canSubmit && styles.loginBtnTextDisabled]}>
                Login
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: appTheme.colors.neutral.background,
  },
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: appTheme.colors.neutral.background,
  },
  backgroundAccentOne: {
    position: 'absolute',
    top: -90,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(18, 59, 74, 0.07)',
  },
  backgroundAccentTwo: {
    position: 'absolute',
    bottom: -110,
    left: -70,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(232, 155, 0, 0.09)',
  },
  headerWrap: {
    alignItems: 'center',
    marginBottom: 18,
  },
  logoFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    marginBottom: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.8)',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 8},
    elevation: 5,
  },
  kicker: {
    fontWeight: '800',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: appTheme.colors.brand.secondary,
    marginBottom: 6,
    textAlign: 'center',
  },
  title: {
    fontWeight: '800',
    color: appTheme.colors.neutral.text,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 8,
    maxWidth: 320,
    color: appTheme.colors.neutral.textMuted,
    textAlign: 'center',
  },
  panel: {
    backgroundColor: 'rgba(255,255,255,0.84)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(185, 199, 209, 0.75)',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: {width: 0, height: 10},
    elevation: 5,
  },
  panelLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: appTheme.colors.brand.secondary,
    marginBottom: 14,
  },
  fieldBlock: {
    marginBottom: 12,
  },
  fieldTitle: {
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: appTheme.colors.neutral.text,
  },
  inputShell: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: appTheme.colors.neutral.border,
    backgroundColor: '#FAFBFC',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  leftIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: appTheme.colors.neutral.text,
    fontSize: 15,
    paddingVertical: 0,
  },
  eyeButton: {
    paddingLeft: 8,
    paddingVertical: 6,
  },
  loginBtn: {
    minHeight: 52,
    marginTop: 6,
    borderRadius: 16,
    backgroundColor: appTheme.colors.brand.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  loginBtnPressed: {
    opacity: 0.92,
    transform: [{scale: 0.99}],
  },
  loginBtnDisabled: {
    opacity: 0.55,
  },
  loginBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  loginBtnTextDisabled: {
    color: 'rgba(255,255,255,0.75)',
  },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    color: '#CC4B4B',
    fontWeight: '600',
  },
});

export default LoginScreen;
