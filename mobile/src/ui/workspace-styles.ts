import { mobileTheme } from './theme';

/** Home and Work share these values; change the common styles, not tab copies. */
export const workspaceStyles = {
  card: { padding: 14, gap: 6, borderRadius: 20, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.surface },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '800', color: '#1f2937' },
  refresh: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  link: { color: '#275daf', fontWeight: '800', padding: 8 },
  filter: { minHeight: 44, justifyContent: 'center', padding: 10, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12 },
  filterActive: { backgroundColor: mobileTheme.colors.selectionBackground, borderColor: mobileTheme.colors.link },
  empty: { color: mobileTheme.colors.textMuted, lineHeight: 20, paddingVertical: 4 },
} as const;
