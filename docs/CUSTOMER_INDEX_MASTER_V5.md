# 고객 인덱스 최종 기준원본 v5

기준 확정일: 2026-09-17

## Source of Truth

고객 인덱스의 최종 기준원본(Source of Truth)은 아래 파일이다.

- 파일명: `메티스_전체고객인덱스_MASTER_v1_최종_v5.xlsx`
- 역할: 전체 고객 Identity/인덱스의 최종 기준원본
- 보관 위치: Google Drive 원본 보관

이 파일을 고객 Identity, 고객 매핑, 증분 갱신, 무결성 검증의 최종 기준으로 사용한다.

## DEV STAGING과의 관계

Google Sheets의 아래 파일은 최종 기준원본이 아니라 CRM DEV 검색 연결용 STAGING 사본이다.

- 파일명: `DEV_메티스_고객인덱스_v5_STAGING`
- Spreadsheet ID: `13DakNTC6YyOfaqZa8vquEBTYnhyMJSvembGfDdSrQOg`
- 주요 시트:
  - `V5_IDENTITY_STAGING`
  - `CRM_ID_V5_매핑`

STAGING은 MASTER에서 필요한 운영/검색 연결 데이터를 추출해 사용하는 파생본으로 취급한다.

## 키 원칙

현재 MASTER v5의 공식 Identity 기준키는 `P-...` 형식의 `v5 고객키`다.

기존 CRM의 `C...` 고객ID와 CRM 내 `MCI-...` 메티스고객키는 별도 매핑/연결 키로 보존한다. `MCI`를 향후 통합 canonical key로 사용할지는 별도 마이그레이션 정책으로 결정하며, 현재 MASTER의 공식 기준키를 임의로 대체하지 않는다.

## 증분 운영 원칙

고객 인덱스는 누적형/증분형으로 운영한다.

- Google Drive 상담고객이 증가할 때 전체 인덱스를 매번 재생성하지 않는다.
- 신규/변경 고객만 탐지하여 기존 Identity와 매칭한다.
- 확실한 기존 고객이면 기존 Identity에 이력을 추가한다.
- 확실한 신규 고객이면 새 고객키를 발급한다.
- 불명확한 경우 확인대기/검토 대상으로 보낸다.
- 사람이 확정한 매핑은 이후 자동 분석이 임의로 덮어쓰지 않는다.

## 보험팩 연계 원칙

보험계약 인덱스는 별도 고객 마스터를 만들지 않는다.

보험계약은 고객 인덱스의 Identity를 참조하여 연결하고, 고객명·연락처·가족관계 등 공통 고객정보를 보험 모듈에 중복 저장하지 않는다.

## 보안

MASTER에는 고객 개인정보가 포함될 수 있으므로 공개 저장소나 공개 링크로 배포하지 않는다. GitHub 저장소에 원본 바이너리를 보관하는 경우에도 private repository에서만 관리한다.

## 원본 바이너리 보관 상태

현재 GitHub 연결 인터페이스는 약 10MB 크기의 `.xlsx` 바이너리 파일을 로컬 파일 참조 그대로 업로드하는 기능을 제공하지 않아, 원본 바이너리는 이 커밋에 포함하지 않았다. 원본 자체는 Google Drive에 보관하며, 이 문서는 GitHub 내 Source of Truth 선언과 개발 기준을 고정하기 위한 것이다.
