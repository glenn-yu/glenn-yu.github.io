---
layout: post
title: "Jetpack Compose와 WebView의 위험한 동거: 40개의 삽질 커밋과 단 한 줄의 진짜 해법"
date: 2026-05-28 11:30:00 +0900
categories: [Android, Kotlin, Jetpack Compose]
tags: [Android, Kotlin, Jetpack Compose, WebView, AndroidView, Interop, Optimization, Performance, HybridApp]
---

현대적인 안드로이드 개발 환경에서 Jetpack Compose는 UI 개발의 표준으로 자리 잡았습니다. 하지만 안드로이드 생태계의 '오래된 거인'인 **WebView**를 Compose 안으로 끌어들일 때는 이야기가 달라집니다.

이 글은 처음에 "Compose와 WebView는 근본적으로 안 맞는다"고 결론 내렸다가, 코드 이력을 다시 분석한 끝에 **진짜 원인은 따로 있었다**는 것을 깨달은 과정을 정직하게 기록한 것입니다. 40개의 커밋을 쏟아붓고도 못 찾았던, 그러나 단 한 줄이면 끝났던 그 원인 말입니다.

---

## 1. 문제의 발단: 멀쩡한 웹페이지가 Compose 안에서 무너지다

특정 고사양 웹 게임 페이지와 보상형 이벤트 페이지에서 치명적인 이슈가 보고되었습니다.

- **현상 1**: 페이지 레이아웃이 통째로 무너지거나, `height: 100vh` 기반 요소들이 전부 0px로 찌그러짐.
- **현상 2**: 특정 버튼이 수차례 클릭해야 겨우 한 번 반응하거나, 아예 클릭되지 않음.
- **현상 3**: 이미지 리소스가 간헐적으로 깨지거나 로딩이 무한 루프에 빠짐.

일반적인 정적 HTML 페이지에서는 잘 드러나지 않지만, **`vh`/`vw` 단위를 적극적으로 쓰는 SPA나 고도의 자바스크립트 인터랙션이 포함된 웹 게임**에서 문제가 극대화됐습니다.

---

## 2. 반전: 진짜 원인은 'Compose'가 아니라 'layoutParams'였다

처음에는 Compose의 렌더링 파이프라인, 터치 이벤트 선점, 재구성(Recomposition) 등 거창한 구조적 문제를 의심했습니다. 모두 사실이긴 하지만, **가장 직접적인 원인은 어이없을 만큼 단순했습니다.**

### 문제의 코드

```kotlin
AndroidView(
    factory = { ctx ->
        GwangyWebView(ctx)            // ← layoutParams 미설정 → 초기 크기 0×0
    },
    update = { wv ->
        wv.loadUrl(url)               // ← 크기가 0인 상태에서 즉시 호출됨
    },
    modifier = Modifier.fillMaxSize() // ← Compose 좌표계에만 적용, 내부 View엔 전달 안 됨
)
```

### 오동작 메커니즘

```
1. factory() 실행 → WebView 생성, layoutParams 없음 (초기 크기 = 0×0)
2. update() 실행 → loadUrl() 호출
3. 브라우저 엔진이 뷰포트를 등록: viewport height = 0px
4. CSS: height: 100vh → 100 × 0px = 0px 렌더링
5. 이후 뷰 크기가 커져도, 이미 vh=0으로 계산된 레이아웃은 그대로 굳어버림
   → vh 기반 요소 전부 0px로 붕괴
```

### 핵심: `Modifier.fillMaxSize()` ≠ `layoutParams`

이 버그의 본질은 **두 개의 측정 시스템이 서로 독립적**이라는 사실을 놓친 것입니다.

```
Compose 측정 시스템 (Modifier.fillMaxSize)
        │
        ▼
  AndroidView Wrapper (Compose 노드)
        │
        ▼
  View.layoutParams ← factory에서 별도로 설정해야 함 (자동 변환 안 됨!)
        │
        ▼
   실제 View (WebView)
```

`Modifier.fillMaxSize()`는 **Compose 레이어의 측정 공간**을 지정할 뿐, `AndroidView`가 내부 View를 만들 때 이 값을 `LayoutParams`로 변환해 전달해주지 **않습니다.** `factory`에서 명시하지 않으면 내부 View의 `layoutParams`는 `WRAP_CONTENT`(또는 0×0)로 남습니다.

