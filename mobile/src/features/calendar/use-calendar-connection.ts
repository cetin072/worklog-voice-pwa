import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { usePlatform } from '../../providers/platform-provider';
import { calendarConnection } from './calendar-service';

export function useCalendarConnection() {
  const platform = usePlatform();
  const connection = platform.config && platform.session
    ? calendarConnection(platform.config, platform.session.user.id, async () => {
      const { data } = await platform.client!.auth.getSession();
      return data.session?.user.id === platform.session!.user.id ? data.session.access_token : '';
    }) : null;
  const [, redraw] = useState(0);
  useEffect(() => {
    const update = () => redraw(value => value + 1);
    const unsubscribe = connection?.subscribe(update);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') { void connection?.ensureReady().catch(() => undefined); update(); } });
    // Also read completion which may have happened before this screen mounted.
    void connection?.restore().then(() => connection.ensureReady()).catch(() => undefined);
    update();
    return () => { unsubscribe?.(); listener.remove(); };
  }, [connection]);
  return connection;
}
