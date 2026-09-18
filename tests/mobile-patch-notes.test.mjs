import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appShellSource = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const patchNotesSource = fs.readFileSync('mobile/src/features/settings/patch-notes.ts', 'utf8');

test('Mobile settings opens user-facing release notes from the shared completed-release source', () => {
  assert.match(appShellSource, /MOBILE_PATCH_NOTES/);
  assert.match(appShellSource, /업데이트·패치노트/);
  assert.match(appShellSource, /screen === 'patchNotes'/);
  assert.match(appShellSource, /MOBILE_PATCH_NOTES\.map/);
  assert.match(patchNotesSource, /already merged to main/);
  assert.match(patchNotesSource, /Development-only notes live in \.patch-notes/);
});