### 한 줄이면 끝났다 — Compose에서도

```kotlin
AndroidView(
    factory = { ctx ->
        GwangyWebView(ctx).also { wv ->
            // 이 한 줄만 추가했어도 vh 문제는 해결됐다
            wv.layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
    },
    ...
)
```

즉, **"Compose를 버려야만 풀리는 문제"가 아니었습니다.** `factory` 블록 안에서 `layoutParams = MATCH_PARENT` 한 줄만 추가했어도 `vh` 문제는 그대로 해결됐을 겁니다.

---

## 3. 40개 커밋의 삽질 기록

이 버그를 해결하는 데 **약 40개의 커밋**이 들었습니다. 그리고 솔직히 고백하면, 그 커밋들은 대부분 AI 코딩 어시스턴트가 작성했습니다. 정작 가장 단순한 해결책인 `layoutParams = MATCH_PARENT` 한 줄은 그 긴 여정 내내 **단 한 번도 시도되지 않았습니다.**

대신 시도된 것들은 이런 것들이었습니다.

| 시도한 접근 | `MATCH_PARENT` 시도? |
|------|:------------------:|
| User-Agent에서 `wv` 태그 제거 (이미지 차단 의심) | ❌ |
| HTTP 에러 로깅 추가 (디버깅) | ❌ |
| 대용량 이미지(2MB+ PNG) 렌더링 개선 | ❌ |
| JS 주입으로 DOM 상태 진단 | ❌ |
| GPU compositing 강제 (`LAYER_TYPE_HARDWARE`) | ❌ |
| `LAYER_TYPE_HARDWARE` 제거, repaint 범위 확장 | ❌ |
| 원격 크롬 디버깅 활성화 | ❌ |
| `setSupportMultipleWindows(false)` | ❌ |
| `window.open` 핸들러 / `window.chrome` 폴리필 | ❌ |
| `color-scheme: light` 강제, 다크모드 차단 | ❌ |
| `mixedContent ALWAYS_ALLOW` | ❌ |
| **소프트웨어 렌더링 강제** (`LAYER_TYPE_SOFTWARE`) | ❌ |
| 모든 커스텀 로직 제거, 표준 Chrome UA만 남김 | ❌ |
| **Pure View 전환 → `MATCH_PARENT` 첫 등장 → 해결** | ✅ |

### 왜 40개 커밋 동안 `MATCH_PARENT`를 시도하지 않았는가

원인은 하나입니다. **`Modifier.fillMaxSize()`가 내부 View에도 자동 적용된다고 끝까지 잘못 믿었기 때문입니다.**

```kotlin
// 이 코드를 보고 "WebView 크기는 fillMaxSize()로 이미 잡혔다"고 단정해버렸다
AndroidView(
    factory = { ctx -> GwangyWebView(ctx) },  // layoutParams 없음
    modifier = Modifier.fillMaxSize()          // Compose 레이어에만 적용됨
)
```

이 하나의 착각 위에서 렌더링 레이어, User-Agent, JS 폴리필, GPU/소프트웨어 렌더링 전환, DOM 진단 스크립트까지 — 전혀 다른 방향만 40번을 파고들었습니다. **잘못된 전제 하나가 얼마나 멀리까지 사람(과 AI)을 끌고 가는지** 보여주는 사례입니다.

---

## 4. 그렇다면 Pure View 전환은 틀린 선택이었나?

아닙니다. 결과적으로 옳았습니다. 다만 **이유를 정확히 알아야** 합니다.

Pure View로 전환할 때 사실상 두 가지 변경이 **동시에** 일어났습니다.

| 변경 내용 | vh 문제 해결 | 터치 문제 해결 |
|---------|:-----------:|:------------:|
| `rootLayout`에 `MATCH_PARENT` 적용 | ✅ 핵심 | - |
| `webView`에 `MATCH_PARENT + weight=1` 적용 | ✅ 핵심 | - |
| Compose + `AndroidView` 구조 제거 | - | ✅ |

`vh` 문제만 보면 `layoutParams = MATCH_PARENT` 한 줄로 Compose에서도 해결 가능했습니다. 하지만 두 변경이 한꺼번에 이뤄졌기에 그동안 "Compose를 버리니 해결됐다"고 결론지었던 것이죠. **정확한 진단은 `vh + layoutParams`**, 그리고 **Pure View 전환은 vh와 터치 문제를 모두 없앤 올바른 방향**입니다.

