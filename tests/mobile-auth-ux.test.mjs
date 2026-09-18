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
  assert.match(appShellSource, /quickDockShell/);
  assert.match(appShellSource, /paddingBottom: Math\.max\(insets\.bottom, 8\)/);
  assert.doesNotMatch(appShellSource, /PrimaryNavigation/);
});

test('Only the non-sensitive email identifier is remembered by the app', () => {
  assert.match(authPreferencesSource, /LAST_LOGIN_EMAIL_KEY/);
  assert.match(authPreferencesSource, /SecureStore\.setItemAsync/);
  assert.doesNotMatch(authPreferencesSource, /password/i);
});
