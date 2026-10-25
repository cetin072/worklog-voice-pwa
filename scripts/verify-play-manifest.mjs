import fs from 'node:fs';
const text = fs.readFileSync(process.argv[2], 'utf8');
if (!/package="com\.cetin072\.worklog"/.test(text)) throw Error('Unexpected package');
const target = Number(text.match(/targetSdkVersion="(\d+)"/)?.[1]);
if (!(target >= 36)) throw Error('target SDK must be >=36');
for (const permission of ['RECORD_AUDIO', 'FOREGROUND_SERVICE_MICROPHONE', 'POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED', 'SCHEDULE_EXACT_ALARM']) if (!text.includes('android.permission.' + permission)) throw Error('Missing ' + permission);
if (/FOREGROUND_SERVICE_MEDIA_PLAYBACK|USE_EXACT_ALARM|foregroundServiceType="[^"\n]*mediaPlayback|android:debuggable="true"|com\.cetin072\.worklog\.qa/.test(text)) throw Error('Unexpected Play manifest capability');
if (!/foregroundServiceType="[^"\n]*microphone/.test(text)) throw Error('Missing microphone service');
console.log('Play release manifest verified');
