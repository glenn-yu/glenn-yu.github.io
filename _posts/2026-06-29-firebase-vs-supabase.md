---
layout: post
title: "Firebase vs Supabase 완전 비교: BaaS 두 거인의 아키텍처·가격·실전 선택 가이드"
date: 2026-06-29 10:00:00 +0900
categories: [Backend, BaaS, Database]
tags: [Firebase, Supabase, BaaS, PostgreSQL, Firestore, Realtime, Authentication, RLS, Edge Functions, Cloud Functions, Serverless, NoSQL, SQL, Vendor Lock-in, Self-hosting, Pricing]
excerpt: "Firebase와 Supabase를 아키텍처·데이터베이스·인증·실시간·서버리스·가격·벤더 락인까지 1차 소스 기준으로 깊게 비교합니다. '둘 중 뭘 골라야 하나'에 대한 실전 판단 기준을 정리한 기술 레퍼런스입니다."
---

앱을 만들 때 가장 먼저 부딪히는 결정 중 하나가 **백엔드를 어떻게 할 것인가**입니다. 서버를 직접 운영하기엔 부담스럽고, 인증·DB·스토리지·실시간 동기화를 매번 처음부터 짜기도 비효율적입니다. 그래서 등장한 것이 **BaaS(Backend as a Service)** — 백엔드의 핵심 기능을 SDK 호출 몇 줄로 끝내주는 서비스입니다.

이 시장의 두 거인이 **Firebase**(2011년 시작, 2014년 Google 인수)와 **Supabase**(2020년 시작, "오픈소스 Firebase 대안")입니다. 표면적으로는 비슷한 일을 하지만, **근본 철학과 아키텍처가 정반대**라서 잘못 고르면 나중에 마이그레이션 지옥을 겪게 됩니다.

이 글은 단순 기능 나열이 아니라 **왜 이런 차이가 생기는지, 그래서 어떤 상황에서 무엇을 골라야 하는지**를 1차 소스 기준으로 정리한 기술 레퍼런스입니다.