### A. GwangyWebActivity.kt: 독무대를 마련해주다

`setContentView` 시점에 이미 뷰 크기가 `MATCH_PARENT`로 확정되므로, `loadUrl()` 호출 시 브라우저 엔진이 올바른 viewport height를 등록합니다.

```kotlin
// rootLayout: MATCH_PARENT 명시 → WebView가 렌더링되기 전 뷰포트 크기 확정
val rootLayout = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    layoutParams = ViewGroup.LayoutParams(MATCH_PARENT, MATCH_PARENT)  // ✅
}

// 네이티브 상단 툴바 (Compose 상단바 대신 시스템 안정성 확보)
val toolbar = Toolbar(this).apply {
    title = "GwangyBrowser"
    setNavigationIcon(R.drawable.ic_back)
}

// webView: MATCH_PARENT + weight=1 → 툴바를 제외한 나머지 공간 전체 점유
webView = GwangyWebView(this).apply {
    layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT, 1f)  // ✅
}

rootLayout.addView(toolbar)
rootLayout.addView(webView)

setContentView(rootLayout)
webView?.loadUrl(url)  // 뷰 크기 확정 후 로딩 시작 → vh CSS 정상 동작
```

### B. GwangyWebView.kt: 브라우저 수준의 최적화 설정

단순 래핑을 넘어, WebView가 브라우저만큼의 성능을 내도록 세밀하게 튜닝했습니다.

* **세션 유지의 핵심**: `CookieManager.setAcceptThirdPartyCookies(true)`로 서드파티 도메인 간 세션 공유를 허용했습니다. (보상 시스템에서 필수적)
* **브라우저급 뷰포트**: `useWideViewPort`, `loadWithOverviewMode`, `allowFileAccess` 등을 조정했습니다.
* **User-Agent Customizing**: 일부 서버가 WebView를 봇으로 오인해 차단하는 것을 막기 위해 최신 모바일 크롬 문자열을 주입했습니다.
* **디버깅 활성화**: `setWebContentsDebuggingEnabled(true)`로 PC 크롬 인스펙터를 1:1로 붙일 수 있게 했습니다.

---

## 5. AndroidView 인터롭, 제대로 쓰기

이번 일을 계기로 `AndroidView` 인터롭의 함정을 정리했습니다. WebView뿐 아니라 모든 View 래핑에 공통으로 적용됩니다.

### factory vs update — 생명주기를 이해하라

```
처음 Composition 진입 시:  factory() → View 생성 및 1회 초기화
Recomposition(상태 변화):  update()  → 기존 View 재사용, 상태만 동기화
Composition에서 제거 시:    onRelease() → 리소스 해제
```

```kotlin
// ❌ 잘못된 예 — 변하는 값을 factory에서 캡처
AndroidView(
    factory = { ctx ->
        WebView(ctx).also { it.loadUrl(url) }  // url이 바뀌어도 factory는 재실행 안 됨!
    }
)

// ✅ 올바른 예 — 고정 설정은 factory, 변하는 값은 update
AndroidView(
    factory = { ctx ->
        WebView(ctx).apply {
            layoutParams = ViewGroup.LayoutParams(MATCH_PARENT, MATCH_PARENT)
        }
    },
    update = { wv -> if (wv.url != url) wv.loadUrl(url) }
)
```

### 인터롭에서 자주 터지는 버그 6가지

| # | 증상 | 원인 | 해결 |
|:--|:---|:---|:---|
| ① | View가 안 보임 / vh CSS = 0px | `factory`에서 `layoutParams` 미설정 | `MATCH_PARENT` 명시 |
| ② | 버튼 클릭 누락, 스크롤 충돌 | Compose가 포인터 이벤트 선점 | `Modifier.pointerInteropFilter { true }` |
| ③ | 스크롤 위치 초기화, WebView 리로드 | Recomposition으로 View 재생성 | `remember { }`로 인스턴스 유지 |
| ④ | 복귀 시 세션/팝업 상태 소실 | 생명주기 주기 불일치 | `DisposableEffect`로 `onResume/onPause` 연결 |
| ⑤ | input 탭해도 키보드 안 올라옴 | Compose `FocusManager`가 포커스 가로챔 | `requestFocus()` 강제 호출 |
| ⑥ | TalkBack이 내부 View를 못 읽음 | semantics tree 분리 | `Modifier.semantics { }`로 수동 추가 |

