# 알림 0.1B 서버 Web Push 운영 메모

## 비용 원칙

알림 전송은 외부 유료 Push SaaS 없이 표준 Web Push + 기존 Supabase + Netlify를 우선 사용한다.

## Netlify 환경변수

서버 Web Push에는 아래 환경변수가 필요하다.

- `WEB_PUSH_VAPID_PRIVATE_KEY` — secret, 서버 전용
- `WEB_PUSH_VAPID_SUBJECT`

`WEB_PUSH_VAPID_PUBLIC_KEY`는 별도 환경변수로 관리하지 않는다. 서버가 private key에서 공개키를 자동 파생해 브라우저에 제공한다. 이 구조로 공개/비밀키가 서로 다른 키쌍이 되는 설정 오류를 차단한다.

Deploy Preview와 production 컨텍스트는 분리한다. 실기 검수 전에는 Deploy Preview 컨텍스트만 설정하며, production 값은 main 병합/운영 전환 시 별도로 설정한다.

비밀키 값은 저장소, Issue, PR 본문, 로그 예시에 기록하지 않는다.

실기 검수 전에는 UAR가 Deploy Preview의 `/api/push-subscription`을 실제 호출해 런타임 private key에서 공개키 파생이 성공하는지 확인한다. private key는 응답이나 클라이언트 자산에 노출하지 않는다.

## 데이터 저장

`public.push_subscriptions`는 사용자와 Workspace 소유권을 함께 저장하며 RLS를 사용한다. 브라우저 Push endpoint가 404/410으로 만료되면 구독을 비활성화할 수 있다.