> **참고**: 이 글의 가격·한도 수치는 작성 시점(2026년 6월) 기준이며 [Firebase 공식 가격](https://firebase.google.com/pricing)과 [Supabase 공식 가격](https://supabase.com/pricing) 페이지에서 교차 검증했습니다. BaaS 가격 정책은 자주 바뀌므로 실제 도입 전 공식 페이지를 다시 확인하세요.

---

## 1. 한 문장 요약과 핵심 대립 구도

| 구분 | Firebase | Supabase |
|------|----------|----------|
| **한 줄 정체성** | Google이 운영하는 프로프라이어터리 모바일 우선 BaaS | 오픈소스 도구를 묶은 PostgreSQL 기반 BaaS |
| **데이터베이스** | Firestore / Realtime Database (NoSQL 문서형) | PostgreSQL (관계형 SQL) |
| **출시/배경** | 2011, 2014 Google 인수 | 2020, YC 출신 스타트업 |
| **라이선스** | 비공개(클로즈드) | Apache 2.0 등 오픈소스 |
| **셀프 호스팅** | 불가능 | 가능 (Docker Compose 전체 스택) |
| **가격 모델** | 사용량 기반(operation별 과금) | 정액 티어 기반(월 고정 + 초과분) |
| **강점 영역** | 모바일 앱, 오프라인 동기화, Google 생태계 통합 | 관계형 데이터 웹 앱, 예측 가능한 비용, SQL 파워 |

**핵심 대립을 한 문장으로**: Firebase는 "Google이 다 알아서 해주는 대신 Google에 묶이는" 모델이고, Supabase는 "표준 오픈소스(Postgres)를 관리형으로 편하게 쓰되 언제든 들고 나갈 수 있는" 모델입니다.

이 한 줄에서 거의 모든 차이가 파생됩니다. 아래에서 영역별로 뜯어봅니다.

---

## 2. 데이터베이스 — NoSQL 문서형 vs 관계형 SQL

가장 근본적이고 가장 중요한 차이입니다. 다른 모든 차이가 사실상 여기서 갈라집니다.

### 2.1 Firebase — Firestore (NoSQL 문서형)

Firestore는 데이터를 **컬렉션(collection) → 문서(document) → 필드(field)** 구조의 JSON 유사 문서로 저장합니다.

```
users (collection)
 └─ user_123 (document)
     ├─ name: "Glenn"
     ├─ email: "..."
     └─ posts (sub-collection)
         └─ post_1 (document)
```

특징과 제약:

- **스키마리스(schemaless)**: 문서마다 필드 구조가 달라도 됩니다. 초기 개발이 빠릅니다.
- **얕은 쿼리(shallow query)**: 쿼리가 관계를 가로질러 탐색(JOIN)할 수 없습니다. 컬렉션 그룹 쿼리로 같은 이름의 컬렉션을 검색할 수는 있지만, 본질적으로 **조인이 없습니다**.
- **비정규화(denormalization) 강제**: 관계형으로 풀 문제를 문서 중복 저장으로 풀어야 합니다. "사용자 + 사용자의 게시글 + 각 게시글의 댓글 수"를 한 번에 가져오려면 여러 번 읽거나 데이터를 미리 복제해 둬야 합니다. 이게 **읽기 횟수 = 비용 증가**로 직결됩니다.

### 2.2 Supabase — PostgreSQL (관계형 SQL)

Supabase는 세계에서 가장 인기 있는 오픈소스 RDB인 **PostgreSQL**을 그대로 씁니다. 즉 우리가 아는 그 SQL입니다.

```sql
-- 한 쿼리로 조인 + 서브쿼리 + 집계가 전부 가능
select u.name, p.title, count(c.id) as comment_count
from users u
join posts p on p.user_id = u.id
left join comments c on c.post_id = p.id
group by u.name, p.title;
```

특징:

- **조인·서브쿼리·트랜잭션·풀텍스트 검색**을 단일 SQL로 처리. 데이터 일관성을 트랜잭션이 보장하고, 인덱스로 성능을 잡습니다.
- **Postgres 확장(extension) 생태계**를 그대로 활용: `pgvector`(AI 임베딩/벡터 검색), `PostGIS`(지리정보), `pg_cron`(스케줄링) 등.
- **명시적 스키마**: 테이블 구조를 미리 정의해야 합니다. 초기엔 약간 번거롭지만 데이터가 복잡해질수록 안정성으로 보답합니다.

### 2.3 어떻게 고를까

| 데이터 성격 | 추천 |
|------------|------|
| 관계가 복잡함 (사용자↔주문↔상품↔리뷰) | **Supabase** — 조인이 곧 생산성 |
| 문서 단위로 독립적 (채팅 메시지, 로그, 단순 프로필) | Firebase도 충분 |
| 집계/리포트/분석 쿼리가 많음 | **Supabase** — SQL 집계의 힘 |
| 스키마가 자주 바뀌는 초기 프로토타입 | Firebase가 빠름 |

> **실전 패턴**: 많은 팀이 *"Firebase로 빠르게 프로토타이핑 → 데이터 모델이 관계형이 되거나 비용이 예측 불가능해지면 Supabase로 이전"*하는 경로를 밟습니다. 처음부터 관계형 데이터가 명확하다면 Supabase로 시작하는 게 이전 비용을 아낍니다.

---

## 3. 실시간(Realtime) — 둘 다 강하지만 결이 다르다

실시간 동기화는 두 플랫폼의 간판 기능입니다. 그러나 구현 방식이 다릅니다.

### 3.1 구현 메커니즘

- **Supabase Realtime**: PostgreSQL의 **CDC(Change Data Capture)** 와 네이티브 `LISTEN/NOTIFY` 메커니즘을 WebSocket으로 라우팅합니다. DB 변경이 곧 실시간 이벤트가 됩니다. 보고된 벤치마크 기준 1,000 동시 연결에서 **50ms 미만** 지연으로 변경을 브로드캐스트합니다.
- **Firebase**: Realtime Database와 Firestore 모두 자체 실시간 동기화 엔진을 갖고 있습니다. 동일 조건에서 약 **80ms** 수준으로 보고됩니다.

지연 시간 자체는 둘 다 실용적으로 충분히 빠르며, 위 수치는 출처별 벤치마크라 절대적 우열로 보긴 어렵습니다.

### 3.2 진짜 차이: 오프라인 동기화

여기서 Firebase가 확실히 앞섭니다. **모바일 오프라인 시나리오**에 대한 성숙도가 다릅니다.

> 기기가 오프라인이 되면 Firestore는 마지막 상태를 로컬에 캐시하고 쓰기 작업을 큐에 쌓아둡니다. 연결이 복구되면 큐에 쌓인 쓰기를 자동으로 동기화하고, **last-writer-wins(마지막 쓰기 우선)** 전략으로 충돌을 해소합니다.

이 "끊겨도 알아서 쌓아두고 복구되면 동기화"는 Firebase가 2011년부터 모바일을 위해 다듬어 온 부분으로, Supabase가 아직 따라잡기 어려운 영역입니다. 지하철·엘리베이터에서도 매끄럽게 동작해야 하는 모바일 앱이라면 이 점이 결정적일 수 있습니다.

---

## 4. 인증(Authentication)과 보안 모델

### 4.1 기능 자체는 둘 다 충분

이메일/비밀번호, OAuth 소셜 로그인, 전화번호 인증, MFA, 패스키(Passkey) — 두 플랫폼 모두 2025년 기준 주류 인증 방식을 GA(정식)로 지원합니다. 기능 체크리스트로는 사실상 동률입니다.

### 4.2 진짜 차이: "보안을 어디서 강제하는가"

이게 철학적으로 가장 흥미로운 차이입니다.

**Firebase — Security Rules (서비스별 DSL)**

Firebase는 `request.auth` 객체를 참조하는 **전용 DSL(도메인 특화 언어)** 로 규칙을 작성합니다. 규칙은 별도 설정 파일로 프로젝트와 함께 배포됩니다.

```javascript
// Firestore Security Rules (전용 문법)
match /posts/{postId} {
  allow read: if true;
  allow write: if request.auth.uid == resource.data.authorId;
}
```

- 보안이 **API/SDK 레이어에서** 강제됩니다.
- 단, 이 규칙은 **Firebase SDK를 통한 Firestore 접근에만** 적용됩니다.

**Supabase — Row Level Security (PostgreSQL 네이티브)**

Supabase는 인증을 **데이터베이스 엔진 안에서** 강제합니다. GoTrue가 발급한 JWT가 매 요청에 실려 서버에서 검증되고, `auth.uid()` 함수를 통해 Postgres의 **RLS(Row Level Security) 정책**과 직접 연동됩니다.

```sql
-- PostgreSQL RLS 정책 (그냥 SQL)
create policy "본인 글만 수정 가능"
on posts for update
using ( auth.uid() = author_id );
```

- 보안이 **스토리지(DB) 레이어에서** 강제됩니다.
- 따라서 REST API, GraphQL, 직접 DB 연결 등 **모든 접근 경로가 동일한 규칙을 따릅니다.** API 클라이언트가 뚫려도 DB 정책을 우회할 수 없습니다.

### 4.3 정리

| 관점 | Firebase | Supabase |
|------|----------|----------|
| 규칙 언어 | 전용 DSL (별도 학습 필요) | SQL (백엔드 개발자에게 익숙) |
| 강제 위치 | API/SDK 레이어 | DB(스토리지) 레이어 |
| 적용 범위 | Firebase SDK 경로 | 모든 접근 경로 |
| 견고성 | 높음 | 일반적으로 더 견고하다고 평가 |

RLS는 "DB가 곧 보안 경계"라는 점에서 구조적으로 더 견고하다고 평가받지만, RLS 정책을 잘못 짜면 데이터가 통째로 노출되거나 막힐 수 있어 **SQL 보안 정책 설계 역량**이 요구됩니다.

---

## 5. 서버리스 함수 — Cloud Functions vs Edge Functions

비즈니스 로직(웹훅 처리, 결제, 커스텀 API)을 서버 없이 돌리는 기능입니다.

| 항목 | Firebase Cloud Functions | Supabase Edge Functions |
|------|--------------------------|--------------------------|
| 런타임 | Node.js, Python, Go, Java, .NET, Ruby, PHP | Deno 2.1 (TypeScript 우선) |
| 배포 위치 | Google Cloud 리전 | 글로벌 엣지 네트워크 |
| 콜드 스타트 | 2세대 기준 500ms~2초 | 약 42ms |
| 트리거 | 모든 Firebase 서비스에 네이티브 트리거 | 이벤트 패턴은 수동 배선 필요 |
| 패키지 | 언어별 생태계 | 2026년부터 npm 100만+ 패키지 네이티브 호환 |

**해석**:

- **콜드 스타트**: Supabase Edge Functions가 약 42ms로, Firebase 2세대 함수(500ms~2초) 대비 10~50배 빠릅니다. 사용자 대면 API 응답 지연에 직결되는 부분입니다.
- **언어 유연성**: Firebase는 7개 언어를 지원해 폭이 넓습니다. Supabase는 Deno(TypeScript) 단일 환경이지만, 2026년 npm 호환이 들어오면서 실질적 제약이 크게 줄었습니다.
- **이벤트 통합**: Firebase는 "Firestore 문서가 생성되면 함수 실행" 같은 네이티브 트리거가 풍부합니다. Supabase는 직접 DB와 통신하는 단순함이 강점이지만 이벤트 기반 패턴은 수동 배선이 더 필요합니다.

> **요약**: 지연에 민감한 사용자 대면 API → Supabase. 복잡한 Firebase 서비스 간 이벤트 연동 → Firebase.

---

## 6. 가격 — 가장 자주 사고가 나는 영역

BaaS 선택에서 실무자가 가장 많이 후회하는 지점이 **요금 폭탄**입니다. 두 플랫폼의 과금 모델이 근본적으로 다릅니다.

### 6.1 Firebase — 사용량 기반 (operation별 과금)

**Spark 플랜 (무료)** 주요 한도:

- Firestore: 저장 1GB, 일일 읽기 50,000 / 쓰기 20,000 / 삭제 20,000
- Hosting: 저장 1GB, 월 전송 10GB
- Authentication: 월 10,000건 검증

**Blaze 플랜 (종량제)**: Spark 무료 한도를 그대로 포함하고, 초과분만 과금. 전화 인증·Cloud Vision 등 추가 기능도 해금됩니다. 신규 업그레이드 시 조건부 $300 크레딧 제공.

**Firestore 종량 단가(Blaze)**:

| 항목 | 단가 |
|------|------|
| 읽기 | $0.18 / 100,000건 |
| 쓰기 | $0.18 / 100,000건 |
| 삭제 | $0.02 / 100,000건 |
| 저장 | $0.26 / GB |

대부분의 소규모 앱은 Blaze에서도 월 $1~$10 수준입니다(무료 할당이 기본 사용량을 덮어줌). **문제는 스케일 구간**입니다. 한 사례(Dropbase)에서는 활성 사용자가 2배가 되자 Firebase 비용이 **400% 폭증**했습니다. 읽기 한 번 한 번이 돈이라, 비정규화로 읽기가 늘어나는 Firestore 특성과 맞물리면 비용이 비선형으로 튑니다.

### 6.2 Supabase — 정액 티어 기반

| 플랜 | 월 비용 | 주요 포함 |
|------|---------|-----------|
| **Free** | $0 | DB 500MB, 스토리지 1GB, MAU 50,000, 실시간 연결 200, egress 5GB |
| **Pro** | $25 | DB 8GB, 스토리지 100GB, MAU 100,000, 실시간 연결 500, egress 250GB, $10 컴퓨트 크레딧 포함 |
| **Team** | $599 | SSO, SOC 2·ISO 27001, PrivateLink, 긴 백업 보존, 로그 28일 |
| **Enterprise** | 협의 | 맞춤형 |

핵심 포인트:

- **요청(operation)별 과금이 없습니다.** 자원(저장·전송·컴퓨트) 기준이라 비용이 예측 가능합니다.
- Pro는 **기본적으로 spend cap(지출 상한)** 이 켜져 있어 폭주를 막습니다.
- egress(데이터 송신)는 Pro/Team에서 250GB까지 포함, 초과분 $0.09/GB.
- **무료 플랜 주의사항**: 1주일 미사용 시 프로젝트가 일시정지(pause)되며, 백업·SLA·SSO·HIPAA가 없고 활성 프로젝트 2개로 제한됩니다.

### 6.3 비용 관점 정리

- **소규모/프로토타입**: 둘 다 무료로 충분. Supabase 무료 한도가 MAU·스토리지에서 넉넉한 편.
- **성장 단계**: Supabase의 정액 모델이 "이번 달 얼마 나올지" 예측이 쉬워 사고가 적습니다. 시장 자료에서도 Supabase가 성장 구간에서 비용 서프라이즈가 적다고 일관되게 평가됩니다.
- **대규모/특수 워크로드**: 읽기보다 쓰기·전송이 압도적이거나 Google 생태계 깊이 통합된 경우 Firebase가 유리할 수도 있어, 실제 사용 패턴으로 시뮬레이션이 필요합니다.

---

## 7. 벤더 락인(Lock-in)과 셀프 호스팅 — 장기 리스크의 핵심

차이가 가장 극명한 영역이며, 장기 프로젝트라면 가장 신중히 봐야 할 부분입니다.

### 7.1 Firebase — 빠져나오기 어렵다

- **프로프라이어터리 서비스**라 셀프 호스팅 자체가 불가능합니다.
- 데이터가 Firestore 고유 포맷으로 Google 인프라에 저장됩니다.
- 다른 곳으로 이전하려면 **데이터 레이어를 사실상 처음부터 다시 작성**해야 합니다. NoSQL 문서 구조를 다른 DB로 옮기는 일은 단순 export/import가 아닙니다.

### 7.2 Supabase — 언제든 들고 나갈 수 있다

- **오픈소스**라 전체 스택(Postgres, GoTrue, PostgREST, Storage API, Realtime 서버)을 Docker Compose로 자체 인프라에서 운영 가능. 원하면 월 $10짜리 VPS에서도 돌릴 수 있습니다.
- 데이터가 **표준 PostgreSQL**이라 `pg_dump`로 덤프해서 임의의 Postgres 호환 서비스(AWS RDS, GCP Cloud SQL, 자체 서버 등)로 몇 분 만에 이전 가능합니다.

> **본질**: Supabase의 가장 큰 차별점은 특정 기능이 아니라 **"탈출 경로(exit path)가 표준이라는 점"** 입니다. 마음에 안 들면 그냥 표준 Postgres를 들고 나가면 됩니다. Firebase에는 이 경로가 없습니다.

---

## 8. 모바일 생태계 — Firebase의 결정적 해자

순수 백엔드 기능을 넘어서면 Firebase에는 Supabase가 따라올 수 없는 통합 도구 모음이 있습니다.

- **FCM (Firebase Cloud Messaging)**: 푸시 알림 사실상의 표준
- **Crashlytics**: 크래시 리포팅
- **Remote Config**: 앱 재배포 없이 동작 변경
- **A/B Testing & Analytics**: Google Analytics 통합
- **App Distribution, Performance Monitoring** 등

Firebase는 2011년부터 **모바일 우선**으로 설계됐고, 위 도구들이 콘솔 하나에 통합돼 있습니다. 모바일 앱(특히 Android/iOS 네이티브)을 만든다면 이 생태계만으로도 Firebase를 선택할 이유가 됩니다. Supabase는 순수 데이터 백엔드(DB/Auth/Storage/Realtime)에 집중하며, 푸시·크래시·분석은 별도 서비스를 붙여야 합니다.

> 참고: 안드로이드/Compose 환경에서는 FCM·Crashlytics·Remote Config 통합이 워낙 매끄러워서, "백엔드는 Supabase, 모바일 부가기능은 Firebase"처럼 **혼용**하는 팀도 적지 않습니다.

---

## 9. 기능 종합 비교표

| 영역 | Firebase | Supabase |
|------|----------|----------|
| **DB 모델** | NoSQL 문서형 (Firestore) | 관계형 SQL (PostgreSQL) |
| **쿼리** | 얕은 쿼리, 조인 불가 | 조인·서브쿼리·집계·풀텍스트 |
| **실시간** | 강력, 자체 엔진 | 강력, Postgres CDC |
| **오프라인 동기화** | ★ 매우 성숙 | 상대적으로 약함 |
| **인증 기능** | 풍부 | 풍부 (기능 동률) |
| **보안 모델** | Security Rules (DSL, API 레이어) | RLS (SQL, DB 레이어) |
| **서버리스** | 7개 언어, 트리거 풍부, 콜드스타트 느림 | Deno/TS, 엣지, 콜드스타트 빠름 |
| **스토리지** | Cloud Storage | S3 호환 Storage |
| **벡터/AI** | 별도 구성 | pgvector 네이티브 |
| **가격 모델** | 사용량 기반 (예측 어려움) | 정액 티어 (예측 쉬움) |
| **셀프 호스팅** | 불가능 | 가능 |
| **벤더 락인** | 높음 | 낮음 (표준 Postgres) |
| **모바일 부가기능** | ★ FCM/Crashlytics/Analytics | 별도 서비스 필요 |
| **라이선스** | 비공개 | 오픈소스 |

---

## 10. 결론 — 그래서 뭘 골라야 하나

### Firebase를 고르세요, 만약…

- **모바일 우선** 앱을 만든다 (특히 네이티브 Android/iOS)
- 끊김 없는 **실시간 동기화 + 오프라인 지원**이 핵심이다
- 푸시·크래시·분석 등 **통합 모바일 도구**가 필요하다
- 데이터가 문서 단위로 독립적이고 관계가 단순하다
- Google Cloud 생태계에 이미 깊이 들어가 있다

### Supabase를 고르세요, 만약…

- **데이터 관계가 복잡한 웹 앱**을 만든다 (조인·집계·트랜잭션)
- **예측 가능한 비용**이 중요하다 (요금 폭탄을 피하고 싶다)
- **벤더 락인을 피하고** 싶거나 셀프 호스팅 옵션을 원한다
- 팀이 **SQL에 익숙**하고 오픈소스를 선호한다
- AI/벡터 검색(pgvector)이나 지리정보(PostGIS) 같은 Postgres 확장이 필요하다

### 한 문장 판단 기준

> **"모바일이고 데이터가 단순하면 Firebase, 웹이고 데이터가 관계형이면 Supabase."**
> 그리고 장기 리스크(락인·비용 예측성)를 중시한다면 저울은 Supabase 쪽으로 기웁니다.

두 플랫폼 모두 무료 티어가 넉넉하니, **고민될 땐 실제 데이터 모델로 양쪽에 작은 프로토타입을 만들어 보는 것**이 가장 확실한 답입니다. 특히 Firebase는 본인의 읽기/쓰기 패턴으로 가격을 시뮬레이션해 보는 것을 강력히 권합니다.

---

## 참고 자료 (Sources)

**공식 문서**
- [Firebase 공식 가격](https://firebase.google.com/pricing) · [Firebase 가격 플랜 문서](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Firestore 가격 (Google Cloud)](https://cloud.google.com/firestore/pricing) · [Firestore 사용량·한도](https://firebase.google.com/docs/firestore/quotas)
- [Supabase 공식 가격](https://supabase.com/pricing) · [Supabase vs Firebase (공식)](https://supabase.com/alternatives/supabase-vs-firebase)
- [Supabase Row Level Security 문서](https://supabase.com/docs/guides/database/postgres/row-level-security)

**비교 분석 자료**
- [Bytebase — Supabase vs Firebase: a Complete Comparison in 2026](https://www.bytebase.com/blog/supabase-vs-firebase/)
- [MindStudio — Supabase vs Firebase: Which Backend Should You Build On?](https://www.mindstudio.ai/blog/supabase-vs-firebase)
- [WeWeb — Supabase vs Firebase 2026: Full Comparison for Web Apps](https://www.weweb.io/blog/supabase-vs-firebase-comparison-for-web-apps)
- [DEV Community — Supabase vs Firebase in 2026: The Honest Comparison After Using Both in Production](https://dev.to/pockit_tools/supabase-vs-firebase-in-2026-the-honest-comparison-after-using-both-in-production-3e5)
- [SupaExplorer — Supabase vs Firebase Security: Complete 2026 Comparison](https://supaexplorer.com/compare/supabase-vs-firebase-security)
- [SuperTokens — Firebase Pricing 분석](https://supertokens.com/blog/firebase-pricing)
- [UI Bakery — Supabase Pricing 2026 Breakdown](https://uibakery.io/blog/supabase-pricing)
