# 알림 0.1B 서버 Web Push 운영 메모

## 비용 원칙

알림 전송은 외부 유료 Push SaaS 없이 표준 Web Push + 기존 Supabase + Netlify를 우선 사용한다.

## Netlify 환경변수

서버 Web Push에는 아래 환경변수가 필요하다.

- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY` — secret, 서버 전용
- `WEB_PUSH_VAPID_SUBJECT`

Deploy Preview와 production 컨텍스트는 분리한다. 실기 검수 전에는 Deploy Preview 컨텍스트만 설정하며, production 값은 main 병합/운영 전환 시 별도로 설정한다.

비밀키 값은 저장소, Issue, PR 본문, 로그 예시에 기록하지 않는다.

## 데이터 저장

`public.push_subscriptions`는 사용자와 Workspace 소유권을 함께 저장하며 RLS를 사용한다. 브라우저 Push endpoint가 404/410으로 만료되면 구독을 비활성화할 수 있다.
