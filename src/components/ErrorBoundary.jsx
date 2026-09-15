import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import appTheme from '../theme/appTheme';
import {ERROR_CATEGORY, logError} from '../services/errorLogService';
import {restartApp} from '../services/appRestart';

/**
 * Without this, any render-time error unmounts the whole tree and the user is
 * left staring at a blank white screen with nothing logged anywhere.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {hasError: false, message: ''};
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message ? String(error.message) : 'Something went wrong.',
    };
  }

  componentDidCatch(error, info) {
    logError(ERROR_CATEGORY.RenderCrash, error, {
      screen: this.props.screenName || 'App',
      componentStack: info?.componentStack,
    });
  }

  handleRetry = () => {
    this.setState({hasError: false, message: ''});
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          The app ran into an unexpected problem. The error has been reported.
          Please try again.
        </Text>
        {!!this.state.message && (
          <Text style={styles.detail} numberOfLines={3}>
            {this.state.message}
          </Text>
        )}

        <View style={styles.buttonRow}>
          <Pressable
            style={({pressed}) => [styles.button, pressed && styles.pressed]}
            onPress={this.handleRetry}
          >
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
          <Pressable
            style={({pressed}) => [
              styles.button,
              styles.buttonSecondary,
              pressed && styles.pressed,
            ]}
            onPress={restartApp}
          >
            <Text style={[styles.buttonText, styles.buttonTextSecondary]}>
              Restart App
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appTheme.colors.neutral.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    fontSize: 19,
    fontWeight: '900',
    color: appTheme.colors.neutral.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  message: {
    fontSize: 13,
    lineHeight: 20,
    color: appTheme.colors.neutral.textMuted,
    textAlign: 'center',
  },
  detail: {
    marginTop: 14,
    fontSize: 11,
    lineHeight: 16,
    color: appTheme.colors.status.danger,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 26,
  },
  button: {
    minWidth: 120,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: appTheme.colors.brand.primaryDark,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#E9EEF2',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  buttonTextSecondary: {
    color: appTheme.colors.neutral.text,
  },
  pressed: {
    opacity: 0.92,
  },
});

export default ErrorBoundary;
