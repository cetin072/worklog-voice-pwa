import { launchImageLibraryAsync } from 'expo-image-picker';

/** Provider boundary: Android system photo picker, single image, original bytes. */
export async function pickCaptureImage(): Promise<string | null> {
  const result = await launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false, quality: 1, base64: false, exif: false });
  if (result.canceled) return null;
  if (result.assets.length !== 1 || result.assets[0].type !== 'image') throw new Error('CAPTURE_SINGLE_IMAGE_REQUIRED');
  return result.assets[0].uri;
}
