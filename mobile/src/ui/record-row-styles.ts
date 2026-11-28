import { mobileTheme } from './theme';

// Shared with the existing 메모 · 참고 row.
export const recordRowStyles = {
  complete: { minHeight: 48, minWidth: 60, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#111827' },
  completeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  inlineEdit: { minHeight: 48, minWidth: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db' },
  inlineEditText: { fontSize: 18 },
  inlineDelete: { minHeight: 48, minWidth: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#fff7f7', borderWidth: 1, borderColor: '#fecaca' },
  inlineDeleteText: { color: mobileTheme.colors.danger, fontSize: 12, fontWeight: '900' },
  taskTitle: { fontSize: 15, fontWeight: '700', color: '#30343b', lineHeight: 21 },
  taskMeta: { fontSize: 13, color: mobileTheme.colors.textMuted, lineHeight: 18 },
} as const;
