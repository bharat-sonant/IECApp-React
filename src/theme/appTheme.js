import { StyleSheet } from 'react-native';

export const colors = {
  brand: {
    primary: '#123B4A',
    primaryDark: '#081E26',
    secondary: '#1E5A6B',
    accent: '#E89B00',
    softTint: 'rgba(18, 59, 74, 0.08)',
    softTintBorder: 'rgba(18, 59, 74, 0.18)',
  },
  neutral: {
    background: '#E9EEF2',
    surface: '#ffffff',
    text: '#0B1F2A',
    textMuted: '#4D6475',
    border: '#B9C7D1',
  },
  status: {
    success: '#167A45',
    warning: '#C77D00',
    danger: '#B42318',
  },
};

const { brand, neutral } = colors;

const appTheme = {
  colors,
  styles: StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: neutral.background,
    },
    header: {
      backgroundColor: brand.primary,
      paddingTop: 18,
      paddingHorizontal: 20,
      paddingBottom: 18,
    },
    title: {
      color: brand.accent,
      fontSize: 24,
      fontWeight: '800',
    },
    subtitle: {
      color: 'rgba(255,255,255,0.92)',
      fontSize: 14,
      marginTop: 4,
    },
    card: {
      backgroundColor: neutral.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: neutral.border,
      padding: 16,
      marginBottom: 14,
    },
    cardTitle: {
      color: neutral.text,
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 6,
    },
    cardText: {
      color: neutral.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    button: {
      backgroundColor: brand.primary,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonText: {
      color: brand.accent,
      fontSize: 15,
      fontWeight: '700',
    },
  }),
};

export default appTheme;
