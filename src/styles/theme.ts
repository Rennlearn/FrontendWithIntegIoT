export const lightTheme = {
  primary: '#4A90E2',
  secondary: '#D14A99',
  background: '#F3F4F6',
  card: '#FFFFFF',
  text: '#333333',
  textSecondary: '#666666',
  border: '#E4E7EB',
  error: '#E57373',
  success: '#4CAF50',
  warning: '#FFC107',
  info: '#2196F3',
  elevation: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
};

export const darkTheme = {
  primary: '#60A5FA',
  secondary: '#EC4899',
  background: '#111827',
  card: '#1F2937',
  text: '#F3F4F6',
  textSecondary: '#9CA3AF',
  border: '#374151',
  error: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',
  info: '#3B82F6',
  elevation: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
};

const theme = {
  light: lightTheme,
  dark: darkTheme,
};

export default theme;