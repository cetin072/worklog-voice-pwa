import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homeHarness } from './helpers/mobile-home-harness.mjs';
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');

// Run the actual home JSX through React reconciliation, not the static tree
// expander. Native/network boundaries are stubs; this is not a device test.
test('home count updates retain calendar and folder instances; account changes reset both', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let calendarMounts = 0, folderMounts = 0;
  function Calendar() {
    React.useEffect(() => { calendarMounts++; }, []);
    return React.createElement('calendar');
  }
  function Folders() {
    React.useEffect(() => { folderMounts++; }, []);
    return React.createElement('folders');
  }
  const h = homeHarness({
    React, HomeCalendar: Calendar, WorkFolders: Folders,
    CaptureImportButton: () => null, CalendarExportPreview: () => null,
    ScheduleReminderLabel: () => null, CompactReminderLabel: () => null,
    client: {}, config: { dataSchema: 'worklog' },
    briefing: { today: '2026-11-17' },
    structure: { today: [], overdue: [], upcoming: [], undated: [] }, briefingBuckets: [],
  });
  let tree;
  try {
    await act(() => { tree = create(h.element()); });
    for (const count of [6, null, 6, 7]) {
      await act(() => { h.context.homeScheduleCount = count; tree.update(h.element()); });
    }
    assert.equal(calendarMounts, 1, 'count feedback must not remount and refetch the calendar');
    assert.equal(folderMounts, 1);
    await act(() => { h.context.session = { user: { id: 'another-owner' } }; tree.update(h.element()); });
    assert.equal(calendarMounts, 2, 'a different account must start a fresh calendar');
    assert.equal(folderMounts, 2);
  } finally {
    if (tree) await act(() => tree.unmount());
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
