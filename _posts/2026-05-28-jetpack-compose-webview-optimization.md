---
layout: post
title: "Jetpack Compose 환경에서의 WebView 최적화 및 기술 분석 보고서"
date: 2026-05-28 10:00:00 +0900
categories: [Android, Kotlin, Jetpack Compose]
tags: [Android, Kotlin, Jetpack Compose, WebView, Optimization, Refactoring]
---

Jetpack Compose 환경에서 WebView를 다루다 보면 예상치 못한 상호작용 문제(버튼 클릭 불가, 이미지 누락, 로그인 세션 유실 등)를 마주하곤 합니다. 오늘은 이러한 문제의 원인을 분석하고, 성공적으로 동작한 **Pure View 방식**으로 리팩토링한 기술적 배경과 결론을 정리해 보려 합니다.

---

## 1. 개요 (Overview)

현대적인 안드로이드 개발 스택인 Jetpack Compose는 혁신적이지만, 안드로이드 초창기부터 존재해 온 '괴물' 같은 존재인 WebView와 섞어 쓸 때는 세심한 주의가 필요합니다. 특정 URL이나 복잡한 웹 게임 페이지에서 발생하는 이슈들을 해결하기 위해 진행한 리팩토링 과정을 공유합니다.

## 2. Jetpack Compose와 전통적인 WebView(View 시스템)의 본질적 차이

### 1) 태생이 다릅니다 (그리는 방식의 차이)
* **WebView (전통적인 View)**: 화면 공간을 OS가 메모리에 통째로 할당하고, 그 안에서 브라우저 엔진(Chromium)이 자체적으로 화면을 그리고 터치를 처리합니다. OS의 간섭을 최소화하고 독립적으로 동작합니다.
* **Jetpack Compose**: View를 메모리에 할당하는 대신, 코드를 읽으면서 도화지에 직접 픽셀을 그리는(렌더링) 방식입니다. 화면을 그리는 주체가 Compose 자체 렌더링 엔진으로 완전히 바뀌었습니다.

### 2) 원인 (Cause): 둘을 섞어 쓸 때 발생하는 문제
Compose 내부에 WebView를 띄우려면 `AndroidView`라는 특수한 껍데기(Wrapper)를 씌워야 합니다. 이 과정에서 상호작용의 병목 현상이 발생합니다.

* **터치 이벤트 가로채기 (Focus & Input)**:
    * 터치 신호가 `OS -> Compose -> AndroidView 래퍼 -> WebView` 순서로 전달됩니다.
    * 게임 페이지처럼 반응속도가 중요한 자바스크립트 기반 요소들은 터치 이벤트를 직접 낚아채려 하지만, 중간의 Compose 래퍼가 이벤트를 선점하거나 지연시키면서 버튼 클릭이 무시되는 현상이 발생합니다.
* **생명주기(Lifecycle) 충돌**:
    * Compose의 재구성(Recomposition) 주기와 WebView의 로딩 주기가 겹치면서 내부 메모리(쿠키, 팝업 상태 등)가 초기화되거나 타이밍 이슈로 설정 오류를 유발할 수 있습니다.

## 3. 해결 방안 (Solution): Pure View 방식의 의미

결국 제가 선택한 해결책은 **"Pure View(setContentView(webView))"** 방식입니다. 이는 최신 방식인 Compose를 배제하고, 안드로이드 초창기 방식인 "화면 전체를 브라우저 엔진에게 온전히 넘겨주는 방식"을 선택한 것입니다. 중간 간섭자가 사라짐으로써 터치, 이미지 로딩, 팝업 제어권 등을 WebView가 100% 독점하게 되어 가장 안정적인 동작이 가능해졌습니다.

> **💡 핵심 요약**: Compose(최신 도화지) 위에 구형 괴물(WebView)을 억지로 올려놓으려다 보니 터치와 설정이 꼬였던 것이고, 도화지를 아예 치워버리고 구형 괴물에게 독무대를 내어주니 정상 작동한 것입니다!

## 4. 비교 분석 (Comparison)

| 구분 | Compose + WebView (권장) | Pure View / XML (권장 - 이번 케이스) |
| :--- | :--- | :--- |
| **주요 대상** | 단순 정보 전달(공지사항, 약관), 정적 폼 | **웹 게임**, 복잡한 이벤트/보상 페이지, 팝업이 많은 곳 |
| **장점** | UI 개발 생산성, 최신 스택 유지 | **안정성**, 터치 반응성, 완벽한 쿠키/세션 제어 |
| **단점** | 복잡한 인터랙션 시 버그 발생률 높음 | 구형 방식으로 인한 UI 결합의 번거로움 |

## 5. 최종 업데이트 내역 (Implementation)

### A. BiorhythmWebView.kt (최적화)
* **쿠키 매니저**: `setAcceptThirdPartyCookies`를 명시적으로 허용하여 세션 및 보상 트래킹 안정화.
* **WebSettings**: `useWideViewPort`, `loadWithOverviewMode`, `allowFileAccess` 등 브라우저급 환경 구성.
* **User-Agent**: 최신 Chrome 모바일 버전 문자열 강제 주입으로 서버 차단 방지.

### B. NStationWebActivity.kt (Pure View 전환)
* **Compose 제거**: `setContent` 대신 네이티브 `LinearLayout`과 `setContentView` 사용.
* **네이티브 상단 바**: `androidx.appcompat.widget.Toolbar`를 동적으로 생성하여 시스템 바 영역과 조화롭게 구성.
* **디버깅 활성화**: `setWebContentsDebuggingEnabled(true)`를 통해 PC 크롬 인스펙터 지원.

---

## 6. 결론 및 결과 (Conclusion)

"일반적인 웹페이지는 괜찮지만, 게임이나 상호작용이 복잡한 페이지는 Compose를 피하는 것이 상책"입니다.

개발자가 Pure View(전통 방식)로 돌아가는 이유는 명확합니다:
1. **성능 효율**: 이중 렌더링으로 인한 리소스 낭비 방지.
2. **디버깅 용이성**: 원인 파악의 수월함.
3. **검증된 안정성**: 10년 넘게 다듬어진 WebView 기능을 100% 활용.

오늘 적용한 방식은 수많은 글로벌 하이브리드 앱들이 여전히 고수하고 있는 **"가장 에러 없고 확실한 정공법"**입니다.
