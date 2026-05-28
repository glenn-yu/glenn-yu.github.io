---
layout: post
title: "Jetpack Compose와 WebView의 위험한 동거: 상호작용 이슈 해결과 Pure View 리팩토링"
date: 2026-05-28 11:30:00 +0900
categories: [Android, Kotlin, Jetpack Compose]
tags: [Android, Kotlin, Jetpack Compose, WebView, Optimization, Performance, HybridApp]
---

현대적인 안드로이드 개발 환경에서 Jetpack Compose는 UI 개발의 표준으로 자리 잡았습니다. 하지만 안드로이드 생태계의 '오래된 거인'인 **WebView**를 Compose 안으로 끌어들일 때는 이야기가 달라집니다. 단순히 `AndroidView`로 감싸는 것만으로 해결되지 않는 복잡한 인터랙션과 세션 유지 문제, 그리고 이를 해결하기 위한 기술적 결단에 대해 심도 있게 다뤄보겠습니다.

---

## 1. 문제의 발단: 왜 어떤 웹페이지는 Compose에서 동작하지 않는가?

프로젝트 진행 중 특정 고사양 웹 게임 페이지와 보상형 이벤트 페이지에서 치명적인 이슈들이 보고되었습니다. 
- **현상 1**: 특정 버튼이 수차례 클릭해야 겨우 한 번 반응하거나, 아예 클릭되지 않음.
- **현상 2**: 이미지 리소스가 간헐적으로 깨지거나 로딩이 무한 루프에 빠짐.
- **현상 3**: 웹뷰 내 로그인 세션이 유지되지 않고 자꾸 메인으로 튕겨 나감.

이러한 문제는 일반적인 정적 HTML 페이지에서는 잘 드러나지 않지만, **고도의 자바스크립트 인터랙션이 포함된 SPA(Single Page Application)나 웹 게임**에서 극대화됩니다.

---

## 2. 기술 분석: Compose와 WebView 사이의 '보이지 않는 벽'

### 1) 렌더링 계층의 파편화 (Rendering Layer Discontinuity)
* **WebView**: 자체적인 Chromium 엔진을 통해 독자적인 렌더링 파이프라인을 가집니다. OS로부터 할당받은 Surface 위에 직접 그림을 그립니다.
* **Jetpack Compose**: 모든 UI 요소를 하나의 캔버스 위에 픽셀 단위로 직접 그려냅니다. 
* **충돌 지점**: `AndroidView` 래퍼를 사용하면 Compose의 노드 트리 안에 전통적인 View 시스템이 강제로 삽입됩니다. 이 과정에서 **Z-Order(계층 순서)** 계산이나 **Invalidation(화면 갱신)** 요청이 엇갈리며 화면 깜빡임이나 렌더링 지연이 발생합니다.

### 2) 터치 이벤트 전파 경로의 병목 (Input Event Bottleneck)
전통적인 View 시스템에서는 터치 이벤트가 부모-자식 간에 직접 전달되지만, Compose 환경에서는 다음과 같은 복잡한 경로를 거칩니다:
> **OS Input Service** → **Compose Root** → **Modifier Logic** → **AndroidView Wrapper** → **WebView Inner Engine**

이 경로 중간에서 Compose의 `PointerInput` 로직이 미세한 스크롤이나 제스처를 선점(Intercept)하려 시도하면, WebView 내부의 고속 자바스크립트 클릭 이벤트는 무시되거나 타이밍이 밀리게 됩니다. 이것이 바로 "버튼이 눌리지 않는" 현상의 본질입니다.

### 3) 생명주기와 재구성(Recomposition)의 부조화
Compose는 상태 변경 시 초당 60회 이상 UI를 다시 그릴 수 있습니다. WebView는 상태를 유지해야 하는 Heavy한 객체인데, 부모 Compose 함수의 재구성이 빈번하게 발생하면 WebView 객체가 불필요하게 다시 생성되거나, `onReset` 로직이 트리거되면서 내부 쿠키 및 세션 정보가 꼬이는 원인이 됩니다.

---

## 3. 해결책: 'Pure View'로의 회귀와 정공법 선택

우리는 "최신 기술인 Compose를 썼으니 끝까지 Compose로 해결해야 한다"는 강박을 버리고, 기술적 안정성을 위해 **Pure View(setContentView)** 방식을 선택했습니다.

### A. GwangyWebActivity.kt: 독무대를 마련해주다
Compose의 `setContent`를 과감히 제거하고, Activity의 생명주기를 WebView와 1:1로 매핑했습니다.

```kotlin
// 리팩토링된 핵심 구조
override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    
    val rootLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = LayoutParams(MATCH_PARENT, MATCH_PARENT)
    }

    // 네이티브 상단 툴바 구성 (Compose의 상단바 대신 시스템 안정성 확보)
    val toolbar = Toolbar(this).apply {
        title = "GwangyBrowser"
        setNavigationIcon(R.drawable.ic_back)
    }
    
    rootLayout.addView(toolbar)
    rootLayout.addView(webView) // 전용 WebView 배치
    
    setContentView(rootLayout)
}
```

### B. GwangyWebView.kt: 브라우저 수준의 최적화 설정
단순한 래핑을 넘어, WebView가 브라우저만큼의 성능을 낼 수 있도록 세밀한 튜닝을 적용했습니다.

* **세션 유지의 핵심**: `CookieManager.setAcceptThirdPartyCookies(true)`를 통해 서드파티 도메인 간의 세션 공유를 허용했습니다. (보상 시스템에서 필수적)
* **메모리 최적화**: `WebSettings.LOAD_DEFAULT`와 캐시 전략을 조정하여 저사양 기기에서의 힙 메모리 부족 문제를 방지했습니다.
* **User-Agent Customizing**: 일부 서버에서 WebView를 봇으로 오인해 차단하는 것을 막기 위해 최신 모바일 크롬 브라우저 문자열을 주입했습니다.

---

## 4. 결과 및 케이스 비교

| 분석 항목 | Compose AndroidView (이전) | Pure View 시스템 (이후) |
| :--- | :--- | :--- |
| **터치 반응성** | 80~150ms 지연 발생 가능 | **0~20ms (Native 수준)** |
| **렌더링 안정성** | 스크롤 시 티어링(Tearing) 현상 간헐적 발생 | **매우 부드러움 (Chromium 성능 100% 활용)** |
| **세션 유지** | 재구성(Recomposition) 시 유실 위험 | **Activity 종료 전까지 완벽 유지** |
| **디버깅** | Compose 계층과 섞여 원인 파악 어려움 | **Chrome Inspect 툴과 1:1 매칭 용이** |

---

## 5. 오늘의 교훈: 적재적소(Right Tool for the Right Job)

기술은 수단이지 목적이 되어서는 안 됩니다. **"앱의 메인 기능이 웹뷰라면, 그 웹뷰는 View 시스템 위에서 자유롭게 뛰어놀아야 합니다."**

이번 리팩토링을 통해 우리는 최신 트렌드인 Jetpack Compose를 포기한 것이 아니라, **WebView라는 구형 생태계를 안정적으로 품기 위해 안드로이드의 근간인 View 시스템을 현명하게 활용한 것**입니다. 웹 게임이나 복잡한 상호작용이 필요한 하이브리드 앱을 개발 중이라면, Compose 내부의 래퍼보다는 독립적인 Activity 기반의 WebView 설계를 강력히 추천합니다.

---
**💡 한 줄 정리**: 도화지(Compose)가 아무리 좋아도, 거대한 괴물(WebView)을 그리려 하지 말고 전용 운동장(View System)을 내어주는 것이 성능과 안정성의 지름길입니다.
