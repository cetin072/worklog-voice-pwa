import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appJson = JSON.parse(fs.readFileSync('mobile/app.json', 'utf8'));
const homeSource = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const providerSource = fs.readFileSync('mobile/src/providers/platform-provider.tsx', 'utf8');
const googleAuthSource = fs.readFileSync('mobile/src/platform/google-auth.ts', 'utf8');
const googleAuthRouteSource = fs.readFileSync('mobile/app/google-auth.tsx', 'utf8');
const authPreferencesSource = fs.readFileSync('mobile/src/platform/auth-preferences.ts', 'utf8');
const appShellSource = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const rootLayoutSource = fs.readFileSync('mobile/app/_layout.tsx', 'utf8');

test('Mobile app owns a stable worklog deep-link scheme', () => {
  assert.equal(appJson.expo.scheme, 'worklog');
  assert.ok(appJson.expo.plugins.includes('expo-web-browser'));
  assert.match(googleAuthSource, /worklog:\/\/google-auth/);
});

test('Google sign-in reuses Supabase OAuth and returns through the app scheme', () => {
  assert.match(googleAuthSource, /provider:\s*'google'/);
  assert.match(googleAuthSource, /redirectTo:\s*GOOGLE_AUTH_REDIRECT_URL/);
  assert.match(googleAuthSource, /skipBrowserRedirect:\s*true/);
  assert.match(googleAuthSource, /WebBrowser\.openAuthSessionAsync/);
  assert.match(googleAuthSource, /GOOGLE_AUTH_REDIRECT_URL/);
  assert.match(googleAuthSource, /result\.type === 'cancel'/);
  assert.match(googleAuthSource, /result\.type === 'dismiss'/);
  assert.match(googleAuthSource, /callbackInFlight/);
  assert.match(googleAuthSource, /client\.auth\.setSession/);
  assert.match(googleAuthSource, /client\.auth\.exchangeCodeForSession/);
});

test('Google callback has an Expo Router route and returns to the app shell after auth completes', () => {
  assert.match(googleAuthRouteSource, /GoogleAuthCallbackScreen/);
  assert.match(googleAuthRouteSource, /usePlatform/);
  assert.match(googleAuthRouteSource, /Google 로그인 완료 중/);
  assert.match(googleAuthRouteSource, /router\.replace\('\/'\)/);
});

test('Mobile Google OAuth does not persist Google provider tokens', () => {
  assert.doesNotMatch(googleAuthSource, /provider_token/);
  assert.doesNotMatch(googleAuthSource, /provider_refresh_token/);
});

test('Platform provider handles initial and foreground Google auth callbacks', () => {
  assert.match(providerSource, /Linking\.getInitialURL\(\)/);
  assert.match(providerSource, /Linking\.addEventListener\('url'/);
  assert.match(providerSource, /signInWithGoogle/);
  assert.match(providerSource, /rememberedEmail/);
  assert.match(providerSource, /Google 로그인을 취소했습니다/);
});

test('Android touch smoke restores its QA session through PlatformProvider instead of bypassing Home auth state', () => {
  assert.match(providerSource, /seedAndroidTouchSmokeSession/);
  assert.match(providerSource, /await nextClient\.auth\.getSession\(\)/);
  assert.match(providerSource, /setSession\(data\.session\)/);
  assert.match(providerSource, /setPhase\('ready'\)/);
  assert.match(homeSource, /const phase = platform\.phase/);
  assert.match(homeSource, /const session = platform\.session/);
  assert.match(homeSource, /const client = platform\.client/);
  assert.doesNotMatch(homeSource, /ANDROID_TOUCH_SMOKE_SESSION|ANDROID_TOUCH_SMOKE_CLIENT/);
});

test('Login UI exposes Google first plus password visibility and autofill hints', () => {
  assert.match(homeSource, /Google로 시작/);
  assert.match(homeSource, /secureTextEntry=\{!showPassword\}/);
  assert.match(homeSource, /보기/);
  assert.match(homeSource, /숨기기/);
  assert.match(homeSource, /autoComplete="email"/);
  assert.match(homeSource, /autoComplete=\{authMode === 'signUp' \? 'new-password' : 'current-password'\}/);
  assert.match(homeSource, /importantForAutofill="yes"/);
});

test('Android resizes the app above the software keyboard during login', () => {
  assert.equal(appJson.expo.android.softwareKeyboardLayoutMode, 'resize');
  assert.match(appShellSource, /KeyboardAvoidingView/);
  assert.match(appShellSource, /Platform\.OS === 'ios' \? 'padding' : 'height'/);
  assert.match(appShellSource, /keyboardDismissMode="on-drag"/);
});

test('App shell applies safe-area insets without depending on a bottom navigation bar', () => {
  assert.match(rootLayoutSource, /SafeAreaProvider/);
  assert.match(appShellSource, /useSafeAreaInsets/);
  assert.match(appShellSource, /paddingTop: insets\.top/);
  assert.doesNotMatch(appShellSource, /quickDockShell|quickDockHeight|setQuickDockHeight/);
  assert.match(appShellSource, /paddingBottom: 28 \+ insets\.bottom/);
  assert.doesNotMatch(appShellSource, /PrimaryNavigation/);
});

test('Only the non-sensitive email identifier is remembered by the app', () => {
  assert.match(authPreferencesSource, /LAST_LOGIN_EMAIL_KEY/);
  assert.match(authPreferencesSource, /SecureStore\.setItemAsync/);
  assert.doesNotMatch(authPreferencesSource, /password/i);
});


test('Login and settings keep truthful success and error feedback', () => {
  assert.match(homeSource, /messageTone/);
  assert.match(homeSource, /showMessage\(messageOf\(nextError, '처리 중 오류가 발생했습니다\.'\), 'error'\)/);
  assert.match(homeSource, /authError \|\| messageTone === 'error'/);
  assert.match(homeSource, /messageTone === 'success' \? styles\.successText : styles\.infoText/);
  assert.match(homeSource, /function clearMessage\(\) \{[\s\S]*setMessage\(''\);[\s\S]*setMessageTone\('info'\)/);
  assert.doesNotMatch(homeSource, /function clearMessage\(\) \{\s*clearMessage\(\)/);
});

test('Settings stays Calendar-free and confirms destructive logout', () => {
  assert.doesNotMatch(homeSource, /CalendarConnection|scheduleSettings|Google\/휴대폰 Calendar/);
  assert.match(homeSource, /function confirmSignOut\(\)/);
  assert.match(homeSource, /Alert\.alert\(/);
  assert.match(homeSource, /이 기기에서 현재 업무수첩 계정 세션을 종료할까요/);
  assert.match(homeSource, /destructive onPress=\{confirmSignOut\}/);
});
