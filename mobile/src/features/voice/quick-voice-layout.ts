export const QUICK_VOICE_LAYOUT = Object.freeze({
  minScreenWidth: 320,
  horizontalPadding: 18,
  verticalGap: 12,
  topHitHeight: 48,
  micSize: 128,
  auxiliaryHitHeight: 48,
  cancelHitHeight: 48,
});

type Bounds = Readonly<{ left: number; top: number; width: number; height: number }>;

export function quickVoiceControlBounds(screenWidth = QUICK_VOICE_LAYOUT.minScreenWidth) {
  const width = Math.max(QUICK_VOICE_LAYOUT.minScreenWidth, screenWidth) - QUICK_VOICE_LAYOUT.horizontalPadding * 2;
  const auxiliaryWidth = (width - QUICK_VOICE_LAYOUT.verticalGap) / 2;
  const primaryTop = QUICK_VOICE_LAYOUT.topHitHeight + QUICK_VOICE_LAYOUT.verticalGap;
  const auxiliaryTop = primaryTop + QUICK_VOICE_LAYOUT.micSize + QUICK_VOICE_LAYOUT.verticalGap;
  const cancelTop = auxiliaryTop + QUICK_VOICE_LAYOUT.auxiliaryHitHeight + QUICK_VOICE_LAYOUT.verticalGap;
  return Object.freeze({
    top: Object.freeze({ left: 0, top: 0, width, height: QUICK_VOICE_LAYOUT.topHitHeight }),
    mic: Object.freeze({ left: (width - QUICK_VOICE_LAYOUT.micSize) / 2, top: primaryTop, width: QUICK_VOICE_LAYOUT.micSize, height: QUICK_VOICE_LAYOUT.micSize }),
    left: Object.freeze({ left: 0, top: auxiliaryTop, width: auxiliaryWidth, height: QUICK_VOICE_LAYOUT.auxiliaryHitHeight }),
    right: Object.freeze({ left: auxiliaryWidth + QUICK_VOICE_LAYOUT.verticalGap, top: auxiliaryTop, width: auxiliaryWidth, height: QUICK_VOICE_LAYOUT.auxiliaryHitHeight }),
    cancel: Object.freeze({ left: 0, top: cancelTop, width, height: QUICK_VOICE_LAYOUT.cancelHitHeight }),
  });
}

export function quickVoiceBoundsOverlap(left: Bounds, right: Bounds) {
  return left.left < right.left + right.width
    && right.left < left.left + left.width
    && left.top < right.top + right.height
    && right.top < left.top + left.height;
}
