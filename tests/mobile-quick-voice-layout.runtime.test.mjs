import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const layout = await import('../mobile/src/features/voice/quick-voice-layout.ts');

test('Quick Voice keeps top, center, left, right, and cancel visual/touch bounds disjoint at the 320dp Android floor', () => {
  const bounds = layout.quickVoiceControlBounds(320);
  const entries = Object.entries(bounds);
  for (let index = 0; index < entries.length; index += 1) {
    for (let other = index + 1; other < entries.length; other += 1) {
      assert.equal(layout.quickVoiceBoundsOverlap(entries[index][1], entries[other][1]), false, `${entries[index][0]} must not overlap ${entries[other][0]}`);
    }
  }
  assert.equal(bounds.mic.width, layout.QUICK_VOICE_LAYOUT.micSize);
  assert.equal(bounds.left.height, 48);
  assert.equal(bounds.right.height, 48);
  assert.equal(bounds.cancel.height, 48);
});

test('Quick Voice remains non-overlapping above the Android floor', () => {
  const bounds = layout.quickVoiceControlBounds(480);
  assert.equal(layout.quickVoiceBoundsOverlap(bounds.left, bounds.right), false);
  assert.equal(layout.quickVoiceBoundsOverlap(bounds.top, bounds.mic), false);
  assert.equal(layout.quickVoiceBoundsOverlap(bounds.mic, bounds.cancel), false);
});
