import { useEffect, useRef } from 'react';
import { AppState, Platform, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { getSharedPayloads, clearSharedPayloads } from 'expo-sharing';
import { usePlatform } from '@/src/providers/platform-provider';
import { captureInbox } from './capture-runtime';
import { importCaptureImage, removeCaptureImage } from './capture-files';

/** Receive immediately, including before login. Share bytes never leave the sandbox. */
export function CaptureShareGate() {
  const { session } = usePlatform();
  const router = useRouter();
  const owner = useRef(session?.user.id || null);
  owner.current = session?.user.id || null;
  const processing = useRef(false);
  const queued = useRef(false);
  const resume = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let alive = true;
    async function receive() {
      if (processing.current) { queued.current = true; return; }
      processing.current = true;
      try {
        const payloads = getSharedPayloads();
        if (payloads.length) {
          // Unsupported input stays on the result route, never silently discarded.
          if (payloads.length !== 1 || !payloads[0].mimeType?.startsWith('image/') || !/^(file|content):\/\//.test(payloads[0].value)) {
            if (alive) router.replace({ pathname: '/capture', params: { error: 'unsupported' } }); return;
          }
          const account = owner.current;
          const image = await importCaptureImage(payloads[0].value);
          const entry = await captureInbox.receive(image, account);
          if (entry.uri !== image.uri) await removeCaptureImage(image.uri);
          const current = getSharedPayloads();
          if (current.length === 1 && current[0].value === payloads[0].value) clearSharedPayloads();
          else queued.current = true;
          if (alive && account === owner.current) router.replace({ pathname: '/capture', params: { hash: entry.hash } });
          return;
        }
        const pending = await captureInbox.pending(owner.current) || await captureInbox.pending(null);
        if (alive && pending) router.replace({ pathname: '/capture', params: { hash: pending.hash } });
      } catch {
        if (alive) router.replace({ pathname: '/capture', params: { error: 'receive' } });
      } finally { processing.current = false; if (queued.current && resume.current) { queued.current = false; resume.current(); } }
    }
    const run = () => { void receive(); };
    resume.current = run;
    run();
    const link = Linking.addEventListener('url', event => {
      try { if (new URL(event.url).hostname === 'expo-sharing') void receive(); } catch { /* Not an incoming share. */ }
    });
    const sub = AppState.addEventListener('change', value => { if (value === 'active') void receive(); });
    return () => { alive = false; if (resume.current === run) resume.current = null; sub.remove(); link.remove(); };
  }, [router, session?.user.id]);
  return null;
}
