import { mobileTheme } from './theme';

// Shared with the existing 메모 · 참고 row.
export const recordRowStyles = {
  inlineEdit: { minHeight: 48, minWidth: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db' },
  inlineEditText: { fontSize: 18 },
  inlineDelete: { minHeight: 48, minWidth: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#fff7f7', borderWidth: 1, borderColor: '#fecaca' },
  inlineDeleteText: { color: mobileTheme.colors.danger, fontSize: 12, fontWeight: '900' },
  taskTitle: { fontSize: 15, fontWeight: '700', color: '#30343b', lineHeight: 21 },
  taskMeta: { fontSize: 13, color: '#737985', lineHeight: 18 },
} as const;
