/** Provider contract isolates ML Kit types/imports from UI and input policy. */
export type CaptureOcr = (localUri: string) => Promise<string>;
export const recognizeCapture: CaptureOcr = async localUri => {
  if (!localUri.startsWith('file://')) throw new Error('CAPTURE_LOCAL_FILE_REQUIRED');
  const provider = await import('rn-mlkit-ocr');
  const result = await provider.recognizeText(localUri, 'korean');
  // Preserve line structure for chat date/timestamp separation.
  return result.blocks.flatMap(block => block.lines.map(line => line.text)).join('\n').trim();
};
