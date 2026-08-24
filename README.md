# 업무기록 Voice PWA

갤럭시에서 홈 화면 아이콘을 눌러 업무를 말하고, 기존 Notion `🎙 업무 통합 기록` DB에 저장하는 소형 PWA입니다.

## 현재 안정판

- 기준: v1 / 2026-08-24
- Production: `https://worklog-voice-pwa.netlify.app`
- 배포: Netlify
- 원본 저장소: 이 GitHub 저장소
- Notion 토큰 및 앱 접근키는 GitHub에 저장하지 않고 Netlify 환경변수로만 관리

## 구조

`Android PWA → Web Speech API / Android 키보드 음성입력 → Netlify Function → Notion API`

## 현재 기능

- 큰 `말하기` 버튼
- 한국어 음성 인식
- 인식 결과 확인 및 수정
- 기관 / 상태 / 유형의 가벼운 규칙 기반 자동선택
- 금액 / 담당자 / 기한 / 후속조치 선택 입력
- 기존 Notion `🎙 업무 통합 기록` DB에 저장
- AI API 사용 없음
- PWA 홈 화면 설치 지원

## 환경변수

Netlify에서만 관리합니다.

- `NOTION_TOKEN`
- `APP_ACCESS_KEY`
- `NOTION_DATA_SOURCE_ID`

비밀값을 코드, Issue, PR, README에 넣지 않습니다.

## 운영 원칙

현재 `main`은 실제 운영 가능한 안정판입니다.

향후 패치는 다음 흐름을 기본으로 합니다.

1. GitHub Issue로 변경 목적 기록
2. 기능 브랜치 생성
3. 코드 수정
4. 테스트
5. Draft PR 검수
6. 승인 후 `main` 반영
7. Netlify production 배포 확인

사용자의 명시적 승인 없이 큰 구조 변경, Notion DB 파괴적 변경, 토큰 노출, 운영 데이터 삭제를 하지 않습니다.

## 1차 성공 테스트

문장:

`태장 홈페이지 도메인 연결 완료했고 tejang.siot.kr로 접속 확인했음.`

예상값:

- 기관: 태장
- 상태: 완료
- 유형: 완료업무
- 내용 / 음성원문: 전체 문장
- 기록일: 한국 시간 기준 오늘

## 향후 후보 기능

- 말하기 시작 동선 단축
- 저장 성공 진동/소리 피드백
- 여러 업무 한 번에 말했을 때 분리
- 금액 / 담당자 / 기한 추출 정확도 개선
- 네트워크 장애 시 임시 저장 후 재전송
- 오늘 기록 건수 표시
- 최소한의 AI 정리 기능은 비용과 안정성 확인 후 별도 검토
