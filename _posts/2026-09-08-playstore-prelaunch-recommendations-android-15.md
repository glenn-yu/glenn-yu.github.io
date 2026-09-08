---
layout: post
title: "[Android] Google Play Console 권장 조치 3종 완벽 해결기 — Android 15 Edge-to-Edge, Deprecated 창 API, 비트맵 최적화"
date: 2026-09-08 22:35:00 +0900
categories: [Android, PlayStore, Optimization]
tags: [Android, PlayConsole, Android15, EdgeToEdge, Insets, DeprecatedAPI, Bitmap, AdMob, Mobile, Performance]
excerpt: "Google Play Console 사전 출시 보고서에서 반복적으로 나타나는 3대 권장 조치(Edge-to-Edge 강제 적용, Deprecated 창 제어 API, 비트맵 수동 디코딩 및 ads_mobile_sdk)의 원인과 실무 대처 방안을 정리한다."
---

새로운 안드로이드 앱 빌드를 Google Play Console에 업로드하고 사전 출시 보고서(Pre-launch report)나 권장 조치 탭을 열어보면, 특정 빌드부터 끈질기게 따라붙는 노란색 경고 삼총사가 있습니다.

1. **"일부 사용자에게는 더 넓은 화면이 표시되지 않을 수 있습니다"** (Edge-to-Edge 인셋 미처리)
2. **"앱에서 더 넓은 화면용으로 지원 중단된 API 또는 파라미터를 사용합니다"** (`setStatusBarColor`, `gv0.b` 등)
3. **"비트맵 이미지 최적화로 앱 성능을 개선하세요"** (`ads_mobile_sdk`, `invokeSuspend` 수동 디코딩)

앱이 당장 크래시가 나거나 배포가 차단되는 심각한 에러는 아니지만, Android 15(API Level 35) 타겟팅 기준 및 Play Console 심사 품질 지표에 계속 남아 신경을 긁는 녀석들입니다. 특히 R8 난독화로 인해 `gv0.b`, `ads_mobile_sdk` 같은 정체불명의 패키지가 찍혀 있으면 어디서부터 손을 대야 할지 난감해지기 쉽습니다.

이번 글에서는 이 세 가지 경고가 발생하는 근본적인 원인과 실무 프로젝트에서 깔끔하게 경고를 지우고 성능/UX를 개선하는 해결 방안을 하나씩 정리합니다.

---

## 1. 이슈 1: "일부 사용자에게는 더 넓은 화면이 표시되지 않을 수 있습니다"

### 원인: Android 15(API 35)부터 기본 강제되는 Edge-to-Edge
Android 15부터 `targetSdkVersion = 35`를 설정한 앱은 **엣지 투 엣지(Edge-to-Edge, 전체 화면 표시)가 시스템 차원에서 기본 강제**됩니다. 

과거에는 개발자가 원할 때만 상태 표시줄과 내비게이션 바 영역까지 뷰를 확장했지만, 이제는 시스템 바 뒤쪽으로 콘텐츠가 무조건 파고듭니다. 따라서 앱이 **Window Insets(창 여백)** 처리를 명시적으로 하지 않으면 상단 툴바가 카메라 노치나 상태바 시계에 가려지고, 하단 버튼이 제스처 핸들 바나 3버튼 내비게이션과 겹쳐 사용자가 터치할 수 없게 됩니다.

Play Console은 앱 내 `enableEdgeToEdge()` 적용 여부와 Inset 처리 누락 가능성을 사전 검사하여 이 경고를 띄웁니다.

### 해결 방법

#### 1) Activity에 `enableEdgeToEdge()` 적용
`androidx.activity:activity-ktx:1.9.0` 이상의 라이브러리를 사용하며, 모든 Activity의 `onCreate()`에서 `setContentView()` **직전**에 호출해야 합니다.

```kotlin
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // [중요] 반드시 setContentView 전에 호출
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        
        setupWindowInsets()
    }
}
```

#### 2) View(XML) 기반 프로젝트: 시스템 바 Inset 리스너 적용
최상위 루트 뷰(또는 상/하단 고정 바)에 Inset 크기만큼 패딩을 주어 UI가 가려지지 않는 안전 영역(Safe Area)을 확보합니다.

