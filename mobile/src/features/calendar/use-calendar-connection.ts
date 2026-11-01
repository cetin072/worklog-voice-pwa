import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { usePlatform } from '../../providers/platform-provider';
import { calendarConnection } from './calendar-service';

export function useCalendarConnection() {
  const platform = usePlatform();
  const connection = platform.config && platform.session
    ? calendarConnection(platform.config, platform.session.user.id) : null;
  const [, redraw] = useState(0);
  useEffect(() => {
    const update = () => redraw(value => value + 1);
    const unsubscribe = connection?.subscribe(update);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') update(); });
    // Also read completion which may have happened before this screen mounted.
    update();
    return () => { unsubscribe?.(); listener.remove(); };
  }, [connection]);
  return connection;
}
