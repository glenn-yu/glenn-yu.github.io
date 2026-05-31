---
layout: post
title: "VAST × OpenRTB 완전 해부: 광고 한 번 재생되기까지 벌어지는 일들"
date: 2026-05-31 10:00:00 +0900
categories: [AdTech, VAST, OpenRTB]
tags: [VAST, OpenRTB, RTB, IAB, Video Ads, AdTech, Programmatic, SIMID, VPAID, Tracking, XML, Bidding]
---

광고 한 편이 영상 앞에 재생되기까지 0.1초 안에 어떤 일이 일어날까요?

플레이어가 VAST XML을 파싱하고, 입찰 결과를 기다리며, 수십 개의 트래킹 픽셀을 쏘는 그 모든 과정 뒤에는 IAB Tech Lab이 설계한 두 가지 표준이 있습니다 — **VAST**와 **OpenRTB**. 이 글은 두 표준의 구조를 층층이 뜯어보고, 실제로 함께 어떻게 동작하는지 정리한 기술 레퍼런스입니다.

> 참고 자료: [gwangy.com/docs/vast](https://gwangy.com/docs/vast) (VAST v3.0–v4.2 통합 명세), IAB Tech Lab 공식 VAST/OpenRTB 문서

---

## 1. 두 표준이 하는 일

| 표준 | 역할 | 데이터 형식 |
|------|------|------------|
| **VAST** | 광고 소재(영상·배너·트래킹)를 플레이어에 전달 | XML |
| **OpenRTB** | 광고 인벤토리를 실시간 경매로 사고파는 방법 | JSON |

한 문장으로: **OpenRTB는 "어떤 광고를 살지" 결정하는 시장이고, VAST는 "낙찰된 광고를 어떻게 재생할지" 알려주는 명세서입니다.**

---

## 2. VAST — 광고 소재 전달 명세 (v3.0 ~ v4.2)

### 2.1 버전 역사

| 버전 | 출시 | 핵심 변화 |
|------|------|-----------|
| 3.0 | 2012.06 | Ad Pod(`sequence`), SkipOffset, Companion 강화 |
| 4.0 | 2016.04 | AdServingId 필수화, AdVerifications, ViewableImpression |
| 4.1 | 2018.11 | 오디오 광고(`adType`), SSAI Mezzanine, ClosedCaptions, SIMID 기반 |
| 4.2 | 2019.06 | SIMID 공식 통합(`InteractiveCreativeFile`), 멀티 UniversalAdId |

---

### 2.2 XML 최상위 구조

```xml
<VAST version="4.2" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <Ad id="12345" sequence="1" adType="video">
    <InLine>
      <AdSystem version="1.0">My Ad Server</AdSystem>
      <AdServingId>abcde-12345</AdServingId>   <!-- v4.0+ 필수 -->
      <AdTitle>My Campaign</AdTitle>
      <Impression id="imp1"><![CDATA[https://tracker.example.com/imp]]></Impression>
      <Creatives>
        ...
      </Creatives>
    </InLine>
  </Ad>
</VAST>
```

**`<Ad>`** 는 두 가지 형태만 가질 수 있습니다.

- `<InLine>` — 광고 소재를 직접 포함
- `<Wrapper>` — 외부 광고 서버 URL로 리다이렉션 (체이닝 가능)

`<Wrapper>` 체인이 깊어질수록 레이턴시가 늘어나므로, 플레이어는 보통 최대 3~5 hop 제한을 둡니다.

---

### 2.3 Ad Pod — 연속 광고 재생

Pre-roll 두 편, Mid-roll 한 편처럼 연속 재생 구조를 Ad Pod라 부릅니다.

```xml
<!-- 두 편짜리 Pod -->
<Ad id="pod-1" sequence="1">...</Ad>
<Ad id="pod-2" sequence="2">...</Ad>
```

v4.1부터는 `breakId` / `breakIndex` / `breakType` 속성으로 브레이크 자체를 식별할 수 있습니다.

---

### 2.4 Linear 광고의 핵심 요소

```xml
<Linear>
  <Duration>00:00:30</Duration>
  <SkipOffset>00:00:05</SkipOffset>   <!-- 5초 후 스킵 버튼 -->
  <MediaFiles>
    <MediaFile delivery="progressive" type="video/mp4"
               width="1920" height="1080" bitrate="2000">
      <![CDATA[https://cdn.example.com/ad.mp4]]>
    </MediaFile>
  </MediaFiles>
  <VideoClicks>
    <ClickThrough><![CDATA[https://advertiser.com/landing]]></ClickThrough>
    <ClickTracking><![CDATA[https://tracker.example.com/click]]></ClickTracking>
  </VideoClicks>
  <TrackingEvents>
    <Tracking event="start"><![CDATA[https://t.example.com/start]]></Tracking>
    <Tracking event="firstQuartile"><![CDATA[https://t.example.com/q1]]></Tracking>
    <Tracking event="midpoint"><![CDATA[https://t.example.com/mid]]></Tracking>
    <Tracking event="thirdQuartile"><![CDATA[https://t.example.com/q3]]></Tracking>
    <Tracking event="complete"><![CDATA[https://t.example.com/complete]]></Tracking>
  </TrackingEvents>
</Linear>
```

`<MediaFile>`의 필수 속성은 `type`(MIME), `width`, `height`. 플레이어는 네트워크 상황에 맞는 `bitrate`를 골라 재생합니다.

**SSAI(서버 사이드 광고 삽입)** 환경에서는 `<Mezzanine>` 요소로 트랜스코딩 전 원본 고화질 소재 URL을 제공합니다(v4.0+).

---

### 2.5 TrackingEvents 전체 목록

| 이벤트 | 시점 |
|--------|------|
| `start` | 재생 시작 |
| `firstQuartile` | 25% |
| `midpoint` | 50% |
| `thirdQuartile` | 75% |
| `complete` | 100% (완료) |
| `skip` | 시청자가 스킵 클릭 |
| `pause` / `resume` | 일시 정지 / 재개 |
| `mute` / `unmute` | 음소거 토글 |
| `fullscreen` / `exitFullscreen` | 전체화면 토글 |
| `rewind` | 되감기 |
| `progress` | 임의 시점 (offset 속성 필수) |
| `loaded` | 미디어 로드 완료 (v4.0) |
| `viewable` / `notViewable` | 가시성 판정 결과 |
| `verificationNotExecuted` | 검증 스크립트 미실행 |

---

### 2.6 ViewableImpression — 가시성 트래킹 (v4.0+)

MRC 기준: **50% 이상 면적이 2초 이상** 뷰포트 안에 있을 때 Viewable 판정.

```xml
<ViewableImpression id="vi1">
  <Viewable><![CDATA[https://t.example.com/viewable]]></Viewable>
  <NotViewable><![CDATA[https://t.example.com/not-viewable]]></NotViewable>
  <ViewUndetermined><![CDATA[https://t.example.com/undetermined]]></ViewUndetermined>
</ViewableImpression>
```

---

### 2.7 AdVerifications & OMID (v4.0+)

제3자 측정사가 독립적으로 노출/가시성을 검증하는 구조입니다.

```xml
<AdVerifications>
  <Verification vendor="doubleverify.com-omid">
    <JavaScriptResource apiFramework="omid" browserOptional="true">
      <![CDATA[https://cdn.doubleverify.com/dvtp_src.js]]>
    </JavaScriptResource>
    <VerificationParameters><![CDATA[ctx=1234&cmp=5678]]></VerificationParameters>
  </Verification>
</AdVerifications>
```

`apiFramework="omid"` — IAB Open Measurement SDK를 통한 검증.

---

### 2.8 SIMID — 인터랙티브 광고 (v4.2)

VPAID(JavaScript API 방식)의 보안 문제를 해결하기 위해 SIMID(Secure Interactive Media Interface Definition)가 도입됐습니다. `window.postMessage` 기반으로 플레이어와 SIMID 컨테이너가 통신합니다.

```xml
<InteractiveCreativeFile type="text/html" apiFramework="SIMID"
                          variableDuration="false">
  <![CDATA[https://creative.example.com/simid.html]]>
</InteractiveCreativeFile>
```

`variableDuration="true"`이면 SIMID가 광고 재생 시간을 동적으로 연장/단축할 수 있습니다.

---

### 2.9 Icons — AdChoices 아이콘

```xml
<Icons>
  <Icon program="AdChoices" width="80" height="15"
        xPosition="right" yPosition="top"
        offset="00:00:00" duration="00:01:00" pxratio="2">
    <StaticResource creativeType="image/png">
      <![CDATA[https://example.com/adchoices@2x.png]]>
    </StaticResource>
    <IconViewTracking><![CDATA[https://t.example.com/icon-view]]></IconViewTracking>
    <IconClicks>
      <IconClickThrough><![CDATA[https://adchoices.example.com]]></IconClickThrough>
    </IconClicks>
  </Icon>
</Icons>
```

`pxratio` 속성(v4.1)으로 Retina/고밀도 디스플레이 대응 이미지를 지정합니다.

---

### 2.10 VAST Macros — 28종

플레이어가 트래킹 URL을 호출하기 전 치환해야 하는 동적 값입니다.

| 매크로 | 타입 | 용도 |
|--------|------|------|
| `[TIMESTAMP]` | String | 현재 UTC 시간 |
| `[CONTENTPLAYHEAD]` | Time | 콘텐츠 재생 위치 |
| `[ERRORCODE]` | Integer | 오류 코드 (Error URL에 필수) |
| `[CACHEBUSTING]` | String | 캐시 방지 랜덤 값 |
| `[IFA]` | String | ID for Advertising |
| `[DEVICEUA]` | String | 디바이스 User-Agent |
| `[GDPRCONSENT]` | String | GDPR 동의 문자열 |
| `[USPRIVACY]` | String | US Privacy String |
| `[SERVERSIDE]` | Boolean | SSAI 환경 여부 |
| `[ADSERVINGID]` | String | `<AdServingId>` 값과 동일 |

전체 28종의 공식 목록은 [IAB VAST 4.2 Spec](https://iabtechlab.com/standards/vast/) 참고.

---

### 2.11 Error Codes

| 범위 | 분류 |
|------|------|
| 100–102 | XML 파싱 / 스키마 오류 / 버전 불일치 |
| 200–203 | 광고 없음(NoAd) / Ad Pod 순서 오류 |
| 300–305 | Wrapper 호출 실패 / 타임아웃 / InLine 불일치 |
| 400–410 | 미디어 파일 로드 / 재생 오류 / Mezzanine |
| 500–604 | Non-Linear / Companion 로드 실패 |
| 900–901 | 미정의 치명 오류 / VPAID·SIMID 실행 오류 |

`[ERRORCODE]` 매크로와 함께 `<Error>` URL로 전달됩니다.

```xml
<Error><![CDATA[https://errors.example.com/vast?code=[ERRORCODE]]]></Error>
```

---

## 3. OpenRTB — 실시간 입찰 표준

### 3.1 RTB 흐름 한눈에

```
사용자가 페이지/앱 오픈
      │
      ▼
Publisher SSP ─────── BidRequest ────► DSP 1
                                  ────► DSP 2  (경쟁 입찰)
                                  ────► DSP N
      │
      ◄──────────── BidResponse (낙찰가 + VAST URL or Markup)
      │
      ▼
플레이어: VAST URL 호출 → XML 파싱 → MediaFile 다운로드 → 재생
```

전체 경매 과정이 **100ms 이내**에 끝나야 합니다.

---

### 3.2 버전 역사

| 버전 | 출시 | 핵심 변화 |
|------|------|-----------|
| 2.0 | 2012 | 비디오(VAST 연동) 공식 지원 |
| 2.5 | 2016.12 | 헤더 비딩, IAB New Ad Portfolio, 비디오 배치 타입 |
| 2.6 | 2022.04 | CTV 지원 강화, Ad Pod 속성, GPP 문자열 |
| 3.0 | 2017.09 | 암호화 서명 입찰, AdCOM 분리 |

---

### 3.3 BidRequest 구조 (OpenRTB 2.6, Video)

```json
{
  "id": "req-abc123",
  "imp": [
    {
      "id": "1",
      "video": {
        "mimes": ["video/mp4"],
        "minduration": 5,
        "maxduration": 30,
        "protocols": [3, 6],      // VAST 3.0, VAST 3.0 Wrapper
        "w": 1920,
        "h": 1080,
        "startdelay": 0,          // 0 = Pre-roll
        "placement": 1,           // In-Stream
        "plcmt": 1,
        "playbackmethod": [1],    // 자동 재생, 음소거 해제
        "api": [7]                // OMID
      },
      "bidfloor": 1.50,
      "bidfloorcur": "USD"
    }
  ],
  "site": {
    "page": "https://publisher.com/video/1234",
    "domain": "publisher.com",
    "cat": ["IAB1"]
  },
  "device": {
    "ua": "Mozilla/5.0 ...",
    "ip": "203.0.113.1",
    "language": "ko",
    "ifa": "6D92078A-8246-4BA4-AE5B-76104861E7DC"
  },
  "user": {
    "id": "usr-xyz789"
  },
  "at": 2,       // Second-Price Auction
  "tmax": 100    // 100ms 응답 제한
}
```

---

### 3.4 BidResponse — VAST 연동 핵심

DSP는 두 가지 방식으로 광고 소재를 반환합니다.

**방식 A: VAST URL 반환** (더 일반적)
```json
{
  "id": "req-abc123",
  "seatbid": [
    {
      "bid": [
        {
          "id": "bid-001",
          "impid": "1",
          "price": 3.50,
          "adid": "ad-creative-42",
          "adm": "https://ad.dsp.com/vast?id=42&cb=[CACHEBUSTING]",
          "adomain": ["advertiser.com"],
          "crid": "creative-001",
          "w": 1920,
          "h": 1080
        }
      ]
    }
  ],
  "cur": "USD"
}
```

**방식 B: VAST XML 인라인 반환** (`adm` 필드에 XML 직접 삽입)
```json
{
  "adm": "<VAST version=\"4.2\"><Ad>...</Ad></VAST>"
}
```

URL 방식이 소재 교체·캐싱에 유리하고, 인라인 방식은 Wrapper hop 없이 레이턴시를 줄입니다.

---

### 3.5 `video.protocols` — VAST 버전 매핑

| 값 | 의미 |
|----|------|
| 2 | VAST 2.0 |
| 3 | VAST 3.0 |
| 5 | VAST 2.0 Wrapper |
| 6 | VAST 3.0 Wrapper |
| 7 | VAST 4.0 |
| 8 | VAST 4.0 Wrapper |
| 15 | VAST 4.2 |

여러 값을 배열로 나열해 복수 버전을 허용합니다.

---

### 3.6 `startdelay` — 광고 삽입 시점

| 값 | 의미 |
|----|------|
| 0 | Pre-roll (콘텐츠 시작 전) |
| -1 | Generic Mid-roll |
| -2 | Generic Post-roll |
| N > 0 | N초 시점 Mid-roll |

---

### 3.7 CTV 환경 — OpenRTB 2.6의 Ad Pod

Connected TV에서는 하나의 브레이크에 광고 여러 편이 연속 재생됩니다. OpenRTB 2.6은 이를 위해 `pmp.deals` 내 `podBidId`, `slotinpod` 등 Pod 관련 속성을 추가했습니다.

```json
{
  "imp": [
    { "id": "pod-slot-1", "video": { ... }, "slotinpod": 1 },
    { "id": "pod-slot-2", "video": { ... }, "slotinpod": 2 }
  ]
}
```

VAST 쪽에서는 `<Ad sequence="1">`, `<Ad sequence="2">`로 대응합니다.

---

## 4. VAST × OpenRTB — 연동 전체 시퀀스

```
[1] 사용자: 영상 콘텐츠 재생 요청
[2] 플레이어 → SSP: "pre-roll 30초 슬롯 있음"
[3] SSP → DSP 1,2,N: BidRequest (video.protocols=[7,8,15], startdelay=0)
[4] DSP → SSP: BidResponse (price, adm=VAST URL)
[5] SSP: Second-Price Auction → 낙찰 DSP 결정
[6] SSP → 플레이어: 낙찰된 VAST URL 전달
[7] 플레이어 → VAST URL: GET 요청
[8] Ad Server → 플레이어: VAST XML 반환
[9] 플레이어: XML 파싱
    - <Impression> URL 호출 (노출 카운트)
    - <MediaFile> 선택 후 다운로드
    - <AdVerifications> OMID 스크립트 로드
[10] 광고 재생 시작 → TrackingEvents 순차 호출
     (start → firstQuartile → midpoint → thirdQuartile → complete)
[11] ViewableImpression 판정 후 <Viewable> URL 호출
```

---

## 5. 자주 헷갈리는 개념 정리

### Impression vs ViewableImpression

- `<Impression>`: 광고 XML이 로드된 순간 호출 — **노출 카운트** (가시성 무관)
- `<Viewable>`: MRC 기준(50%/2초) 충족 시 호출 — **가시 노출 카운트**

CTR, CPM 계산에서 어떤 기준을 쓰는지는 캠페인 계약마다 다릅니다.

---

### VPAID vs SIMID

| | VPAID | SIMID |
|-|-------|-------|
| 방식 | JavaScript API (동기) | `postMessage` (비동기) |
| 보안 | 취약 (full JS 접근) | Sandboxed iframe |
| 도입 | v2.0~ | v4.2 공식 채택 |
| 현재 | Deprecated 권고 | 권장 표준 |

---

### BidFloor vs Clearing Price

`bidfloor`은 최저 입찰가이고, Second-Price Auction(at=2)에서 낙찰가(Clearing Price)는 **2위 입찰가 + $0.01**입니다. 플레이어가 받는 `price`는 청구 금액이므로 `adm`의 VAST URL 내 `[CACHEBUSTING]` 매크로를 반드시 치환해야 합니다.

---

## 6. 구현 시 체크리스트

```
VAST 생성 측 (Ad Server / DSP)
  ☐ <AdServingId> 포함 (v4.0+ 필수)
  ☐ <Impression> 최소 1개 포함
  ☐ <Error> URL에 [ERRORCODE] 매크로
  ☐ <MediaFile> width/height/type 모두 명시
  ☐ TrackingEvents: start, 4분위, complete 최소 포함
  ☐ <UniversalAdId> 포함 (v4.0+, 광고 중복 탐지용)
  ☐ Wrapper 체인 3단계 이내 권고

VAST 소비 측 (Video Player)
  ☐ Wrapper 체인 hop 제한 구현
  ☐ tmax 내 응답 없으면 AdError 300 발화
  ☐ [CACHEBUSTING] 매크로 치환 후 URL 호출
  ☐ <Error> URL 호출 시 [ERRORCODE] 치환
  ☐ OMID SDK 초기화 (AdVerifications)
  ☐ ViewableImpression 판정 로직 구현

OpenRTB BidRequest
  ☐ video.protocols 배열 — 지원 VAST 버전 명시
  ☐ video.mimes 배열 — 지원 MIME 타입
  ☐ tmax 설정 (100ms 권장)
  ☐ device.ifa / device.ua 포함
  ☐ 개인정보: regs.ext.gdpr, regs.ext.us_privacy 또는 GPP
```

---

## 7. 마무리

VAST와 OpenRTB는 각자 독립적인 표준이지만, 현실의 광고 생태계에서는 항상 함께 동작합니다. OpenRTB가 경매를 끝내면 VAST가 소재를 배달하고, VAST의 트래킹 픽셀이 다시 다음 입찰의 인사이트가 됩니다.

두 표준 모두 IAB Tech Lab에서 계속 진화 중입니다. VAST는 CTV/오디오 지원을 강화하고, OpenRTB는 프라이버시 규제(GPP, GPDR) 대응 필드를 추가하고 있습니다. 업계 표준을 따라가되, 구현 시에는 항상 **버전 호환성**과 **매크로 치환 누락**에 주의하세요 — 경험상 트래킹 데이터 이상의 절반은 여기서 납니다.

---

**참고 문서**
- [VAST 통합 명세 (gwangy.com)](https://gwangy.com/docs/vast)
- [IAB Tech Lab VAST Standards](https://iabtechlab.com/standards/vast/)
- [IAB Tech Lab OpenRTB Standards](https://iabtechlab.com/standards/openrtb/)
- [OpenRTB 2.6 Spec (PDF)](https://iabtechlab.com/wp-content/uploads/2022/04/OpenRTB-2-6_FINAL.pdf)
- [IAB OMID SDK](https://iabtechlab.com/standards/open-measurement-sdk/)
