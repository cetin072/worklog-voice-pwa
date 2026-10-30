import { Image } from 'react-native';
import * as Legacy from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

const root = `${Legacy.documentDirectory}capture-inbox/`;
export async function importCaptureImage(uri: string) {
  if (!Legacy.documentDirectory || !/^(content|file):\/\//.test(uri)) throw new Error('CAPTURE_INVALID_URI');
  await Legacy.makeDirectoryAsync(root, { intermediates: true });
  const temporary = `${root}${Crypto.randomUUID()}.image`;
  try {
    await Legacy.copyAsync({ from: uri, to: temporary });
    const file = new File(temporary);
    if (!file.exists || file.size <= 0 || file.size > 12 * 1024 * 1024) throw new Error('CAPTURE_IMAGE_SIZE');
    const size = await new Promise<{ width: number; height: number }>((resolve,reject) => Image.getSize(temporary, (width,height) => resolve({width,height}), reject));
    if (size.width * size.height > 24_000_000) throw new Error('CAPTURE_IMAGE_DIMENSIONS');
    const hash = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes()))).map(x => x.toString(16).padStart(2,'0')).join('');
    return { hash, uri: temporary };
  } catch (error) { await Legacy.deleteAsync(temporary, { idempotent: true }).catch(() => undefined); throw error; }
}
export async function removeCaptureImage(uri: string) {
  if (!uri.startsWith(root)) throw new Error('CAPTURE_UNOWNED_FILE');
  await Legacy.deleteAsync(uri, { idempotent: true });
}
