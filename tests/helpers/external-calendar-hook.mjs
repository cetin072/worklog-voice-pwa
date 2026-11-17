import { measureStartup } from '../../mobile/src/features/startup/startup-timing.ts';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as read from '../../mobile/src/features/calendar/calendar-read.ts';
const ts = createRequire(new URL('../../mobile/package.json', import.meta.url))('typescript');
export function externalCalendarHook(React, native, getConnection = () => null) {
  const code = ts.transpileModule(readFileSync('mobile/src/features/calendar/use-external-calendar.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exp = {};
  new Function('require', 'exports', code)(name => name.endsWith('/startup-timing') ? { measureStartup } : name === 'react' ? React : name === 'react-native' ? native
    : name.endsWith('use-calendar-connection') ? { useCalendarConnection: getConnection } : read, exp);
  return exp;
}
export { read };