```kotlin
// ③ View 인스턴스를 Composition 밖으로 꺼내기
val webView = remember {
    WebView(context).apply {
        layoutParams = ViewGroup.LayoutParams(MATCH_PARENT, MATCH_PARENT)
    }
}
// ④ 생명주기 명시 연결
DisposableEffect(Unit) {
    webView.onResume()
    onDispose { webView.onPause() }
}
AndroidView(factory = { webView })
```

---

## 6. 렌더링 파이프라인 충돌 — 언제 Pure View가 '필수'인가

Compose와 View는 **전혀 다른 렌더링 파이프라인**을 가집니다.

```
Compose:  Composition → Layout → Draw → 단일 RenderNode 트리로 GPU에 한번에
View:     measure → layout → draw → 각 View가 Canvas에 직접, 일부는 독립 Surface 보유
```

`AndroidView`로 둘을 섞으면 충돌이 생기는 케이스가 있습니다. WebView의 `vh` 버그는 그중 **타이밍 문제**에 속하고, 더 심각한 것은 **독립 Surface를 가진 View**입니다.

| 케이스 | 원인 | 증상 | 판단 |
|:---|:---|:---|:---:|
| **SurfaceView 계열** (VideoView 등) | 독립 Surface, Z-Order 분리 | Compose UI가 비디오/카메라 뒤로 사라짐 | **Pure View** 또는 TextureView |
| **GLSurfaceView / 게임엔진** | 독립 GL 렌더 스레드 | 프레임 드랍, 아티팩트, ANR | **Pure View 필수** |
| **`vh`/`vw` CSS WebView** | 뷰포트 등록 시점 0×0 | CSS 레이아웃 0px 붕괴 | Pure View 권장 (또는 `MATCH_PARENT`) |
| **복잡한 JS 인터랙션 WebView** | 터치 이벤트 선점 | 버튼 클릭 무시, 게임 무반응 | Pure View 권장 |
| **`LAYER_TYPE_HARDWARE` 충돌** | 이중 RenderNode | 애니메이션 위치 어긋남, 잔상 | 레이어 타입 변경 or Pure View |

### 의사결정 흐름도

```
사용하려는 View가 있다
        │
        ▼
SurfaceView 기반인가? (VideoView, GLSurfaceView, 카메라 HAL)
   예 ──┴── 아니오
   │              │
   ▼              ▼
Pure View      TextureView로 교체 가능한가?
Activity       예 ──┴── 아니오
               │            │
               ▼            ▼
        AndroidView      Pure View
        (TextureView)    Activity
               │
               ▼
        vh/vw CSS 사용 WebView인가?
          예 ──┴── 아니오
          │            │
          ▼            ▼
      Pure View    AndroidView
      Activity     (MATCH_PARENT 필수)
```

### 우리 앱의 다른 AndroidView 사용처 점검

이 깨달음으로 앱 전체의 `AndroidView` 사용처를 다시 훑었더니, **같은 버그가 한 군데 더** 숨어 있었습니다.

| 사용처 | View 종류 | layoutParams | 상태 |
|:---|:---|:---:|:---:|
| 이벤트 보상 WebView | `WebView` (`height:100vh` HTML) | ❌ 미설정 | 🔴 **같은 vh 버그 — 수정** |
| 커스텀 차트 뷰 | `GwangyChartView` (`LAYER_TYPE_HARDWARE`) | ❌ | ⚠️ Compose 애니메이션 추가 전까지는 정상 |
| 배너 광고 | `AdView` (컨테이너 래핑) | ✅ container `MATCH_PARENT` | ✅ 정상 (SDK가 크기 관리) |
| 배경 이미지 | `ImageView` | ❌ | ✅ 정적 이미지라 타이밍 문제 없음 |

광고 SDK View처럼 **SDK가 직접 크기를 관리하고 `vh`를 쓰지 않는 경우**는 문제가 없습니다. 공식 문서도 `AndroidView`는 "Compose 대응이 없는 SDK 컴포넌트를 래핑하는 용도"로 권장합니다.

