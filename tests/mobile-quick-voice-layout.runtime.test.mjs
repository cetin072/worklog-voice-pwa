import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const layout = await import('../mobile/src/features/voice/quick-voice-layout.ts');

function assertDisjoint(bounds) {
  const entries = Object.entries(bounds).filter(([name]) => name !== 'dock');
  for (let index = 0; index < entries.length; index += 1) {
    for (let other = index + 1; other < entries.length; other += 1) {
      assert.equal(layout.quickVoiceBoundsOverlap(entries[index][1], entries[other][1]), false, `${entries[index][0]} must not overlap ${entries[other][0]}`);
    }
  }
}

test('Quick Voice is a compact floating dock with disjoint touch targets at the 320dp Android floor', () => {
  const bounds = layout.quickVoiceDockBounds(320);
  assertDisjoint(bounds);

  assert.equal(bounds.mic.width, layout.QUICK_VOICE_LAYOUT.micSize);
  assert.equal(bounds.left.width, layout.QUICK_VOICE_LAYOUT.sideActionSize);
  assert.equal(bounds.right.width, layout.QUICK_VOICE_LAYOUT.sideActionSize);
  assert.equal(bounds.timer.height, layout.QUICK_VOICE_LAYOUT.timerSize);
  assert.ok(bounds.dock.height <= 200, 'the dock does not consume a large in-flow Home region');
  assert.ok(bounds.left.left + bounds.left.width < bounds.mic.left, 'left control stays clear of the mic');
  assert.ok(bounds.mic.left + bounds.mic.width < bounds.right.left, 'right control stays clear of the mic');
  assert.ok(bounds.timer.top + bounds.timer.height < bounds.mic.top, 'timer stays above the mic');
  assert.equal(bounds.left.top, bounds.right.top, 'side controls share one visual row');
  assert.ok(bounds.left.top > bounds.mic.top, 'side controls remain vertically centered beside the mic');
  assert.ok(bounds.left.top + bounds.left.height < bounds.mic.top + bounds.mic.height, 'side controls stay inside the mic vertical span');
});

test('Quick Voice orbital layout remains non-overlapping on wider Android screens', () => {
  const bounds = layout.quickVoiceDockBounds(480);
  assertDisjoint(bounds);
  assert.ok(bounds.left.left + bounds.left.width < bounds.mic.left);
  assert.ok(bounds.mic.left + bounds.mic.width < bounds.right.left);
  assert.ok(bounds.timer.top + bounds.timer.height < bounds.mic.top);
  assert.equal(bounds.dock.left, (480 - layout.QUICK_VOICE_LAYOUT.dockWidth) / 2, 'dock remains bottom-center instead of stretching over Home');
});