```kotlin
private fun setupWindowInsets() {
    val rootView = findViewById<View>(R.id.root_container)
    
    ViewCompat.setOnApplyWindowInsetsListener(rootView) { view, windowInsets ->
        val insets = windowInsets.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
        
        view.updatePadding(
            left = insets.left,
            top = insets.top,
            right = insets.right,
            bottom = insets.bottom
        )
        
        WindowInsetsCompat.CONSUMED
    }
}
```

#### 3) Jetpack Compose 기반 프로젝트: `safeDrawing` 인셋 활용
Compose에서는 `Scaffold`가 인셋을 기본적으로 지원합니다.

```kotlin
setContent {
    MyTheme {
        Scaffold(
            contentWindowInsets = WindowInsets.safeDrawing
        ) { innerPadding ->
            Box(modifier = Modifier.padding(innerPadding)) {
                // UI 콘텐츠
            }
        }
    }
}
```

---

## 2. 이슈 2: "지원 중단된 API 또는 파라미터 사용" (`gv0.b`, `e2.q`)

### 원인: 무용지물이 된 레거시 시스템 창 API
Play Console에 찍힌 지원 중단 API 목록:
- `android.view.Window.setStatusBarColor`
- `android.view.Window.setNavigationBarColor`
- `WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`

Android 15에서는 시스템 바가 기본적으로 투명/반투명 처리되고 앱 화면이 밑에 깔리기 때문에, 코드로 시스템 바를 단색으로 칠하는 `setStatusBarColor()` / `setNavigationBarColor()`는 **Deprecated 처리되었으며 Android 15 기기에서는 호출해도 완전히 무시(No-op)**됩니다.

또한 디스플레이 컷아웃(노치) 모드 역시 `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES` 대신 기본 Edge-to-Edge 규칙에 맡기거나 `ALWAYS` 모드를 사용해야 합니다.

### 난독화된 스택(`gv0.b`, `hv0.b`, `e2.q`) 추적법
경고 메시지에 나오는 `gv0.b` 등은 R8 난독화가 걸려 클래스명을 숨긴 결과입니다.
- **원인 1**: 앱 소스코드 내부에서 구형 방식으로 상태바 색상을 변경하는 유틸 함수
- **원인 2**: 구버전 `androidx.appcompat`, `material`, 혹은 오래된 Splash/Navigation 라이브러리 내부 호출

**대처 방안:**
1. **레거시 코드 제거 & `WindowInsetsControllerCompat` 전환**:
   상태바 배경색 대신, 배경 밝기에 맞춰 **아이콘 색상(Light/Dark)**만 제어하도록 변경합니다.
   ```kotlin
   val windowInsetsController = WindowCompat.getInsetsController(window, window.decorView)
   
   // true: 어두운 아이콘 (흰색/밝은 배경용)
   // false: 밝은 아이콘 (검은색/어두운 배경용)
   windowInsetsController.isAppearanceLightStatusBars = isLightTheme
   windowInsetsController.isAppearanceLightNavigationBars = isLightTheme
   ```
2. **`mapping.txt` Play Console 업로드**:
   배포 AAB 빌드 시 생성되는 Proguard 매핑 파일(`app/build/outputs/mapping/release/mapping.txt`)을 Play Console에 업로드하면, `gv0.b`가 아닌 원래 클래스명을 확인하여 범인을 바로 찾을 수 있습니다.
3. **핵심 서드파티 라이브러리 최신화**:
   Material Components(`com.google.android.material:material:1.12.0+`) 및 Core-KTX를 최신 안정 버전으로 갱신합니다.

---

## 3. 이슈 3: "비트맵 이미지 최적화로 앱 성능을 개선하세요"

### 원인: `ads_mobile_sdk`와 코루틴 수동 디코딩의 콜라보
Play Console 경고의 디버그 트레이스를 자세히 보면 답이 있습니다:

```text
id2.invokeSuspend에서 디코딩됨
ads_mobile_sdk.s11.a에서 다운로드됨
s56.run에서 다운로드됨
sd.invokeSuspend에서 다운로드됨
```

이 경고는 두 가지 원인이 복합적으로 작용한 결과입니다:
1. **`ads_mobile_sdk.s11.a`**: Google AdMob (Google Mobile Ads SDK) 내부 모듈입니다. 광고 SDK가 배너/전면 광고 이미지를 네트워크에서 내려받아 디코딩하는 작업을 구글의 자체 사전 검사기가 탐지한 것입니다.
2. **`invokeSuspend` (앱 내부 코드)**: 앱 내 Kotlin 코루틴 비동기 블록에서 URL 스트림을 열고 `BitmapFactory.decodeStream()`을 직접 호출해 비트맵을 디코딩하는 패턴입니다.

