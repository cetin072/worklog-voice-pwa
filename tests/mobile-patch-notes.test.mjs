import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appShellSource = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const patchNotesSource = fs.readFileSync('mobile/src/features/settings/patch-notes.ts', 'utf8');

test('Mobile settings opens user-facing release notes from the shared completed-release source', () => {
  assert.match(appShellSource, /MOBILE_PATCH_NOTES/);
  assert.match(appShellSource, /업데이트·패치노트/);
  assert.match(appShellSource, /screen === 'patchNotes'/);
  assert.match(appShellSource, /MOBILE_PATCH_NOTES\.slice\(0, patchNotesExpanded \? undefined : 3\)\.map/);
  assert.match(appShellSource, /이전 업데이트.*건 더 보기/);
  assert.match(appShellSource, /setPatchNotesExpanded\(value => !value\)/);
  assert.match(patchNotesSource, /already merged to main/);
  assert.match(patchNotesSource, /Development-only notes live in \.patch-notes/);
});
