import { captureInbox, captureImportState } from './capture-runtime';
import { importPickedCaptureImage, removeCaptureImage } from './capture-files';
import { pickCaptureImage } from './capture-gallery-picker';

export async function importCaptureFromGallery(owner: string, isCurrent: () => boolean, open: (hash: string) => void) {
  if (captureImportState.galleryActive) return;
  captureImportState.galleryActive = true;
  try {
    const uri = await pickCaptureImage();
    if (!uri) return;
    const image = await importPickedCaptureImage(uri);
    let entry;
    try { entry = await captureInbox.receive(image, owner); }
    catch (error) { await removeCaptureImage(image.uri).catch(() => undefined); throw error; }
    if (entry.uri !== image.uri) await removeCaptureImage(image.uri);
    if (isCurrent()) open(entry.hash);
  } finally { captureImportState.galleryActive = false; }
}