네트워크 이미지를 뷰 크기에 맞게 다운샘플링(`inSampleSize`)하지 않고 원본 그대로 메모리에 올리면, 가비지 컬렉터(GC) 압박이 심해지고 저사양 기기에서 즉각적인 OOM(Out of Memory) 크래시를 유발합니다.

### 해결 방법

#### 1) Google Mobile Ads SDK (AdMob) 최신 버전 업그레이드
구글 자체 SDK 이슈는 구글이 가장 잘 압니다. 구버전 SDK의 이미지 디코딩 루틴이 감지되는 경우가 많으므로 `play-services-ads`를 최신 안정 버전(23.x.x 이상)으로 올려줍니다.

```kotlin
// build.gradle.kts
dependencies {
    implementation("com.google.android.gms:play-services-ads:23.3.0")
}
```

#### 2) 앱 내 수동 디코딩 코드를 이미지 전문 라이브러리(Coil / Glide)로 전면 교체
앱 코드 내에 다음과 같은 수동 다운로드 로직이 남아있다면 반드시 걷어내야 합니다.

```kotlin
// ❌ 절대 금지: 메모리 누수 및 Play Console 경고의 주범
suspend fun fetchBitmap(url: String): Bitmap = withContext(Dispatchers.IO) {
    val connection = URL(url).openConnection() as HttpURLConnection
    BitmapFactory.decodeStream(connection.inputStream) // 캐싱 X, 다운샘플링 X
}
```

이를 현대적인 이미지 로더인 **Coil**로 교체합니다.

```kotlin
// build.gradle.kts
implementation("io.coil-kt:coil:2.7.0")

// View(ImageView) 바인딩:
imageView.load("https://example.com/banner.png") {
    crossfade(true)
    placeholder(R.drawable.placeholder)
    error(R.drawable.error)
}

// 비동기로 비트맵 객체만 추출해야 하는 특수 케이스:
val request = ImageRequest.Builder(context)
    .data("https://example.com/banner.png")
    .size(width = 300, height = 300) // 필요한 해상도로 강제 다운샘플링
    .build()
val bitmap = (context.imageLoader.execute(request).drawable as? BitmapDrawable)?.bitmap
```

Coil과 Glide는 내부적으로 **메모리/디스크 2단계 캐싱**, **뷰 크기 기반 자동 다운샘플링**, **비트맵 풀링(BitmapPool 재사용)**을 기본 지원하므로 메모리 사용량을 획기적으로 줄여줍니다.

---

## 4. 최종 배포 체크리스트

다음 릴리즈 빌드를 스토어에 올리기 전, 아래 7가지 항목을 체크하면 Play Console 권장 조치 탭을 깔끔하게 유지할 수 있습니다.

- [ ] `targetSdk = 35` 설정 상태에서 전체 UI 레이아웃 정상 표시 확인
- [ ] 메인 Activity 및 서브 Activity `onCreate()`에 `enableEdgeToEdge()` 호출 누락 없음
- [ ] 상단/하단 Safe Area 처리를 위해 Window Insets 리스너 적용
- [ ] `window.statusBarColor` 및 `setNavigationBarColor` 호출부 제거 완료
- [ ] 상태바/내비바 아이콘 색상은 `WindowInsetsControllerCompat`으로 제어
- [ ] AdMob SDK 최신화 (`play-services-ads:23.3.0+`)
- [ ] 앱 내 모든 네트워크 이미지 로딩에 Coil / Glide 적용
- [ ] Proguard/R8 `mapping.txt` 파일 Play Console 업로드 활성화

---

## 마치며

Android 15의 Edge-to-Edge 기본 적용과 창 API 지원 중단은 처음에는 귀찮은 마이그레이션 작업처럼 느껴지지만, 한 번 제대로 대응해두면 사용자에게 일관되고 시원한 전체 화면 몰입감을 제공할 수 있습니다. 또한 비트맵 디코딩 최적화는 구글 플레이의 '비정상 종료율(Crash Rate)'과 'ANR 발생률' 지표를 크게 낮춰 앱 스토어 검색 노출 순위에도 직접적인 긍정적 영향을 미칩니다.

Play Console의 권장 조치를 단순한 잔소리가 아닌 품질 개선의 기회로 삼아 한 단계 더 단단한 앱을 만들어보세요.
