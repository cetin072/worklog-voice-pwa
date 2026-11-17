import type { Config } from '@netlify/functions';
import { createGoogleRefreshHandler } from '../shared/calendar/google-refresh.mjs';
export default createGoogleRefreshHandler({ env: (name: string) => Netlify.env.get(name) });
export const config: Config = { path: '/api/google-calendar-refresh', method: ['POST'] };
