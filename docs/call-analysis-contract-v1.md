# 통화/회의 AI 분석 결과 계약 V1

기준일: 2026-09-13

## 목적

STT/AI 공급자가 바뀌어도 업무수첩의 DB와 화면 구조가 바뀌지 않도록 내부 표준 결과 형식을 고정한다.

## 표준 결과

```json
{
  "analysisVersion": "v1",
  "title": "한 줄 제목",
  "summary": "통화 요약",
  "keyPoints": ["핵심 내용"],
  "actions": [
    {
      "type": "task | schedule | follow_up | decision",
      "content": "해야 할 내용",
      "dueText": "내일 오후 3시",
      "dueStart": "2026-09-14T15:00:00+09:00",
      "dueHasTime": true,
      "confidence": 0.9,
      "confirmed": false,
      "needsReview": false,
      "sourceExcerpt": "판단 근거가 되는 짧은 원문"
    }
  ],
  "contacts": [
    {
      "name": "상대방 이름",
      "phone": "전화번호",
      "role": "회사/역할",
      "confidence": 0.9
    }
  ]
}
```

## 일정 안전규칙

1. AI가 `confirmed=true`를 보내도 서버에서 항상 `false`로 바꾼다.
2. 자연어 일정(`내일 오후 3시`)은 기존 `schedule-extract.mjs`로 다시 계산한다.
3. 날짜만 언급된 일정은 `YYYY-MM-DD`로 보존하고 `dueHasTime=false`로 저장한다.
4. 시간까지 있는 일정은 ISO 8601 +09:00 형식으로 저장하고 `dueHasTime=true`로 저장한다.
5. 여러 날짜/시간이 섞여 모호하면 `dueStart`를 비우고 `needsReview=true`로 둔다.
6. AI가 직접 준 `dueStart`도 달력상 유효한 날짜와 시간인지 검사한다. `2026-02-30` 같은 값은 거부한다.
7. 사용자가 확인하기 전에는 DB의 `confirmed`가 true가 될 수 없다.

## 액션 유형

- `task`: 사용자가 해야 할 일
- `schedule`: 날짜/시간이 있는 일정 후보
- `follow_up`: 이후 확인/연락/추적이 필요한 항목
- `decision`: 통화에서 합의되거나 결정된 사항

지원하지 않는 유형은 저장하지 않는다.

## 비용/호출 원칙

- STT는 녹음 1건당 1회만 수행한다.
- 생성된 녹취록 하나를 AI 구조화 분석에 사용한다.
- 공급자 호출마다 `usage_events`에 별도 원가 이벤트를 남긴다.
- `feature`와 `service`를 분리해 기능별 원가를 계산한다.
- 현재 단계에서는 실제 STT/AI 호출을 하지 않는다.

## 공급자 교체 원칙

공급자별 어댑터는 결과를 이 계약 형식으로 변환한 뒤 `normalizeCallAnalysisResult()`를 통과시켜야 한다. 따라서 향후 OpenAI, CLOVA, AssemblyAI 또는 다른 AI/STT를 사용해도 DB/화면은 이 내부 계약만 의존한다.