---

## 7. 실제 사례 모음 (공개 출처)

우리만 겪은 게 아닙니다. 인터롭 함정은 공개적으로도 반복 보고됩니다.

| 케이스 | View | 근본 원인 | 해결 |
|:---|:---|:---|:---|
| ExoPlayer가 `clip()` 무시 | SurfaceView | 독립 Surface는 Compose clip 미적용 | `surface_type="texture_view"` |
| Android TV 흰 화면 | SurfaceView | Compose `Surface`의 Offscreen 합성 충돌 | `Surface` → `Box` 교체 |
| API 34 동영상 늘어남/잘림 | SurfaceView | Android 14 Surface 동기화 버그 | Media3 `PlayerSurface` 사용 |
| WebView 전체화면 안 됨 | WebView | `layoutParams` 미설정, 뷰포트 0×0 | `factory`에서 `MATCH_PARENT` |
| 동영상 재시작 | ExoPlayer | Recomposition 시 `factory` 재실행 | `remember`로 인스턴스 유지 |
| RecyclerView 상태 소실 | ComposeView | `ViewCompositionStrategy` 미설정 | `DisposeOnViewTreeLifecycleDestroyed` |
| AdMob 메모리 누수 | AdView | `onRelease`에서 `destroy()` 누락 | `onRelease { adView.destroy() }` |

특히 비디오/카메라를 Compose에서 다룬다면, 구글은 `SurfaceView` 직접 사용 대신 `AndroidExternalSurface` / `AndroidEmbeddedExternalSurface`(또는 Media3 `PlayerSurface`)를 공식 권장합니다.

**참고 출처**
- [Using Views in Compose — Android Developers](https://developer.android.com/develop/ui/compose/migrate/interoperability-apis/views-in-compose)
- [Surface types (Media3) — Android Developers](https://developer.android.com/media/media3/ui/surface)
- [Hardware Acceleration — Android Developers](https://developer.android.com/develop/ui/views/graphics/hardware-accel)
- [WebView not showing as full screen in Compose UI — Medium](https://medium.com/@fox.fu.go/webview-not-showing-as-full-screen-in-compose-ui-f2b3e9570ff6)
- [Why Your ExoPlayer Video Ignores Compose Clipping — Medium](https://medium.com/@art_hacker_/why-your-exoplayer-video-ignores-compose-clipping-and-the-one-line-fix-that-solves-it-727650b7cc7e)
- [ViewCompositionStrategy Demystified — Android Developers Blog](https://medium.com/androiddevelopers/viewcompositionstrategy-demystefied-276427152f34)
- [SurfaceView stretched/cropped on API 34 — androidx/media #1237](https://github.com/androidx/media/issues/1237)

---

## 8. 오늘의 교훈

기술 자체보다 **잘못된 전제 하나가 더 위험하다**는 것을 배웠습니다. "Compose가 WebView와 안 맞는다"는 그럴듯한 가설이 진짜 원인(`layoutParams` 미설정)을 40개 커밋 동안 가려버렸으니까요.

정리하면 이렇습니다.

1. **`Modifier`와 `LayoutParams`는 별개의 측정 시스템이다.** `Modifier.fillMaxSize()`는 Compose 레이어 전용이며 내부 View에 자동 전달되지 않는다 — `factory`에서 `layoutParams = MATCH_PARENT`를 직접 설정하라.
2. **`vh`/`vw` CSS 페이지는 `loadUrl()` 전에 뷰 크기가 확정돼 있어야 한다.**
3. **그럼에도, 웹 게임처럼 복잡한 인터랙션·세션이 핵심이라면 Pure View Activity로 분리하는 것이 가장 안정적이다.** `vh`와 터치 문제를 한 번에 없애준다.
4. **막혔을 때는 가설을 의심하라.** 같은 방향으로 39번 더 파기 전에, 가장 단순한 전제부터 검증하는 편이 빠르다.

> **💡 한 줄 정리**: 도화지(Compose)와 괴물(WebView)을 같이 그리는 것 자체는 가능하다. 단, 괴물에게 먼저 **자리(`layoutParams = MATCH_PARENT`)**를 정확히 내어줘라. 그게 안 되면 전용 운동장(Pure View)으로 보내라.
