/**
 * Product tokens shared by the native Home, voice dock, and schedule settings.
 * Values intentionally preserve the current 업무수첩 visual language instead of
 * creating a separate mobile palette.
 */
export const mobileTheme = {
  colors: {
    background: '#f4f5f7',
    surface: '#ffffff',
    text: '#17191d',
    textSecondary: '#4b515c',
    textMuted: '#737985',
    border: '#d7dae0',
    borderSubtle: '#eceef1',
    primary: '#111827',
    primaryText: '#ffffff',
    link: '#275daf',
    danger: '#b42318',
    success: '#245c2a',
    warning: '#9a6700',
    overdueBackground: '#fff7ed',
    overdueBorder: '#fed7aa',
    todayBackground: '#fffbeb',
    todayBorder: '#fde68a',
    upcomingBackground: '#eff6ff',
    upcomingBorder: '#bfdbfe',
    neutralBackground: '#f9fafb',
    neutralBorder: '#d1d5db',
  },
  radius: {
    card: 20,
    control: 12,
    compact: 10,
    pill: 999,
  },
  spacing: {
    page: 20,
    card: 20,
    section: 16,
    control: 12,
    compact: 8,
  },
  size: {
    touchTarget: 46,
    input: 48,
  },
} as const;
