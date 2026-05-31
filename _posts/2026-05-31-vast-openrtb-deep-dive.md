---
layout: post
title: "VAST × OpenRTB 완전 해부: 광고 한 편이 0.1초 안에 재생되기까지"
date: 2026-05-31 10:00:00 +0900
categories: [AdTech, VAST, OpenRTB]
tags: [VAST, OpenRTB, AdCOM, RTB, IAB, Video Ads, AdTech, Programmatic, SIMID, VPAID, OMID, CTV, Tracking, XML, Bidding, Header Bidding]
---

영상 콘텐츠 재생 버튼을 누른 순간, 0.1초 안에 어떤 일이 일어날까요?

전 세계 수백 개 DSP가 동시에 입찰가를 던지고, 낙찰자가 결정되며, 그 광고의 XML이 플레이어로 흘러들어와 파싱되고, 미디어가 다운로드되고, 수십 개의 트래킹 픽셀이 발사됩니다. 이 모든 과정의 뒤에는 IAB Tech Lab이 설계한 두 가지 핵심 표준이 있습니다 — **VAST**와 **OpenRTB**.

이 글은 두 표준의 구조를 단순한 개요가 아니라 **공식 명세 수준의 깊이로** 뜯어보는 기술 레퍼런스입니다. 모든 enum 값과 필드는 다음 1차 소스로 교차 검증했습니다.

