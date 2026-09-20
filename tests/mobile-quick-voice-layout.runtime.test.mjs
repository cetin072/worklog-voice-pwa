import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const layout = await import('../mobile/src/features/voice/quick-voice-layout.ts');

function assertDisjoint(bounds) {
  const entries = Object.entries(bounds);
  for (let index = 0; index < entries.length; index += 1) {
    for (let other = index + 1; other < entries.length; other += 1) {
      assert.equal(layout.quickVoiceBoundsOverlap(entries[index][1], entries[other][1]), false, `${entries[index][0]} must not overlap ${entries[other][0]}`);
    }
  }
}

test('Quick Voice surrounds the center mic with top, left, and right controls without overlap at the 320dp Android floor', () => {
  const bounds = layout.quickVoiceControlBounds(320);
  assertDisjoint(bounds);

  assert.equal(bounds.mic.width, layout.QUICK_VOICE_LAYOUT.micSize);
  assert.ok(bounds.left.width >= layout.QUICK_VOICE_LAYOUT.auxiliaryMinWidth);
  assert.ok(bounds.right.width >= layout.QUICK_VOICE_LAYOUT.auxiliaryMinWidth);
  assert.equal(bounds.left.height, layout.QUICK_VOICE_LAYOUT.auxiliaryHitHeight);
  assert.equal(bounds.right.height, layout.QUICK_VOICE_LAYOUT.auxiliaryHitHeight);
  assert.equal(bounds.cancel.height, layout.QUICK_VOICE_LAYOUT.cancelHitHeight);

  assert.ok(bounds.left.left + bounds.left.width < bounds.mic.left, 'left control stays left of the mic');
  assert.ok(bounds.mic.left + bounds.mic.width < bounds.right.left, 'right control stays right of the mic');
  assert.ok(bounds.top.top + bounds.top.height < bounds.mic.top, 'top control stays above the mic');
  assert.equal(bounds.left.top, bounds.right.top, 'side controls share one visual row');
  assert.ok(bounds.left.top > bounds.mic.top, 'side controls are vertically centered beside the larger mic');
  assert.ok(bounds.left.top + bounds.left.height < bounds.mic.top + bounds.mic.height, 'side controls remain inside the mic vertical span');
});

test('Quick Voice orbital layout remains non-overlapping on wider Android screens', () => {
  const bounds = layout.quickVoiceControlBounds(480);
  assertDisjoint(bounds);
  assert.ok(bounds.left.left + bounds.left.width < bounds.mic.left);
  assert.ok(bounds.mic.left + bounds.mic.width < bounds.right.left);
  assert.ok(bounds.top.top + bounds.top.height < bounds.mic.top);
  assert.ok(bounds.mic.top + bounds.mic.height < bounds.cancel.top);
});
