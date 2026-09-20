export type QuickVoiceCaptureCancellation = Readonly<{
  stopCapture(): Promise<void>;
  disableRecordingMode(): Promise<void>;
  discardCapturedAudio(): void;
}>;

/** Stops device capture and always restores the local Quick Voice state. */
export async function cancelQuickVoiceCapture(input: QuickVoiceCaptureCancellation) {
  let failure: unknown = null;
  try {
    await input.stopCapture();
  } catch (error) {
    failure = error;
  }
  try {
    await input.disableRecordingMode();
  } catch (error) {
    failure ||= error;
  } finally {
    input.discardCapturedAudio();
  }
  if (failure) throw failure;
}