- [gwangy.com/docs/vast](https://gwangy.com/docs/vast) — VAST v3.0~v4.2 통합 명세
- [IAB Tech Lab — VAST Standards](https://iabtechlab.com/standards/vast/)
- [IAB Tech Lab — OpenRTB 2.6 Spec](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md)
- [IAB Tech Lab — AdCOM v1.0 FINAL](https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/master/AdCOM%20v1.0%20FINAL.md)

> **Fact-check 노트**: OpenRTB 2.6의 enum(protocol/placement/playbackmethod 등)은 모두 **AdCOM 1.0 사양으로 분리**되어 관리됩니다. 이 글의 모든 enum 표는 AdCOM 1.0 FINAL에서 직접 추출한 값입니다.

---

## 1. 두 표준의 역할 한눈에

| 표준 | 책임 | 데이터 형식 | 관리 주체 | 최신 버전 |
|------|------|------------|----------|----------|
| **VAST** | 광고 소재(영상·배너·트래킹) 명세 → 플레이어 전달 | XML | IAB Tech Lab Digital Video TWG | 4.3 (2022-12), CTV 2024 (2024-07) |
| **OpenRTB** | 광고 인벤토리 실시간 경매 프로토콜 | JSON | IAB Tech Lab Programmatic TWG | 2.6 (2024 업데이트 포함), 3.0 |
| **AdCOM** | OpenRTB·OpenDirect 공통 객체·enum 사전 | JSON | IAB Tech Lab | 1.0 FINAL |
| **OMID** | 광고 가시성·검증 측정 SDK | Native (iOS/Android/Web) | IAB Tech Lab | OM SDK 1.5+ |

**한 문장 요약**: OpenRTB는 "어떤 광고를 살까"를 결정하는 시장이고, VAST는 "낙찰된 광고를 어떻게 재생하고 추적할까"를 알려주는 명세서입니다. AdCOM은 둘이 함께 쓰는 공용 사전이고, OMID는 결과를 측정하는 도구입니다.

---

## 2. VAST 상세 — 광고 소재 전달 명세

### 2.1 버전 진화

| 버전 | 출시 (IAB Tech Lab) | 핵심 변화 |
|------|---------------------|-----------|
| 3.0 | 2012-07 | Ad Pod(`sequence`), SkipOffset, Companion 강화, ViewableImpression 도입 직전 단계 |
| 4.0 | 2016-01 | `AdServingId` 필수화, `UniversalAdId`, `AdVerifications`, `ViewableImpression`, `Mezzanine`(SSAI) |
| 4.1 | 2017-08 | 오디오 광고(`adType="audio"`), `ClosedCaptionFiles`, `ExecutableResource` 검증, SSAI 강화 |
| 4.2 | 2019-06 | `InteractiveCreativeFile`(SIMID 공식 채택), 멀티 `UniversalAdId`, `BlockedAdCategories` |
| 4.3 | 2022-12 | CTV 지원 강화, 추가 `ConditionalAd` 옵션, 광고 추적 개선 |
| CTV 2024 | 2024-07 | ACIF 지원, DSA 아이콘, 고해상도 크리에이티브 |

> **사실 확인**: IAB Tech Lab의 공식 [VAST Standards 페이지](https://iabtechlab.com/standards/vast/)에 명시된 출시일 기준. 일부 자료는 VAST 4.0을 2016-04 또는 2016-10으로 표기하나, IAB Tech Lab 공식 페이지의 표기를 따랐습니다.

---

### 2.2 XML 최상위 구조

```xml
<VAST version="4.2" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <Ad id="12345" sequence="1" adType="video" conditionalAd="false">
    <InLine>
      <AdSystem version="1.0">My Ad Server</AdSystem>
      <AdServingId>a532d16d-4d7f-4440-bd29-2ec0e693fc80</AdServingId>
      <AdTitle>My Campaign 2026 Q2</AdTitle>
      <Impression id="imp1"><![CDATA[https://tracker.example.com/imp]]></Impression>
      <Pricing model="CPM" currency="USD">3.50</Pricing>
      <Creatives>
        ...
      </Creatives>
    </InLine>
  </Ad>
</VAST>
```

`<Ad>` 는 두 가지 형태만 가질 수 있습니다.

| 형태 | 의미 | 사용 시나리오 |
|------|------|--------------|
| `<InLine>` | 광고 소재를 직접 포함 | 자체 광고 서버, 최종 단계 응답 |
| `<Wrapper>` | 외부 광고 서버 URL로 리다이렉트 (체이닝) | 광고 네트워크 중개, DSP→SSP 변환 |

**Wrapper 체인 권고 한계**: 일반적으로 3~5 hop. 깊어질수록 레이턴시·실패율이 누적되며, VAST 4.x에서는 `Wrapper@followAdditionalWrappers="false"`로 명시적으로 차단할 수 있습니다.

---

### 2.3 `<Ad>` 속성 전체 (v3.0 ~ v4.2)

| 속성 | 도입 버전 | 자료형 | 설명 |
|------|----------|--------|------|
| `id` | 3.0 | String | 광고 식별자 |
| `sequence` | 3.0 | Integer | Ad Pod 내 재생 순서 (1부터) |
| `conditionalAd` | 4.0 | Boolean | 조건부 노출 광고 여부 |
| `adType` | 4.1 | Enum | `video` / `audio` (기본 `video`) |
| `breakId` | 4.1 | String | 광고 브레이크 식별자 |
| `breakIndex` | 4.1 | Integer | 브레이크 내 광고 인덱스 (1-based) |
| `breakType` | 4.1 | Enum | `linear` / `nonlinear` / `both` |

---

### 2.4 Metadata 요소 전체

| 요소 | 도입 | 자료형 | 필수 위치 | 설명 |
|------|------|--------|----------|------|
| `<AdSystem>` | 3.0 | String + `version` | InLine, Wrapper | 광고 시스템 명칭 |
| `<AdServingId>` | 4.0 | UUID String | **InLine 필수** | 광고 세션 전역 고유 ID |
| `<AdTitle>` | 3.0 | String | **InLine 필수** | 캠페인 제목 |
| `<Description>` | 3.0 | String | 선택 | 광고 상세 설명 |
| `<Advertiser>` | 3.0 | String | 선택 | 광고주명 |
| `<Pricing>` | 3.0 | Decimal + `model`/`currency` | 선택 | 가격(CPM/CPC/CPE/CPV) |
| `<Survey>` | 3.0 | URL | 선택 | 외부 설문 URL |
| `<Category>` | 4.0 | String + `authority` 필수 | 선택 | 업종 카테고리 |
| `<UniversalAdId>` | 4.0 | String + `idRegistry` | **InLine 필수** | 광고 전역 고유 식별자 (Ad-ID, ClearAd 등) |
| `<BlockedAdCategories>` | 4.2 | Element | 선택 | 노출 제한 카테고리 (Wrapper에서 주로 사용) |
| `<Expires>` | 4.1 | Integer (초) | 선택 | 캐시 유효 시간 |
| `<Extensions>` | 3.0 | Element | 선택 | 표준 외 데이터 컨테이너 |

---

### 2.5 Linear 광고 — MediaFile 전체 속성

```xml
<Linear>
  <Duration>00:00:30</Duration>
  <SkipOffset>00:00:05</SkipOffset>
  <MediaFiles>
    <MediaFile delivery="progressive" type="video/mp4"
               width="1920" height="1080" bitrate="2000"
               minBitrate="1500" maxBitrate="3000"
               scalable="true" maintainAspectRatio="true"
               codec="avc1.4D401E" fileSize="7500000">
      <![CDATA[https://cdn.example.com/ad.mp4]]>
    </MediaFile>
    <Mezzanine type="video/mp4" delivery="progressive"
               width="3840" height="2160" codec="hevc">
      <![CDATA[https://cdn.example.com/ad-mezzanine.mp4]]>
    </Mezzanine>
    <InteractiveCreativeFile type="text/html"
                              apiFramework="SIMID"
                              variableDuration="false">
      <![CDATA[https://creative.example.com/simid.html]]>
    </InteractiveCreativeFile>
    <ClosedCaptionFiles>
      <ClosedCaptionFile type="text/vtt" language="ko">
        <![CDATA[https://cdn.example.com/captions-ko.vtt]]>
      </ClosedCaptionFile>
    </ClosedCaptionFiles>
  </MediaFiles>
</Linear>
```

**`<MediaFile>` 속성 표:**

| 속성 | 도입 | 필수 | 설명 |
|------|------|:----:|------|
| `delivery` | 3.0 | ✅ | `progressive` 또는 `streaming` |
| `type` | 3.0 | ✅ | MIME 타입 (예: `video/mp4`, `video/webm`) |
| `width` | 3.0 | ✅ | 픽셀 |
| `height` | 3.0 | ✅ | 픽셀 |
| `bitrate` | 3.0 | 권장 | kbps |
| `minBitrate` / `maxBitrate` | 3.0 | 선택 | 가변 비트레이트 범위 |
| `scalable` | 3.0 | 선택 | 확대 허용 |
| `maintainAspectRatio` | 3.0 | 선택 | 종횡비 유지 |
| `codec` | 4.1 | 권장 | RFC 4281/6381 (예: `avc1.4D401E`) |
| `fileSize` | 4.1 | 권장 | Bytes |
| `apiFramework` | 3.0 | 선택 | `VPAID`, `SIMID`, `MRAID` 등 |
| `mediaType` | 4.0 | 선택 | `2D` / `3D` / `360` (VR 지원) |

**Mezzanine** (v4.0): SSAI(서버 사이드 광고 삽입) 환경에서 트랜스코딩 전 원본 고화질 소재. v4.1에서는 코덱·해상도 권장 사양이 추가되었습니다.

---

### 2.6 SkipOffset 형식

| 값 | 의미 | 예 |
|----|------|-----|
| `HH:MM:SS` 또는 `HH:MM:SS.mmm` | 절대 시간 | `00:00:05` = 5초 후 |
| `nn%` | 광고 길이 대비 비율 | `25%` = 25% 지점 |

---

### 2.7 TrackingEvents — 전체 enum

| 이벤트 | 도입 | 시점 / 설명 |
|--------|------|------------|
| `start` | 3.0 | 광고 재생 시작 |
| `firstQuartile` | 3.0 | 25% 지점 |
| `midpoint` | 3.0 | 50% 지점 |
| `thirdQuartile` | 3.0 | 75% 지점 |
| `complete` | 3.0 | 100% (완료) |
| `skip` | 3.0 | 시청자 스킵 클릭 |
| `pause` | 3.0 | 일시 정지 |
| `resume` | 3.0 | 재개 |
| `mute` | 3.0 | 음소거 |
| `unmute` | 3.0 | 음소거 해제 |
| `rewind` | 3.0 | 되감기 |
| `fullscreen` | 3.0 | 전체화면 진입 (Deprecated v4.0 — `playerExpand` 사용 권장) |
| `exitFullscreen` | 3.0 | 전체화면 종료 (Deprecated v4.0 — `playerCollapse` 사용 권장) |
| `playerExpand` | 4.0 | 플레이어 확대 (fullscreen 대체) |
| `playerCollapse` | 4.0 | 플레이어 축소 |
| `progress` | 3.0 | 임의 시점 (`offset` 속성 필수) |
| `closeLinear` | 3.0 | 종료 버튼 클릭 |
| `loaded` | 4.0 | 미디어 로드 완료 |
| `acceptInvitation` | 3.0 | NonLinear 광고 초대 수락 |
| `acceptInvitationLinear` | 3.0 | Linear 광고 초대 수락 |
| `viewable` | 4.0 | ViewableImpression 판정 결과 |
| `notViewable` | 4.0 | 가시성 미충족 |
| `viewUndetermined` | 4.0 | 판정 불가 |
| `verificationNotExecuted` | 4.1 | 검증 스크립트 미실행 |
| `interactiveStart` | 4.2 | SIMID 인터랙티브 시작 |

---

### 2.8 ViewableImpression — MRC 기준

```xml
<ViewableImpression id="vi1">
  <Viewable><![CDATA[https://t.example.com/viewable]]></Viewable>
  <NotViewable><![CDATA[https://t.example.com/not-viewable]]></NotViewable>
  <ViewUndetermined><![CDATA[https://t.example.com/undetermined]]></ViewUndetermined>
</ViewableImpression>
```

**MRC(Media Rating Council) Viewability 기준 — 비디오:**

| 기준 | 디스플레이 | 비디오 | 모바일 |
|------|-----------|--------|--------|
| 픽셀 노출 | 50% | 50% | 50% |
| 노출 시간 | 1초 | **2초 연속** | 동일 |
| 대형 광고 (242,500px² 이상) | 30% 1초 | - | - |

---

### 2.9 AdVerifications & OMID (v4.0+)

제3자 측정사가 OMID(Open Measurement Interface Definition) SDK를 통해 독립 검증을 수행합니다.

```xml
<AdVerifications>
  <Verification vendor="doubleverify.com-omid">
    <JavaScriptResource apiFramework="omid" browserOptional="true">
      <![CDATA[https://cdn.doubleverify.com/dvtp_src.js]]>
    </JavaScriptResource>
    <ExecutableResource apiFramework="omid" type="application/x-javascript">
      <![CDATA[https://cdn.doubleverify.com/native.so]]>
    </ExecutableResource>
    <TrackingEvents>
      <Tracking event="verificationNotExecuted">
        <![CDATA[https://t.doubleverify.com/no-exec]]>
      </Tracking>
    </TrackingEvents>
    <VerificationParameters><![CDATA[ctx=1234&cmp=5678]]></VerificationParameters>
  </Verification>
</AdVerifications>
```

| 요소 | 도입 | 설명 |
|------|------|------|
| `vendor` 속성 | 4.0 | 검증 업체 식별자 (필수) |
| `<JavaScriptResource>` | 4.0 | OMID JS 측정 파일 |
| `<ExecutableResource>` | 4.1 | 네이티브(iOS/Android) 실행 파일 |
| `<VerificationParameters>` | 4.0 | 측정사 전달 파라미터 |
| `browserOptional` 속성 | 4.1 | `true`면 브라우저 없이도 실행 가능 |

---

### 2.10 SIMID vs VPAID — 인터랙티브 광고 변천사

| 항목 | VPAID 2.0 | SIMID 1.1 |
|------|-----------|-----------|
| 통신 방식 | JavaScript API (동기 호출) | `window.postMessage` (비동기) |
| 보안 모델 | 플레이어와 동일 컨텍스트 (full JS 접근) | Sandboxed iframe 격리 |
| 표준화 주체 | IAB | IAB Tech Lab |
| VAST 도입 | 3.0~ | **4.2 공식 채택** |
| AdCOM apiFramework 값 | 1, 2 | 8, 9 |
| 현재 권고 | **Deprecated** (Google Ads Manager 2022 종료) | **권장 표준** |
| `variableDuration` 지원 | 불가 | 가능 (v4.2) |

```xml
<!-- SIMID 선언 -->
<InteractiveCreativeFile type="text/html"
                          apiFramework="SIMID"
                          variableDuration="false">
  <![CDATA[https://creative.example.com/simid.html]]>
</InteractiveCreativeFile>
```

---

### 2.11 Icons — AdChoices / DSA

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
      <IconClickTracking><![CDATA[https://t.example.com/icon-click]]></IconClickTracking>
      <IconClickFallbackImages>
        <IconClickFallbackImage width="400" height="150">
          <AltText>AdChoices Info</AltText>
          <StaticResource creativeType="image/png">
            <![CDATA[https://example.com/fallback.png]]>
          </StaticResource>
        </IconClickFallbackImage>
      </IconClickFallbackImages>
    </IconClicks>
  </Icon>
</Icons>
```

| 속성 | 자료형 | 설명 |
|------|--------|------|
| `program` | String | 식별자 (예: `AdChoices`, `DSA`, `EUWebChoices`) — **필수** |
| `width` / `height` | Integer | 픽셀 |
| `xPosition` | `left`/`right`/숫자(px) | 가로 위치 |
| `yPosition` | `top`/`bottom`/숫자(px) | 세로 위치 |
| `offset` | Time | 노출 시작 시각 |
| `duration` | Time | 노출 지속 시간 |
| `pxratio` | Decimal (4.1+) | 픽셀 밀도 비율 |
| `apiFramework` | String | 인터랙션 프레임워크 |

---

### 2.12 VAST Macros — 28종 전체 (v4.2 기준)

VAST 매크로는 **`[BRACKET]`** 형식이며, 플레이어가 트래킹 URL을 호출하기 **직전에 치환**합니다. OpenRTB의 `${DOLLAR}` 매크로와 **다른 시스템**입니다.

**시간/카운트 매크로:**

| 매크로 | 자료형 | 설명 |
|--------|--------|------|
| `[TIMESTAMP]` | ISO 8601 String | 현재 UTC 시간 |
| `[CONTENTPLAYHEAD]` | Time `HH:MM:SS.mmm` | 콘텐츠 현재 재생 위치 |
| `[MEDIAPLAYHEAD]` | Time | 광고 미디어 현재 재생 위치 |
| `[BREAKPOSITION]` | Integer | 광고 브레이크 순번 (1=Pre, 2=Mid 등) |
| `[ADPLAYHEAD]` | Time | 광고 자체 재생 위치 |
| `[CACHEBUSTING]` | 8자리 Integer | 캐시 방지 랜덤 값 |

**식별 매크로:**

| 매크로 | 자료형 | 설명 |
|--------|--------|------|
| `[UNIVERSALADID]` | String | `<UniversalAdId>` 값과 동일 |
| `[ADSERVINGID]` | UUID String | `<AdServingId>` 값과 동일 (v4.0+) |
| `[ADCATEGORIES]` | String | 광고 카테고리 (CSV) |
| `[BLOCKEDADCATEGORIES]` | String | 차단된 카테고리 (v4.2) |
| `[PODSEQUENCE]` | Integer | Pod 내 현재 광고 순번 (v4.1) |
| `[ADCOUNT]` | Integer | 응답 내 총 광고 수 |
| `[ADTYPE]` | String | `video` / `audio` / `hybrid` (v4.1) |

**디바이스/사용자 매크로:**

| 매크로 | 자료형 | 설명 |
|--------|--------|------|
| `[IFA]` | UUID String | Identifier for Advertising (IDFA/AAID) |
| `[IFATYPE]` | String | `idfa` / `aaid` / `rida` / `tifa` 등 |
| `[DEVICEUA]` | URL-encoded String | User-Agent 문자열 |
| `[DEVICEIP]` | String | 디바이스 IP (보통 서버측만) |
| `[LATLONG]` | `lat,long` String | 위치 |
| `[APPBUNDLE]` | String | 앱 번들 ID |
| `[DOMAIN]` | String | Publisher 도메인 |
| `[PAGEURL]` | URL String | 현재 페이지 URL |
| `[VASTVERSIONS]` | Integer Array | 지원 VAST 버전 |
| `[APIFRAMEWORKS]` | Integer Array | 지원 API 프레임워크 (AdCOM 값) |

**프라이버시 매크로:**

| 매크로 | 자료형 | 설명 |
|--------|--------|------|
| `[GDPRCONSENT]` | TCF String | TCF v2.x 동의 문자열 |
| `[USPRIVACY]` | String | CCPA US Privacy String |
| `[LIMITADTRACKING]` | Boolean | OS 광고 추적 제한 상태 |
| `[REGULATIONS]` | String | 적용 규제 (`GDPR`, `COPPA` 등) |

**이벤트/상태 매크로:**

| 매크로 | 자료형 | 설명 |
|--------|--------|------|
| `[ERRORCODE]` | Integer | `<Error>` URL에 **필수** |
| `[REASON]` | Integer | 스킵/종료 사유 |
| `[CLICKPOS]` | `x,y` String | 클릭 좌표 |
| `[CLICKTYPE]` | String | 클릭 방식 (예: `tap`, `key`) |
| `[PLAYERSTATE]` | String | `fullscreen`/`autoplay`/`muted` (다중 가능) |
| `[PLAYERSIZE]` | `width,height` | 플레이어 크기 |
| `[CONTENTID]` | String | 콘텐츠 식별자 |
| `[TRANSACTIONID]` | UUID String | 트랜잭션 ID |
| `[INVENTORYSTATE]` | String | 인벤토리 상태 |
| `[SERVERSIDE]` | Boolean | SSAI 환경 여부 |
| `[ADCID]` | String | 광고 식별자 (DSP 측) |
| `[ADCAID]` | String | 광고 자산 식별자 |

> **참고**: 매크로의 정식 카탈로그는 별도 라이브 문서로 관리됩니다 → [vast4-macros-latest](https://interactiveadvertisingbureau.github.io/vast/vast4macros/vast4-macros-latest.html). 신규 매크로는 IAB Tech Lab의 Working Group 승인 후 추가됩니다.

---

### 2.13 Error Codes — 전체 분류

| 코드 | 분류 | 의미 |
|------|------|------|
| 100 | XML | 파싱 오류 |
| 101 | XML | 스키마 검증 실패 |
| 102 | XML | 지원하지 않는 VAST 버전 |
| 200 | Trafficking | 트래픽 정책 위반 |
| 201 | Trafficking | Linear가 NonLinear로 와야 함 |
| 202 | Trafficking | NonLinear가 Linear로 와야 함 |
| 203 | Trafficking | Companion 광고 누락 |
| 300 | Wrapper | 일반 Wrapper 오류 |
| 301 | Wrapper | 호출 타임아웃 / 응답 없음 |
| 302 | Wrapper | Wrapper 한계 도달 (체인 깊이 초과) |
| 303 | Wrapper | NoAd 응답 |
| 304 | Wrapper | InLine 응답이 광고 미포함 |
| 305 | Wrapper | VAST 응답이 v4.1 미지원 |
| 400 | Media | 일반 Linear 광고 오류 |
| 401 | Media | 호환되는 MediaFile 미발견 |
| 402 | Media | MediaFile 다운로드 타임아웃 |
| 403 | Media | 지원 MediaFile 없음 |
| 405 | Media | 표시 가능한 MediaFile 없음 |
| 406 | Media | Mezzanine 누락 (SSAI) |
| 407 | Media | Mezzanine 다운로드 진행 중 (v4.1) |
| 408 | Media | 조건부 광고 거부 |
| 409 | Media | 인터랙티브 단위 응답 없음 |
| 410 | Media | Mezzanine 트랜스코딩 중 (v4.1) |
| 500 | NonLinear | 일반 NonLinear 광고 오류 |
| 501 | NonLinear | NonLinear 리소스 크기 불일치 |
| 502 | NonLinear | NonLinear 리소스 가져오기 실패 |
| 503 | NonLinear | 표시 가능한 NonLinear 리소스 없음 |
| 600 | Companion | 일반 Companion 광고 오류 |
| 601 | Companion | Companion 크기 미지원 |
| 602 | Companion | Companion 표시 불가 (필수 자원 미수신) |
| 603 | Companion | Companion 리소스 가져오기 실패 |
| 604 | Companion | 표시 가능한 Companion 없음 |
| 900 | Undefined | 정의되지 않은 치명적 오류 |
| 901 | VPAID/SIMID | 일반 실행 오류 |

**`<Error>` URL 사용법:**

```xml
<Error><![CDATA[https://errors.example.com/vast?code=[ERRORCODE]&aid=[ADSERVINGID]]]></Error>
```

---

## 3. OpenRTB 상세 — 실시간 입찰 표준

### 3.1 버전 진화

| 버전 | 출시 | 핵심 변화 |
|------|------|-----------|
| 1.0 | 2010 | 초기 디스플레이 RTB |
| 2.0 | 2012 | 비디오(VAST 연동) 공식 지원 |
| 2.3 | 2015 | Native 광고 |
| 2.4 | 2016 | Multi-Imp 입찰 |
| 2.5 | 2016-12 | 헤더 비딩, 비디오 배치 타입, IAB New Ad Portfolio |
| 2.6 | 2022-04 | **CTV 지원 강화** (Ad Pod, Network/Channel 객체), GPP |
| 2.6-202303 | 2023-03 | `placement` Deprecated → `plcmt`, Pod Deduplication |
| 3.0 | 2017-09 | 암호화 서명 입찰 / AdCOM 1.0 분리 / Ads.txt 통합 |

> **사실 확인**: 3.0이 2017년에 먼저 나왔지만, 산업 표준은 여전히 2.x 계열입니다 (특히 2.5와 2.6). 3.0은 호환성·전환 비용 문제로 광범위하게 채택되지 못했습니다.

---

### 3.2 RTB 흐름 시퀀스

```
[1] 사용자가 영상 콘텐츠 재생
[2] Publisher 페이지/앱 → Ad Server (SSP)
[3] SSP가 BidRequest 생성
       │
       ├──→ DSP #1
       ├──→ DSP #2     (병렬 송신, tmax 내 응답 대기)
       ├──→ DSP #3
       └──→ DSP #N
              │
              ↓ BidResponse (price, adm=VAST URL or XML)
       │
[4] SSP: Second-Price Plus Auction → 낙찰자 결정
[5] SSP → 플레이어: 낙찰된 VAST URL/XML 전달
[6] 플레이어 → VAST 파싱 → MediaFile 다운로드 → 재생
[7] 플레이어 → DSP: nurl/burl 호출 (Win/Billing notice)
[8] 플레이어 → 트래킹: Impression, TrackingEvents 발화
```

**전체 경매 시한**: `BidRequest.tmax` (보통 80~120ms). 이 시간 내에 응답 못 한 DSP는 자동 탈락.

---

### 3.3 BidRequest 최상위 객체 — 핵심 필드

| 필드 | 자료형 | 필수 | 설명 |
|------|--------|:----:|------|
| `id` | String | ✅ | 경매 고유 ID |
| `imp` | Imp[] | ✅ | 광고 슬롯 배열 (최소 1) |
| `site` | Site Object | 권장 | 웹 환경 |
| `app` | App Object | 권장 | 앱 환경 |
| `dooh` | DOOH Object | 선택 | 디지털 옥외광고 |
| `device` | Device Object | 권장 | 디바이스 정보 |
| `user` | User Object | 권장 | 사용자 정보 |
| `test` | Integer | 기본 0 | 테스트 모드 (1=test) |
| `at` | Integer | 기본 2 | 경매 타입: 1=First Price, 2=Second Price Plus, 500+ = 거래소 정의 |
| `tmax` | Integer (ms) | - | 최대 응답 대기 시간 |
| `wseat` | String[] | - | 허용 buyer seat ID |
| `bseat` | String[] | - | 차단 buyer seat ID |
| `cur` | String[] | - | 허용 통화 (ISO-4217) |
| `bcat` | String[] | - | 차단 광고 카테고리 |
| `badv` | String[] | - | 차단 광고주 도메인 |
| `bapp` | String[] | - | 차단 앱 번들 ID |
| `source` | Source Object | - | 인벤토리 소스 / SupplyChain |
| `regs` | Regs Object | - | 규제 정보 (GDPR, COPPA, GPP) |

**`site` vs `app` vs `dooh`**: 셋 중 하나만 사용 (mutually exclusive).

---

### 3.4 Imp Object — 핵심 필드

| 필드 | 자료형 | 설명 |
|------|--------|------|
| `id` | String, 필수 | 광고 슬롯 ID (보통 "1"부터) |
| `banner` / `video` / `audio` / `native` | Object | 광고 타입 (혼합 가능) |
| `pmp` | Pmp Object | Private Marketplace 거래 |
| `displaymanager` | String | SDK/플레이어 명 |
| `displaymanagerver` | String | SDK 버전 |
| `instl` | Integer | 1=interstitial/전체화면 |
| `tagid` | String | 광고 태그 식별자 |
| `bidfloor` | Float | 최저 입찰가 (CPM) |
| `bidfloorcur` | String | 통화 (기본 "USD") |
| `secure` | Integer | 1=HTTPS 필수 |
| `rwdd` | Integer | 1=보상형 광고 |
| `ssai` | Integer | 0=unknown, 1=client-side, 2=hybrid, 3=server-side |
| `exp` | Integer | 경매 후 노출까지 허용 초 |

---

### 3.5 Video Object — 핵심 필드 (OpenRTB 2.6)

| 필드 | 자료형 | 설명 |
|------|--------|------|
| `mimes` | String[], **필수** | 지원 MIME (예: `["video/mp4"]`) |
| `minduration` / `maxduration` | Integer (초) | 광고 길이 범위 |
| `rqddurs` | Integer[] | 정확한 허용 길이 (Live TV용, min/max와 상호배타) |
| `startdelay` | Integer | 광고 위치 (값 표 ↓) |
| `protocols` | Integer[] | 지원 VAST 버전 (AdCOM Creative Subtypes ↓) |
| `w` / `h` | Integer | 플레이어 크기 (DIPS) |
| `placement` | Integer | **Deprecated** (2.6-202303), `plcmt` 사용 |
| `plcmt` | Integer | Plcmt Subtypes (값 표 ↓) |
| `linearity` | Integer | 1=Linear, 2=Non-Linear |
| `skip` | Integer | 1=skippable |
| `skipmin` | Integer | 스킵 가능 최소 광고 길이 |
| `skipafter` | Integer | 스킵 버튼 노출까지 초 |
| `minbitrate` / `maxbitrate` | Integer (kbps) | 비트레이트 범위 |
| `playbackmethod` | Integer[] | 재생 방식 (값 표 ↓) |
| `playbackend` | Integer | 재생 종료 시점 (값 표 ↓) |
| `delivery` | Integer[] | 1=streaming, 2=progressive, 3=download |
| `api` | Integer[] | API Frameworks (값 표 ↓) |
| `companionad` | Banner[] | Companion 광고 |
| `companiontype` | Integer[] | 1=Static, 2=HTML, 3=iframe |
| `podid` | String | Ad Pod 식별자 |
| `podseq` | Integer | Pod 시퀀스: -1=마지막, 0=임의, 1=첫 번째 |
| `slotinpod` | Integer | Pod 내 슬롯: -1=마지막, 0=임의, 1=첫번째, 2=첫·마지막 |
| `maxseq` | Integer | Dynamic Ad Pod 최대 광고 수 |
| `poddur` | Integer (초) | Dynamic Pod 총 시간 |
| `mincpmpersec` | Float | 초당 최소 CPM (Dynamic Pod) |
| `boxingallowed` | Integer | 기본 1, 4:3→16:9 letterboxing 허용 |
| `pos` | Integer | 화면 위치 (Placement Positions) |

---

### 3.6 AdCOM Enum — Creative Subtypes (= `video.protocols`)

| 값 | 정의 | 값 | 정의 |
|:--:|------|:--:|------|
| 1 | VAST 1.0 | 9 | DAAST 1.0 |
| 2 | VAST 2.0 | 10 | DAAST 1.0 Wrapper |
| 3 | VAST 3.0 | 11 | VAST 4.1 |
| 4 | VAST 1.0 Wrapper | 12 | VAST 4.1 Wrapper |
| 5 | VAST 2.0 Wrapper | 13 | VAST 4.2 |
| 6 | VAST 3.0 Wrapper | 14 | VAST 4.2 Wrapper |
| 7 | VAST 4.0 | **15** | **VAST 4.3** |
| 8 | VAST 4.0 Wrapper | 16 | VAST 4.3 Wrapper |

> ⚠️ **주의**: 일부 자료가 `15`를 VAST 4.2로 잘못 표기하는 경우가 있습니다. AdCOM 1.0 FINAL 기준 **15 = VAST 4.3**입니다.

---

### 3.7 AdCOM Enum — Plcmt Subtypes (= `video.plcmt`)

2023년 3월 업데이트로 기존 `placement` 필드가 Deprecated되고 `plcmt`로 대체되었습니다.

| 값 | 정의 | 핵심 조건 |
|:--:|------|----------|
| 1 | **Instream** | Pre/Mid/Post-roll. 기본 sound-on. 비디오가 페이지의 주요 콘텐츠. |
| 2 | **Accompanying Content** | 영상 콘텐츠 부속 재생. 뷰포트 진입 시 재생 시작. |
| 3 | **Interstitial** | 콘텐츠 없이 단독 재생. 화면 대부분 차지. |
| 4 | **No Content / Standalone** | 콘텐츠 없는 단독 재생 (슬라이드쇼, 네이티브 피드, 스티키 등) |

---

### 3.8 AdCOM Enum — API Frameworks (= `video.api`)

| 값 | 정의 | 비고 |
|:--:|------|------|
| 1 | VPAID 1.0 | Deprecated |
| 2 | VPAID 2.0 | Deprecated (2022~) |
| 3 | MRAID 1.0 | 모바일 리치미디어 |
| 4 | ORMMA | Deprecated |
| 5 | MRAID 2.0 | |
| 6 | MRAID 3.0 | 최신 MRAID |
| 7 | **OMID 1.0** | Open Measurement — 가시성 검증 |
| 8 | **SIMID 1.0** | VPAID 후속 |
| 9 | **SIMID 1.1** | 최신 인터랙티브 |
| 500+ | Vendor-specific | 거래소 정의 |

---

### 3.9 AdCOM Enum — Start Delay Modes (= `video.startdelay`)

| 값 | 의미 |
|:--:|------|
| > 0 | Mid-Roll (값 = 시작 지연 초) |
| 0 | Pre-Roll |
| -1 | Generic Mid-Roll |
| -2 | Generic Post-Roll |

---

### 3.10 AdCOM Enum — Playback Methods (= `video.playbackmethod`)

| 값 | 정의 |
|:--:|------|
| 1 | Page Load 시 자동 재생, **Sound On** |
| 2 | Page Load 시 자동 재생, Sound Off (기본) |
| 3 | 클릭 시 재생, Sound On |
| 4 | Mouse-Over 시 재생, Sound On |
| 5 | Viewport 진입 시 재생, Sound On |
| 6 | Viewport 진입 시 재생, Sound Off (기본) |
| 7 | Continuous Playback (플레이리스트 자동 연속 재생) |

---

### 3.11 AdCOM Enum — Playback Cessation Modes (= `video.playbackend`)

| 값 | 정의 |
|:--:|------|
| 1 | 비디오 완료 또는 사용자 종료 시 |
| 2 | Viewport 벗어남 또는 사용자 종료 시 |
| 3 | Viewport 벗어나면 Floating/Slider로 계속, 완료/사용자 종료까지 |

---

### 3.12 AdCOM Enum — Slot Position in Pod (= `video.slotinpod`)

| 값 | 정의 |
|:--:|------|
| -1 | Pod 내 마지막 광고 |
| 0 | Pod 내 임의 광고 |
| 1 | Pod 내 첫 번째 광고 |
| 2 | Pod 내 첫 번째 또는 마지막 광고 |

---

### 3.13 BidRequest 실전 예시 (Video, OpenRTB 2.6 공식 예시 인용)

```json
{
  "id": "1234567893",
  "at": 2,
  "tmax": 120,
  "imp": [{
    "id": "1",
    "bidfloor": 0.03,
    "video": {
      "w": 640,
      "h": 480,
      "pos": 1,
      "startdelay": 0,
      "minduration": 5,
      "maxduration": 30,
      "maxextended": 30,
      "minbitrate": 300,
      "maxbitrate": 1500,
      "apis": [1, 2],
      "protocols": [2, 3],
      "mimes": ["video/x-flv", "video/mp4", "application/javascript"],
      "linearity": 1,
      "boxingallowed": 1,
      "playbackmethod": [1, 3],
      "delivery": [2],
      "battr": [13, 14],
      "companionad": [
        {
          "id": "1234567893-1",
          "w": 300, "h": 250, "pos": 1,
          "battr": [13, 14],
          "expdir": [2, 4]
        }
      ],
      "companiontype": [1, 2]
    }
  }],
  "site": {
    "id": "1345135123",
    "name": "Site ABCD",
    "domain": "siteabcd.com",
    "page": "http://siteabcd.com/page.htm",
    "publisher": {"id": "pub12345", "name": "Publisher A"}
  }
}
```

(출처: OpenRTB 2.6 Spec §6.2.4 Example 4 – Video)

---

### 3.14 Bid Object — BidResponse 핵심 필드

| 필드 | 자료형 | 설명 |
|------|--------|------|
| `id` | String, **필수** | DSP 측 입찰 ID |
| `impid` | String, **필수** | 응답 대상 `Imp.id` |
| `price` | Float, **필수** | CPM 입찰가 |
| `nurl` | URL | Win Notice URL (낙찰 시 호출) |
| `burl` | URL | Billing Notice URL (Billable 판정 시) |
| `lurl` | URL | Loss Notice URL (낙찰 실패 시) |
| `adm` | String | 광고 markup (VAST XML 또는 URL) |
| `adid` | String | 사전 등록된 광고 ID |
| `adomain` | String[] | 광고주 도메인 |
| `bundle` | String | 앱 번들 ID |
| `iurl` | URL | 광고 대표 이미지 URL |
| `cid` | String | 캠페인 ID |
| `crid` | String | 크리에이티브 ID |
| `cat` | String[] | IAB Content Categories |
| `attr` | Integer[] | Creative Attributes |
| `apis` | Integer[] | 지원 API |
| `protocol` | Integer | VAST 버전 (AdCOM Creative Subtypes) |
| `w` / `h` | Integer | 크리에이티브 크기 |
| `exp` | Integer | 노출 유효 초 |
| `dur` | Integer | 비디오/오디오 길이 (초) |
| `mtype` | Integer | 1=Banner, 2=Video, 3=Audio, 4=Native |
| `slotinpod` | Integer | Pod 슬롯 위치 |

---

### 3.15 BidResponse — Markup 전달 방식 비교

| 방식 | 사용 필드 | 장점 | 단점 |
|------|----------|------|------|
| **Markup in Bid** | `adm` | 동시성 ↑, Forfeit 위험 ↓ | 대역폭 비용 ↑ (모든 응답에 markup) |
| **Markup on Win Notice** | `nurl` (응답 본문에 markup) | 대역폭 절약, 사후 최적화 가능 | Win Notice HTTP 실패 시 Forfeit |

**Forfeit**: 낙찰됐지만 markup 전달 실패로 광고가 안 나가는 경우. 이때도 노출 카운트는 0.

---

### 3.16 OpenRTB Substitution Macros — `${DOLLAR}` 형식

VAST 매크로(`[BRACKET]`)와 **다른 시스템**입니다. 이건 거래소가 win/billing notice URL과 `adm` markup에 치환하는 매크로입니다.

| 매크로 | 설명 |
|--------|------|
| `${AUCTION_ID}` | 경매 ID (BidRequest.id) |
| `${AUCTION_BID_ID}` | 입찰 ID (BidResponse.bidid) |
| `${AUCTION_IMP_ID}` | Imp.id |
| `${AUCTION_SEAT_ID}` | 낙찰 Seat ID |
| `${AUCTION_AD_ID}` | bid.adid |
| `${AUCTION_PRICE}` | 청산가 (Clearing Price) |
| `${AUCTION_CURRENCY}` | 통화 |
| `${AUCTION_MBR}` | Market Bid Ratio = clearance / bid |
| `${AUCTION_LOSS}` | 패찰 사유 코드 |
| `${AUCTION_MIN_TO_WIN}` | 낙찰을 위한 최소 입찰가 |
| `${AUCTION_MULTIPLIER}` | 노출 총 수량 (DOOH 등) |
| `${AUCTION_IMP_TS}` | 노출 시점 (Unix ms) |

**암호화 치환**: `${AUCTION_PRICE:B64}` 형식으로 Base64 등 거래소-bidder 간 합의된 알고리즘 적용 가능.

---

## 4. 두 표준의 연동 — Field 매핑 표

DSP가 BidRequest의 어떤 필드를 보고 VAST의 어떤 요소를 만들어야 하는지의 매핑입니다.

| OpenRTB 필드 | VAST 대응 | 비고 |
|--------------|----------|------|
| `imp.video.protocols` | `<VAST version=...>` | DSP는 협상된 버전으로 응답 |
| `imp.video.api` | `<MediaFile apiFramework=...>` | OMID/SIMID 매칭 |
| `imp.video.mimes` | `<MediaFile type=...>` | MIME 일치 |
| `imp.video.minduration/maxduration` | `<Duration>` | 범위 내 |
| `imp.video.skip + skipafter` | `<Linear skipoffset=...>` | 스킵 정책 |
| `imp.video.linearity` | `<Linear>` or `<NonLinearAds>` | 광고 형태 |
| `imp.video.companionad` | `<CompanionAds>` | 동반 광고 |
| `imp.video.podid + slotinpod` | `<Ad sequence>`, `breakId` | Pod 매핑 |
| `bid.adm` (URL) | VAST XML 응답 | 플레이어가 GET 호출 |
| `bid.adm` (XML 인라인) | VAST XML 직접 | hop 없음 |
| `bid.price` | `<Pricing>` (선택) | 가격 동기화 |
| `bid.adomain` | `<Advertiser>` (선택) | 광고주 도메인 |
| `bid.crid` | `<Creative id=...>` | 크리에이티브 식별 |
| `regs.gdpr` + `user.consent` | `[GDPRCONSENT]` 매크로 치환 | 동의 전달 |
| `regs.us_privacy` | `[USPRIVACY]` 매크로 치환 | CCPA |
| `device.ifa` | `[IFA]` 매크로 치환 | 광고 ID |

---

## 5. 자주 헷갈리는 개념 정리

### 5.1 Impression vs ViewableImpression vs Billable Impression

| 종류 | 발화 시점 | 사용 필드 |
|------|----------|----------|
| **Impression** | VAST XML 로드 완료 → `<MediaFile>` 첫 바이트 전송 | VAST `<Impression>` |
| **ViewableImpression** | MRC 기준 충족 (50% 영역, 2초 연속) | VAST `<ViewableImpression><Viewable>` |
| **Billable Impression** | 거래소 정책 기준 (보통 viewable) | OpenRTB `bid.burl` |

**핵심**: 셋은 같은 광고의 서로 다른 단계 카운트. 광고주 계약서에 어떤 기준이 청구 대상인지 명시해야 합니다.

---

### 5.2 Auction Types — First Price vs Second Price Plus

| 타입 | OpenRTB `at` | 청산가 결정 |
|------|:------------:|------------|
| First Price | 1 | 낙찰자가 자신의 입찰가 그대로 지불 |
| Second Price Plus | 2 | 2위 입찰가 + 거래소 정의 증분 (보통 $0.01, 거래소마다 다름) |
| Exchange-specific | 500+ | 거래소 정의 (e.g., Soft Floor Auction) |

> **사실 확인 정정**: OpenRTB 명세는 "Second Price Plus"라고만 명시할 뿐, **+$0.01은 표준이 아닙니다**. 거래소 정책마다 다르며, 일부는 Bid Floor + 증분, 일부는 2위 + 증분을 사용합니다.

**산업 동향**: Google Ad Manager(2019), Open Bidding 등 주요 SSP가 First Price로 전환. 2026년 현재 First Price가 비디오 시장 다수.

---

### 5.3 VAST [BRACKET] vs OpenRTB ${DOLLAR}

| 항목 | VAST 매크로 | OpenRTB 매크로 |
|------|------------|---------------|
| 형식 | `[NAME]` | `${NAME}` |
| 치환 주체 | 비디오 플레이어 | RTB 거래소 |
| 치환 시점 | 트래킹 URL 호출 직전 | win/billing notice 호출 직전 |
| 예시 | `[ERRORCODE]`, `[CACHEBUSTING]`, `[IFA]` | `${AUCTION_PRICE}`, `${AUCTION_ID}` |
| 정의 위치 | VAST 4.x 명세 | OpenRTB 2.6 §4.4 |

**섞임 주의**: `adm` 필드에 VAST URL을 넣을 때 OpenRTB `${AUCTION_PRICE}`와 VAST `[CACHEBUSTING]`이 함께 들어갈 수 있습니다. 각각 다른 단계에서 치환됩니다.

---

### 5.4 SSAI vs CSAI

| 항목 | CSAI (Client-Side) | SSAI (Server-Side) |
|------|--------------------|--------------------|
| `imp.ssai` 값 | 1 | 3 (또는 2=hybrid) |
| 광고 삽입 위치 | 플레이어가 직접 | 서버가 콘텐츠 스트림에 stitching |
| 광고 차단 | 영향 받음 (uBlock 등) | **회피 가능** |
| 트래킹 | 클라이언트 발화 | 서버 발화 (또는 일부 client-side) |
| Mezzanine 필요 | 보통 불필요 | **필수** (트랜스코딩 원본) |
| CTV 채택 | 일부 | **표준** |

---

## 6. CTV 환경 특이사항

### 6.1 Ad Pod — 연속 광고 묶음

전통 TV 광고처럼 한 브레이크에 여러 광고가 연달아 나가는 구조. OpenRTB 2.6에서 본격 표준화.

**Static Pod** (사전 정의된 슬롯 수):
```json
{
  "imp": [
    {"id": "1", "video": {"podid": "pod-A", "slotinpod": 1, ...}},
    {"id": "2", "video": {"podid": "pod-A", "slotinpod": 0, ...}},
    {"id": "3", "video": {"podid": "pod-A", "slotinpod": -1, ...}}
  ]
}
```

**Dynamic Pod** (총 시간만 정해두고 DSP가 자유롭게):
```json
{
  "imp": [{
    "id": "1",
    "video": {
      "podid": "pod-B",
      "poddur": 90,
      "maxseq": 5,
      "minduration": 15,
      "maxduration": 30,
      "mincpmpersec": 0.10
    }
  }]
}
```

VAST 쪽 대응:
```xml
<Ad sequence="1" breakId="pod-A" breakIndex="1">...</Ad>
<Ad sequence="2" breakId="pod-A" breakIndex="2">...</Ad>
```

---

### 6.2 CTV 환경 식별

| OpenRTB 필드 | 값 | 의미 |
|--------------|-----|------|
| `device.devicetype` | 3 | Connected TV |
| `device.devicetype` | 7 | Set Top Box |
| `device.devicetype` | 6 | Connected Device (general) |
| `app.bundle` | CTV Store ID | OTT/CTV Store Assigned App ID Guidelines 준수 |
| `imp.video.plcmt` | 1 | Instream (CTV는 거의 항상 1) |

---

## 7. 프라이버시 프레임워크

| 규제 | OpenRTB 필드 | VAST 매크로 | 비고 |
|------|--------------|------------|------|
| GDPR (EU) | `regs.gdpr`, `user.consent` (TCF 2.x) | `[GDPRCONSENT]` | IAB Europe TCF |
| CCPA (California) | `regs.us_privacy` | `[USPRIVACY]` | US Privacy String v1.0 |
| **GPP** (Global) | `regs.gpp`, `regs.gpp_sid` | (전용 매크로 부재 - GPP 자체 전달) | Global Privacy Platform (2022~) |
| COPPA (US <13세) | `regs.coppa` | `[REGULATIONS]` | 0/1 플래그 |
| ATT (iOS) | `device.lmt`, `device.ifa` (제로 UUID) | `[LIMITADTRACKING]` | iOS 14.5+ |

**GPP**는 GDPR/CCPA/기타 지역 규제 문자열을 통합한 차세대 포맷으로, 2022년 IAB Tech Lab 출시. 향후 표준이 GPP로 수렴할 것으로 예상.

---

## 8. 구현 체크리스트

### 8.1 VAST 응답 생성 측 (Ad Server / DSP)

```
☐ <VAST version="..."> — 협상된 버전 사용
☐ <AdServingId> 포함 (v4.0+ 필수, UUID 권장)
☐ <UniversalAdId> 포함 (중복 광고 탐지)
☐ <AdTitle> 포함 (InLine 필수)
☐ <Impression> 최소 1개, [CACHEBUSTING] 매크로 포함
☐ <Error> URL + [ERRORCODE] 매크로
☐ <MediaFile> type/width/height/delivery 모두 명시
☐ 다양한 bitrate 옵션 제공 (ABR)
☐ TrackingEvents: start, 4분위, complete 최소 포함
☐ ViewableImpression 3종 (Viewable/NotViewable/ViewUndetermined)
☐ AdVerifications (OMID) 포함
☐ Companion 광고 1개 이상 권장 (CTV)
☐ Wrapper 사용 시 followAdditionalWrappers, fallbackOnNoAd 명시
```

### 8.2 VAST 소비 측 (Video Player / SDK)

```
☐ Wrapper 체인 hop 제한 (3~5)
☐ tmax / 자체 타임아웃 내 응답 없으면 Error 301 발화
☐ 모든 트래킹 URL에서 매크로 치환 ([CACHEBUSTING] 필수)
☐ <Error> URL 호출 시 [ERRORCODE] 치환
☐ OMID SDK 초기화 (AdVerifications)
☐ ViewableImpression 판정 로직 (MRC 기준)
☐ SkipOffset 후 스킵 버튼 노출
☐ MediaFile 선택: bitrate × 네트워크 × 화면 크기 고려
☐ [PODSEQUENCE]/[PODCOUNT] 등 Pod 매크로 지원 (v4.1+)
```

### 8.3 OpenRTB BidRequest 송신 측 (SSP / Exchange)

```
☐ id 고유성 보장
☐ tmax 합리적 설정 (80~120ms 권장)
☐ video.protocols / mimes / api 정확히 명시
☐ video.plcmt 사용 (placement Deprecated)
☐ device.ifa, device.ua 포함 (프라이버시 허용 시)
☐ regs.gdpr / us_privacy / gpp 적용
☐ source.schain (Supply Chain) 포함 (Ads.txt/Sellers.json 검증용)
☐ bcat / badv / bapp 차단 리스트 적용
☐ site/app/dooh 중 정확히 하나
```

### 8.4 OpenRTB BidResponse 응답 측 (DSP)

```
☐ id, impid, price 필수
☐ adm 또는 nurl 중 하나로 markup 전달
☐ adomain 정확히 (block list 검증용)
☐ crid 일관성 (이전 노출과 동일 ID)
☐ mtype 명시 (2=Video)
☐ apis / protocol 명시
☐ 응답 시간 tmax 내 보장
☐ nurl/burl/lurl URL에 ${AUCTION_PRICE} 등 매크로 포함
```

---

## 9. 자주 발생하는 실전 문제 & 원인

| 증상 | 1순위 원인 | 해결 |
|------|----------|------|
| `bid.price`와 청구 금액 불일치 | `${AUCTION_PRICE}` 미치환 (markup 그대로) | nurl/burl, adm 모두 매크로 치환 확인 |
| Impression 카운트 0 | `<Impression>` URL 호출 실패 / `[CACHEBUSTING]` 미치환 | 플레이어 로그 확인, 캐시 헤더 점검 |
| Viewable rate 비정상 낮음 | `<Viewable>` URL이 `[VIEWABLE]` 매크로 의존 | MRC 기준 판정 로직 구현 확인 |
| CTV 광고 안 나옴 | `protocols` 배열에 VAST 4.x 미포함 | `[7, 8, 11, 12, 13, 14, 15, 16]` 포함 |
| Error 302 (Wrapper limit) | Wrapper 체인이 거래소→DSP→3rd party→...로 너무 김 | DSP-거래소 직결 / 체인 단축 |
| Error 405 (no displayable media) | `mimes` mismatch, codec 미지원 | MediaFile 다양화, codec 명시 |
| Forfeit 발생 | `nurl` 호출 후 응답 본문 비어있음 | adm 방식으로 전환 또는 nurl 안정성 점검 |
| iOS에서 IFA 빈 값 | ATT 미동의 / `device.lmt=1` | LAT 환경 대비 광고 폴백 준비 |
| GDPR 영역 노출 0 | `user.consent` 누락 | TCF 2.x 동의 문자열 전달 확인 |

---

## 10. 글로서리 (Glossary)

| 용어 | 풀이 |
|------|------|
| **VAST** | Video Ad Serving Template — 비디오 광고 명세 XML |
| **VPAID** | Video Player-Ad Interface Definition — 인터랙티브 광고 JS API (Deprecated) |
| **SIMID** | Secure Interactive Media Interface Definition — VPAID 후속 |
| **OMID** | Open Measurement Interface Definition — 가시성·검증 SDK |
| **OpenRTB** | Open Real-Time Bidding — 실시간 입찰 프로토콜 |
| **AdCOM** | Advertising Common Object Model — OpenRTB/OpenDirect 공용 사전 |
| **DSP** | Demand-Side Platform — 광고주 측 입찰 시스템 |
| **SSP** | Supply-Side Platform — 매체사 측 인벤토리 관리 시스템 |
| **DMP** | Data Management Platform — 청중 데이터 통합 |
| **PMP** | Private Marketplace — 사전 합의된 1:1 또는 1:다수 거래 |
| **SSAI** | Server-Side Ad Insertion — 서버에서 광고를 콘텐츠에 stitching |
| **CSAI** | Client-Side Ad Insertion — 플레이어가 직접 광고 호출 |
| **Ad Pod** | 한 브레이크에 연속 재생되는 광고 묶음 (CTV 핵심) |
| **Mezzanine** | SSAI용 원본 고화질 트랜스코딩 소스 |
| **MRC** | Media Rating Council — 가시성 기준 정의 단체 |
| **TCF** | Transparency & Consent Framework — IAB Europe GDPR 동의 표준 |
| **GPP** | Global Privacy Platform — 통합 프라이버시 프레임워크 (2022~) |
| **CTV** | Connected TV — 스마트 TV, OTT 기기 |
| **DOOH** | Digital Out-Of-Home — 디지털 옥외광고 |
| **CPM/CPC/CPV** | Cost per Mille / Click / View |
| **Forfeit** | 낙찰 후 markup 전달 실패로 노출 불발 |
| **Header Bidding** | 페이지 로드 시 SSP/DSP에 사전 입찰 요청 (Prebid.js 등) |

---

## 11. 마무리

VAST와 OpenRTB는 표면적으로는 각각 XML/JSON, 단독으로 존재하는 표준처럼 보이지만, 실제 광고 생태계에서는 **하나의 흐름**으로 동작합니다. OpenRTB가 0.1초 만에 경매를 끝내면, VAST가 그 결과를 받아 0.5~1초 안에 플레이어로 전달하고, 사용자가 광고를 보는 30초 동안 수십 개의 트래킹 픽셀이 두 표준의 매크로 시스템으로 치환되어 발사됩니다.

두 표준 모두 IAB Tech Lab에서 계속 진화 중입니다. 큰 흐름은:

- **VAST**: CTV/오디오 지원 강화 (4.3, CTV 2024)
- **OpenRTB**: Pod·CTV·Privacy 강화 (2.6-202303, GPP 통합)
- **AdCOM**: 두 표준의 공통 사전으로 분리되어 별도 진화

업계 표준을 따라가되, 구현 시 **버전 호환성·매크로 치환·enum 정확성** 세 가지에 가장 주의하세요. 경험상 트래킹 데이터 이상의 절반은 매크로 미치환, 사반은 enum 오인(특히 `protocols` 값), 나머지는 시간 초과(`tmax`)입니다.

---

**1차 소스 (Fact-Check 기준)**

- [VAST 통합 명세 — gwangy.com/docs/vast](https://gwangy.com/docs/vast)
- [IAB Tech Lab — VAST Standards](https://iabtechlab.com/standards/vast/)
- [OpenRTB 2.6 Spec (GitHub)](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md)
- [AdCOM 1.0 FINAL (GitHub)](https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/master/AdCOM%20v1.0%20FINAL.md)
- [VAST 4.x Macros Latest (Live Doc)](https://interactiveadvertisingbureau.github.io/vast/vast4macros/vast4-macros-latest.html)
- [IAB OMID SDK](https://iabtechlab.com/standards/open-measurement-sdk/)
- [IAB GPP Specification](https://github.com/InteractiveAdvertisingBureau/Global-Privacy-Platform)
- [IAB US Privacy String](https://github.com/InteractiveAdvertisingBureau/USPrivacy)
