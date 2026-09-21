export const QUICK_VOICE_LAYOUT = Object.freeze({
  minScreenWidth: 320,
  dockWidth: 292,
  dockHeight: 196,
  dockReserveHeight: 208,
  micSize: 116,
  sideActionSize: 56,
  timerSize: 48,
  sideActionBottom: 30,
});

type Bounds = Readonly<{ left: number; top: number; width: number; height: number }>;

/** Geometry of the only touchable controls inside the bottom floating overlay. */
export function quickVoiceDockBounds(screenWidth = QUICK_VOICE_LAYOUT.minScreenWidth) {
  const viewportWidth = Math.max(QUICK_VOICE_LAYOUT.minScreenWidth, screenWidth);
  const width = Math.min(QUICK_VOICE_LAYOUT.dockWidth, viewportWidth);
  const dockLeft = (viewportWidth - width) / 2;
  const micLeft = dockLeft + (width - QUICK_VOICE_LAYOUT.micSize) / 2;
  const micTop = QUICK_VOICE_LAYOUT.dockHeight - QUICK_VOICE_LAYOUT.micSize;
  const sideTop = QUICK_VOICE_LAYOUT.dockHeight - QUICK_VOICE_LAYOUT.sideActionBottom - QUICK_VOICE_LAYOUT.sideActionSize;
  return Object.freeze({
    dock: Object.freeze({ left: dockLeft, top: 0, width, height: QUICK_VOICE_LAYOUT.dockHeight }),
    timer: Object.freeze({ left: dockLeft + (width - QUICK_VOICE_LAYOUT.timerSize) / 2, top: 0, width: QUICK_VOICE_LAYOUT.timerSize, height: QUICK_VOICE_LAYOUT.timerSize }),
    left: Object.freeze({ left: dockLeft, top: sideTop, width: QUICK_VOICE_LAYOUT.sideActionSize, height: QUICK_VOICE_LAYOUT.sideActionSize }),
    mic: Object.freeze({ left: micLeft, top: micTop, width: QUICK_VOICE_LAYOUT.micSize, height: QUICK_VOICE_LAYOUT.micSize }),
    right: Object.freeze({ left: dockLeft + width - QUICK_VOICE_LAYOUT.sideActionSize, top: sideTop, width: QUICK_VOICE_LAYOUT.sideActionSize, height: QUICK_VOICE_LAYOUT.sideActionSize }),
  });
}

/** @deprecated Kept as a stable import name for existing callers during the UI migration. */
export const quickVoiceControlBounds = quickVoiceDockBounds;

export function quickVoiceBoundsOverlap(left: Bounds, right: Bounds) {
  return left.left < right.left + right.width
    && right.left < left.left + left.width
    && left.top < right.top + right.height
    && right.top < left.top + left.height;
}
