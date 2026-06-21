export const colors = {
  primary: '#2563EB',
  primaryLight: '#DBEAFE',
  primaryDark: '#1D4ED8',
  success: '#16A34A',
  successLight: '#DCFCE7',
  warning: '#D97706',
  warningLight: '#FEF3C7',
  error: '#DC2626',
  errorLight: '#FEE2E2',
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  full: 9999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 32,
  hero: 48,
} as const;

// Map PackageStatus enum to display color + label
export const statusConfig = {
  RECIBIDO: { color: colors.primary, bg: colors.primaryLight, label: 'Recibido' },
  NOTIFICADO: { color: colors.warning, bg: colors.warningLight, label: 'Notificado' },
  ENTREGADO: { color: colors.success, bg: colors.successLight, label: 'Entregado' },
  DEVUELTO: { color: colors.gray600, bg: colors.gray100, label: 'Devuelto' },
  EXPIRADO: { color: colors.error, bg: colors.errorLight, label: 'Expirado' },
} as const;
