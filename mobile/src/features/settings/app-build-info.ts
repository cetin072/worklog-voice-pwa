/** Display the bundled app identity, never infer the installed Play track or
 * actual native build number from app.json (release CI can override versionCode). */
type BundledConfig = Readonly<{
  version?: string;
  android?: Readonly<{ package?: string }>;
}> | null | undefined;

export function appBuildInfo(config: BundledConfig) {
  const pkg = config?.android?.package || '';
  const version = typeof config?.version === 'string' && config.version.trim()
    ? config.version.trim() : '확인 불가';
  if (pkg === 'com.cetin072.worklog.qa') {
    return {
      label: `업무수첩 QA · 설정 버전 ${version}`,
      help: 'QA 앱은 정식 Play 스토어 업데이트 안내 대상이 아닙니다.',
    };
  }
  if (pkg === 'com.cetin072.worklog') {
    return {
      label: `업무수첩 Play용 · 설정 버전 ${version}`,
      help: '업데이트 안내는 Google Play가 해당 설치본의 업데이트 가능 여부를 확인했을 때만 표시됩니다.',
    };
  }
  return {
    label: `앱 종류 확인 필요 · 설정 버전 ${version}`,
    help: '앱 종류와 업데이트 가능 여부를 확인하지 못했습니다.',
  };
}
