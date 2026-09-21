# Issue #433 — Android SpeechRecognizer dependency decision

Date: 2026-09-22

## Decision

Use `expo-speech-recognition` `57.1.0` as the Android Quick Voice primary-path adapter. The app uses it only through `QuickVoiceRecognitionPort`; UI, canonical save, and Data Core remain provider-neutral. The existing `whisper.rn` capture/transcription path remains available as a fallback and benchmark.

## Adoption check

| Check | Result |
| --- | --- |
| License | MIT (upstream repository) |
| Maintenance | 57.1.0 was published in September 2026; the SDK 57 line includes active Android release-build fixes. |
| Expo / RN | Upstream 57.0.0 changelog declares Expo SDK 57 / React Native 0.86 support; this repository is Expo 57.0.23 / RN 0.86.3. |
| Android support | Basic recognition is supported on Android 12 and later. Continuous recognition is documented as Android 13+; the app also owns bounded session restart so paused dictation remains recoverable where a service ends a session. |
| Native configuration | Expo config plugin required. It adds manifest permissions and Android speech-service package visibility; a new Development Build is required. |
| Permission | Android runtime request is `RECORD_AUDIO`; there is no separate Android speech-recognition permission. The plugin also supplies iOS usage text for the shared app config. |
| Binary impact | Native module is added, but no speech model is embedded or downloaded by the app. Exact ARM64 APK size is measured by the native release gate. |
| Known limits | Recognition service and Korean on-device model availability vary by device. The app checks availability, installed locale, and on-device capability at runtime rather than assuming them. Default service recognition is allowed if offline Korean is unavailable. |

## Runtime policy

- Locale is `ko-KR`.
- On-device mode is enabled only when both the device reports on-device capability and `ko-KR` is installed.
- Final text is committed separately from interim text. Duplicate/cumulative callbacks are merged without repeating words.
- A normal end, `no-speech`, or short timeout receives a bounded delayed restart while the user session remains active.
- Permission, unavailable service, and unsupported language are fatal and do not loop.
- If the primary engine cannot start, Quick Voice automatically starts the existing Whisper capture path. If it fails after a live-only session has begun, no hidden duplicate recorder is fabricated; the user is offered an explicit Whisper re-record or direct input.
