# 업무기록 음성 입력기 v1

갤럭시에서 홈 화면 아이콘을 눌러 업무를 말하고, 기존 Notion `🎙 업무 통합 기록` DB에 저장하는 소형 PWA입니다.

## v1 목표

- 큰 `말하기` 버튼
- 한국어 음성 인식(Web Speech API)
- 미지원 환경에서는 Android 키보드 음성입력 폴백
- 인식 결과 확인/수정
- 기존 Notion DB에 저장
- AI API 없음
- Netlify Function에서 Notion 토큰 보호

## 기술 구조

`Android PWA → Web Speech API/키보드 음성입력 → /api/worklog → Netlify Function → Notion API`

Notion data source 기본값:
`e345d19d-504f-4466-815a-912b1d6b9a3a`

## 필수 1회 설정

1. Notion에서 Internal Integration을 만든다.
2. `🎙 업무 통합 기록` 데이터베이스를 해당 Integration에 연결/공유한다.
3. Integration Secret을 복사한다.
4. Netlify 사이트의 환경변수에 아래를 추가한다.
   - `NOTION_TOKEN` = Integration Secret
   - `APP_ACCESS_KEY` = 본인만 아는 10자 이상의 개인 접근키
5. 재배포한다.
6. 휴대폰에서 처음 저장할 때 `APP_ACCESS_KEY`를 한 번 입력한다. 이후에는 기기에 저장되어 다시 묻지 않는다.

> Notion 토큰과 개인 접근키는 브라우저 코드나 GitHub 저장소에 넣지 않는다.

## 로컬 실행

Netlify CLI가 설치되어 있다면:

```bash
npm install
npx netlify dev
```

브라우저에서 Netlify CLI가 알려주는 로컬 주소로 접속합니다.

## 배포

```bash
npx netlify deploy
```

검수 후:

```bash
npx netlify deploy --prod
```

## 테스트 문장

`태장 홈페이지 도메인 연결 완료했고 tejang.siot.kr로 접속 확인했음.`

예상 저장값:
- 기관: 태장
- 상태: 완료
- 유형: 완료업무
- 내용/음성원문: 전체 문장
- 기록일: 한국 시간 기준 오늘
