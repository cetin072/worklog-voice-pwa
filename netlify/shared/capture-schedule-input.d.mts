export type CaptureDecision = { kind: 'schedule' | 'review'; reviewContentTitle?: boolean; title: string; date: string; time: string; startsAt?: string; description: string; reason: string; transcript: string; status: string; followUp: string };
export function captureScheduleInput(ocr: string, now?: string): CaptureDecision;
