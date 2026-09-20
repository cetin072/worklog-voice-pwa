export const QUICK_VOICE_LAYOUT = Object.freeze({
  minScreenWidth: 320,
  horizontalPadding: 18,
  verticalGap: 12,
  horizontalGap: 10,
  topHitHeight: 48,
  micSize: 128,
  auxiliaryHitHeight: 48,
  auxiliaryMinWidth: 48,
  cancelHitHeight: 48,
});

type Bounds = Readonly<{ left: number; top: number; width: number; height: number }>;

export function quickVoiceControlBounds(screenWidth = QUICK_VOICE_LAYOUT.minScreenWidth) {
  const width = Math.max(QUICK_VOICE_LAYOUT.minScreenWidth, screenWidth) - QUICK_VOICE_LAYOUT.horizontalPadding * 2;
  const availableForSides = width - QUICK_VOICE_LAYOUT.micSize - QUICK_VOICE_LAYOUT.horizontalGap * 2;
  const auxiliaryWidth = availableForSides / 2;
  if (auxiliaryWidth < QUICK_VOICE_LAYOUT.auxiliaryMinWidth) {
    throw new Error('Quick Voice 주변 컨트롤을 안전하게 배치할 화면 너비가 부족합니다.');
  }

  const orbitTop = QUICK_VOICE_LAYOUT.topHitHeight + QUICK_VOICE_LAYOUT.verticalGap;
  const auxiliaryTop = orbitTop + (QUICK_VOICE_LAYOUT.micSize - QUICK_VOICE_LAYOUT.auxiliaryHitHeight) / 2;
  const micLeft = auxiliaryWidth + QUICK_VOICE_LAYOUT.horizontalGap;
  const rightLeft = micLeft + QUICK_VOICE_LAYOUT.micSize + QUICK_VOICE_LAYOUT.horizontalGap;
  const cancelTop = orbitTop + QUICK_VOICE_LAYOUT.micSize + QUICK_VOICE_LAYOUT.verticalGap;

  return Object.freeze({
    top: Object.freeze({ left: 0, top: 0, width, height: QUICK_VOICE_LAYOUT.topHitHeight }),
    left: Object.freeze({ left: 0, top: auxiliaryTop, width: auxiliaryWidth, height: QUICK_VOICE_LAYOUT.auxiliaryHitHeight }),
    mic: Object.freeze({ left: micLeft, top: orbitTop, width: QUICK_VOICE_LAYOUT.micSize, height: QUICK_VOICE_LAYOUT.micSize }),
    right: Object.freeze({ left: rightLeft, top: auxiliaryTop, width: auxiliaryWidth, height: QUICK_VOICE_LAYOUT.auxiliaryHitHeight }),
    cancel: Object.freeze({ left: 0, top: cancelTop, width, height: QUICK_VOICE_LAYOUT.cancelHitHeight }),
  });
}

export function quickVoiceBoundsOverlap(left: Bounds, right: Bounds) {
  return left.left < right.left + right.width
    && right.left < left.left + left.width
    && left.top < right.top + right.height
    && right.top < left.top + left.height;
}
