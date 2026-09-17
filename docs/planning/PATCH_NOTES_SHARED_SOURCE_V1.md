# Patch Notes Shared Source V1

## 목적

웹 공개 패치노트와 모바일 업데이트 내역이 같은 완료 릴리스를 표현하되, Draft 변경을 공개 완료 항목처럼 노출하지 않는다.

## 현재 경계

- 개발 중 변경: `.patch-notes/<issue-or-pr>.md`
- 공개 웹: `public/patch-notes.html` 및 기존 웹 렌더링 구조
- 모바일: `mobile/src/features/settings/patch-notes.ts`

현재 웹 동작은 유지한다. 이 문서는 다음 점진적 이전을 위한 공통 계약만 정의하며, Draft PR에서 공개 데이터 파일을 생성하지 않는다.

## 제안 데이터 계약

main에 병합된 릴리스만 아래 구조를 `public/data/patch-notes.json`으로 발행한다.

```json
{
  "schemaVersion": 1,
  "releases": [
    {
      "date": "2026-09-18",
      "version": "optional-release-label",
      "title": "사용자 중심 변경 제목",
      "summary": "짧은 사용자-facing 요약",
      "items": ["완료된 사용자-facing 변경"],
      "platforms": ["web", "mobile"],
      "source": { "mergedPullRequest": 339 }
    }
  ]
}
```

## 불변 조건

1. `mergedPullRequest`는 실제 main 병합 후에만 설정한다.
2. Draft PR과 Human QA 대기 기능은 `.patch-notes/`에만 기록한다.
3. Web과 mobile은 같은 `releases` 순서(최신 우선)를 사용한다.
4. mobile은 네트워크 실패 시 마지막으로 번들된 완료 릴리스만 표시하며 Draft 내용을 추측하지 않는다.
5. 공개 데이터에는 비밀값, 내부 오류 로그, 사용자 업무 원문을 넣지 않는다.

## 점진적 적용 순서

1. main 병합 시 기존 Markdown 항목을 위 JSON으로 병행 발행한다.
2. 웹 renderer가 JSON을 읽되 기존 HTML fallback을 유지한다.
3. 모바일의 번들 데이터가 JSON 계약과 일치하도록 교체한다.
4. web/mobile 같은 릴리스 목록을 검증하는 contract test를 추가한다.

## 이번 PR 상태

PR #339은 Draft이므로 이 JSON을 발행하거나 공개 패치노트에 기능을 추가하지 않는다. `.patch-notes/339.md`, `.patch-notes/349.md`, `.patch-notes/350.md`가 개발 기록의 source of truth다.
