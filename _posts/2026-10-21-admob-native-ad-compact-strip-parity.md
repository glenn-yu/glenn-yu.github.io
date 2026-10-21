---
layout: post
title: "[Android/iOS] 네이티브 광고가 200dp로 커진 이유 — Compose와 SwiftUI에서 무자극 64dp 컴팩트 스트립 정합하기"
date: 2026-10-21 21:00:00 +0900
categories: [Mobile, Adtech, UIUX]
tags: [Android, iOS, JetpackCompose, SwiftUI, AdMob, NativeAds, Parity, UIUX, CleanArchitecture]
excerpt: "네이티브 광고 뷰를 구현할 때 흔히 저지르는 세로 적층과 중첩 패딩으로 인해 광고가 화면의 1/3을 가리는 참사가 발생했다. 이를 64dp 컴팩트 가로 스트립으로 통일하고, 양 플랫폼에서 실패 시 0dp 접힘과 AdChoices 인셋을 완벽하게 맞춘 과정을 정리한다."
---

"광고 위치가 다른 앱들이랑 달라요. 사이즈도 안 맞고 너무 커 보여요."

출시를 앞둔 한 비디오 유틸리티 앱의 테스트 빌드를 확인하던 중 들어온 피드백이었습니다. 화면을 켜자마자 눈에 들어온 것은 앱의 콘텐츠가 아니라 화면 하단을 육중하게 짓누르고 있는 거대한 광고 블록이었습니다. 

분명 기획 단계에서는 "사용자의 작업 흐름을 방해하지 않는 자연스러운 네이티브 광고"를 의도했으나, 실제 렌더링된 화면은 배너보다 4배나 큰 **200dp짜리 광고 덩어리**가 되어 있었습니다.

코드를 열어 원인을 분석하고, Android(Jetpack Compose)와 iOS(SwiftUI) 양쪽에서 **모바일 네이티브 광고의 황금 규격인 64dp 가로 컴팩트 스트립**으로 완전히 뜯어고치며 정합한 과정을 정리합니다.

---

## 1. 200dp 참사의 원인 분석

문제는 플랫폼마다 다른 방식으로 발생했지만, 본질은 같았습니다. **"SDK 기본 뷰 계층에 대한 무비판적 수용"과 "컴포넌트 패딩의 중첩"**이었습니다.

### Android: 습관적인 `LinearLayout.VERTICAL` 적층

Android의 네이티브 광고 구현 코드를 확인해 보니 다음과 같은 구조였습니다.

```kotlin
// 문제가 된 구버전 코드 (높이 ~200dp 비대화)
internal fun createNativeAdView(context: Context): NativeAdView {
    val adView = NativeAdView(context)
    val column = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(context.dp(12), context.dp(12), context.dp(12), context.dp(12))
    }
    
    // 위에서 아래로 무조건 쌓아 올림
    column.addView(TextView(context).apply { id = R.id.native_ad_label })
    column.addView(TextView(context).apply { id = R.id.native_ad_headline })
    column.addView(TextView(context).apply { id = R.id.native_ad_body })
    column.addView(Button(context).apply { id = R.id.native_ad_cta })
    
    adView.addView(column, LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    return adView
}
```

Compose 상위에서는 이를 감싸면서 `modifier.fillMaxWidth().wrapContentHeight()`를 주었습니다.
- 광고주 아이콘 뷰는 아예 없었고,
- `[AD] 뱃지` → `헤드라인` → `설명문(Body)` → `CTA 버튼`을 4줄로 수직 적층했습니다.
- 광고 텍스트가 2줄 이상으로 줄바꿈되면 높이가 **180~200dp 이상**으로 부풀어 올랐습니다.
- 게다가 좌우 16dp 인셋도 없어 화면 베젤 끝까지 닿아 답답한 인상을 주었습니다.

### iOS: `.cardStyle()`과 고정 프레임의 충돌

iOS(SwiftUI)는 반대로 고정 프레임을 주었음에도 Modifier가 중첩되면서 높이가 부풀려졌습니다.

```swift
// 문제가 된 구버전 코드 (높이 136pt로 부풀려짐)
NativeAdContainer(nativeAd: ad)
    .frame(height: 72)
    .cardStyle() // 내부적으로 사방 16pt 패딩 + 배경 + 모서리 반경 적용
    .padding(.top, 16)
    .padding(.bottom, aboveNavigation ? 16 : 0)
```

`Theme.swift`에 정의된 공용 `.cardStyle()` 내부를 보면 `content.padding(16)`이 포함되어 있었습니다. 프레임 72pt에 상하 패딩 32pt가 더해지고, 외부 컨테이너의 상하 패딩 16~32pt가 한 번 더 붙으면서 실제 렌더링 점유 높이는 **136pt**를 넘어섰습니다.

---

## 2. 무자극 네이티브 광고의 규격: 64dp 가로 컴팩트 스트립

사용자가 무료 유틸리티 앱을 쓸 때 가장 불쾌감을 느끼는 순간은 **"내가 지금 하려는 작업 영역을 광고가 침범할 때"**입니다. 

그렇다고 광고 높이를 너무 줄이면 AdMob 정책(AdChoices 아이콘 가림, 텍스트 잘림)에 걸립니다. 수많은 실측 끝에 도출한 함대 표준 규격은 **64dp 가로 컴팩트 스트립 (큰 글씨 환경 72dp)**입니다.

```
┌────────────────────────────────────────────────────────────────────────┐
│  ┌──────┐  ┌────┐                                        ┌──────────┐  │
│  │      │  │ AD │ 헤드라인 텍스트 (1줄 말줄임)           │   CTA    │ ℹ│
│  │ 40dp │  └────┘                                        │  48dp    │  │
│  │      │  보조정보 / 광고주 이름 (1줄)                  │ (버튼)   │  │
│  └──────┘                                                └──────────┘  │
└────────────────────────────────────────────────────────────────────────┘
│← 16dp →│                 카드 높이: 64dp                │← 16dp →│
```

### 치수 상세 설계 (`CompactAdMetrics`)

- **슬롯 높이**: 기본 `64dp/pt`, 시스템 접근성 큰 글씨 설정 시 `72dp/pt`.
- **내부 카드**: 4dp inset 적용 → `56dp/pt` 카드 본체 (상하 2dp 패딩 → `52dp` 콘텐츠 영역).
- **광고주 아이콘**: `40×40dp/pt`, 모서리 `8dp/pt` 라운딩.
- **헤드라인 & 보조 정보**: 가로 1열 가변 너비, 반드시 1줄 말줄임(`maxLines = 1`, `ellipsize = END` / `lineLimit(1)`).
- **CTA 버튼**: 높이 `48dp` (iOS HIG 기준 `44pt`), 최소 너비 `56dp/pt`, 앰버(Amber) 강조색으로 앱 UI와 시각적 분리.
- **AdChoices 마커**: `20×20dp/pt` (우상단 4dp 인셋 보장).
- **무광고 접힘 (Zero-Height Collapse)**: 로드 전이거나 실패 시 높이 **0dp/pt 및 마진 0**으로 완전 소멸.

---

## 3. Android 구현: Jetpack Compose + 프로그래매틱 View

Android에서는 XML 인플레이션 오버헤드를 없애고 Compose의 테마 토큰(`MaterialTheme.colorScheme`)과 폰트 스케일을 즉시 바인딩할 수 있도록 Kotlin 코드로 프로그래매틱하게 뷰 트리를 구성했습니다.

### 1) Compose 컨테이너: 0dp 접힘 및 큰 글씨 감지

```kotlin
@Composable
fun NativeAdSlot(
    placement: AdPlacement,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val manager = remember(context) { NativeAdManager.getInstance(context) }
    val nativeAd by manager.ad(placement).collectAsState()

    DisposableEffect(placement) {
        manager.preload(placement)
        onDispose { }
    }

    // 광고가 없으면 아무것도 그리지 않고 높이 0으로 접힘
    val ad = nativeAd ?: return

    val fontScale = LocalDensity.current.fontScale
    val slotHeight = if (fontScale >= 1.3f) 72.dp else 64.dp
    val scheme = MaterialTheme.colorScheme
    val darkTheme = scheme.background.luminance() < 0.5f

    val palette = NativeAdPalette(
        card = scheme.surfaceVariant.toArgb(),
        cardStroke = if (darkTheme) 0xFF94A3B8.toInt() else 0xFF64748B.toInt(),
        primaryText = scheme.onSurface.toArgb(),
        secondaryText = scheme.onSurfaceVariant.toArgb(),
        cta = if (darkTheme) 0xFFF5B94A.toInt() else 0xFF8F5000.toInt() // 앰버 강조
    )

    key(ad) {
        AndroidView(
            modifier = modifier
                .fillMaxWidth()
                .height(slotHeight)
                .padding(horizontal = 16.dp),
            factory = { ctx -> createNativeAdView(ctx) },
            update = { view -> bindNativeAd(view, ad, palette) },
            onRelease = { runCatching { it.destroy() } }
        )
    }
}
```

### 2) 가로 1열 프로그래매틱 뷰 트리

```kotlin
internal fun createNativeAdView(context: Context): NativeAdView {
    val adView = NativeAdView(context).apply {
        layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
        descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
    }

    // 1. 가로 카드 레이아웃
    val card = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        val vPad = context.dp(2)
        setPadding(context.dp(6), vPad, context.dp(22), vPad) // AdChoices 자리 22dp 확보
        layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT).apply {
            val inset = context.dp(4)
            setMargins(inset, inset, inset, inset)
        }
    }

    // 2. 40dp 아이콘 (8dp 둥근 모서리 클리핑)
    val iconView = ImageView(context).apply {
        id = R.id.native_ad_icon
        layoutParams = LinearLayout.LayoutParams(context.dp(40), context.dp(40)).apply {
            marginEnd = context.dp(8)
        }
        scaleType = ImageView.ScaleType.CENTER_CROP
        clipToOutline = true
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                outline.setRoundRect(0, 0, view.width, view.height, context.dp(8).toFloat())
            }
        }
    }
    card.addView(iconView)

    // 3. 헤드라인 + 보조정보 텍스트 컬럼 (1줄 말줄임 강제)
    val textColumn = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL
        layoutParams = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f)
    }
    // [AD] 라벨과 헤드라인을 담는 Title Row
    val titleRow = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }
    titleRow.addView(TextView(context).apply {
        id = R.id.native_ad_label
        text = "AD"
        textSize = 11f
        typeface = Typeface.DEFAULT_BOLD
    })
    titleRow.addView(TextView(context).apply {
        id = R.id.native_ad_headline
        textSize = 13f
        typeface = Typeface.DEFAULT_BOLD
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
    })
    textColumn.addView(titleRow)

    val secondary = TextView(context).apply {
        id = R.id.native_ad_body
        textSize = 11f
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
    }
    textColumn.addView(secondary)
    card.addView(textColumn)

    // 4. CTA 버튼 (48dp 터치 높이 확보)
    val cta = Button(context, null, android.R.attr.borderlessButtonStyle).apply {
        id = R.id.native_ad_cta
        textSize = 12f
        isAllCaps = false
        maxLines = 1
        minWidth = context.dp(56)
        layoutParams = LinearLayout.LayoutParams(WRAP_CONTENT, context.dp(48))
    }
    card.addView(cta)
    adView.addView(card)

    // 5. AdChoices 마커 (우상단 4dp 인셋)
    adView.addView(
        AdChoicesView(context),
        FrameLayout.LayoutParams(context.dp(20), context.dp(20), Gravity.TOP or Gravity.END).apply {
            val inset = context.dp(4)
            setMargins(0, inset, inset, 0)
        }
    )

    return adView
}
```

---

## 4. iOS 구현: SwiftUI + UIViewRepresentable

iOS에서도 SwiftUI 뷰 계층 안에서 높이 팽창이 일어나지 않도록 `UIViewRepresentable` 내부에서 `UIStackView`와 오토레이아웃 제약조건을 걸어줍니다.

### 1) 치수 및 다크모드 팔레트 정의

```swift
enum CompactAdMetrics {
    static let height: CGFloat = 64
    static let maxHeight: CGFloat = 72
    static let iconSize: CGFloat = 40
    static let iconCornerRadius: CGFloat = 8
    static let ctaHeight: CGFloat = 44
    static let cardCornerRadius: CGFloat = 12
    static let adChoicesSize: CGFloat = 20
}

enum CompactAdPalette {
    static let cta = dynamic(light: 0x8F_50_00, dark: 0xF5_B9_4A)
    static let cardStroke = dynamic(light: 0x64_74_8B, dark: 0x94_A3_B8)

    private static func dynamic(light: Int, dark: Int) -> UIColor {
        UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255.0,
                green: CGFloat((hex >> 8) & 0xFF) / 255.0,
                blue: CGFloat(hex & 0xFF) / 255.0,
                alpha: 1.0
            )
        }
    }
}
```

### 2) SwiftUI 슬롯: 동의·라이프사이클·크기 가드

```swift
struct NativeAdSlot: View {
    let placement: AdPlacement
    var aboveNavigation = false
    @EnvironmentObject private var consent: ConsentManager
    @Environment(\.startupDestinationIsActive) private var destinationIsActive
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @StateObject private var model = NativeAdModel()

    // 1. UMP 동의 + 화면 활성화 + 포그라운드 3대 조건 충족 시에만 로드
    private var canLoadAds: Bool {
        consent.canLoadAds && destinationIsActive && scenePhase == .active
    }
    private var slotHeight: CGFloat {
        dynamicTypeSize.isAccessibilitySize ? CompactAdMetrics.maxHeight : CompactAdMetrics.height
    }

    var body: some View {
        Group {
            // 2. 광고가 없으면 슬롯 자체가 렌더되지 않아 높이 0pt로 접힘
            if canLoadAds, let ad = model.ad {
                NativeAdContainer(nativeAd: ad)
                    .frame(height: slotHeight)
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, aboveNavigation ? 16 : 0)
            }
        }
        .onAppear { model.loadIfAllowed(canRequestAds: canLoadAds, placement: placement) }
        .onChange(of: canLoadAds) { allowed in
            model.loadIfAllowed(canRequestAds: allowed, placement: placement)
        }
    }
}
```

---

## 5. 실전에서 마주친 두 가지 함정과 해결책

### 함정 1: 아이콘이 없는 텍스트 전용 광고

일부 광고주는 1:1 앱 아이콘을 등록하지 않고 텍스트만 전송합니다. 이때 `ImageView`가 빈 채로 남아있으면 왼쪽 공간이 흉하게 비어 보입니다.

**해결책**: 광고주 아이콘이 `null`일 경우 헤드라인 첫 글자를 딴 **모노그램 뱃지(`MonogramDrawable`)**를 대신 그려 넣어 레이아웃 정렬이 무너지지 않도록 방어했습니다.

### 함정 2: AdMob 테스트 검증기의 "MediaView 누락" 오판 방지

AdMob SDK는 네이티브 광고에 `MediaView`가 없으면 테스트 빌드에서 "MediaView가 누락되었습니다"라는 경고 팝업을 띄우곤 합니다. 하지만 64dp 컴팩트 스트립은 정책상 이미지/비디오 미디어를 싣지 않는 텍스트+아이콘 전용 지면입니다.

**해결책**: iOS `Info.plist`에 `GADNativeAdValidatorEnabled = false`를 선언하여 불필요한 유효성 검사기 오판을 끄고, 검증은 자체 단위 테스트(`AdSlotContrastTests`)와 스냅샷으로 수행합니다.

### 함정 3: Android 종료 팝업의 AdChoices 마커 겹침

Android의 "뒤로가기 두 번 눌러 앱 종료" 다이얼로그(`FleetExitDialog`) 하단에 네이티브 광고를 넣을 때, Google의 AdChoices 마커(i 모양 아이콘)가 다이얼로그 카드의 둥근 모서리 바깥으로 삐져나가는 시각적 결함이 있었습니다.

**해결책**: 다이얼로그 카드 호스트에 사방 `12dp`의 안전 패딩(`cardPadding`)을 두고, 네이티브 광고 뷰의 `AdChoicesView` 위치를 우측 상단 4dp 인셋으로 고정하여 닫기 버튼 및 모서리와 충돌하지 않도록 조정했습니다.

---

## 6. 정리: 무자극 네이티브 광고 체크리스트

| 점검 항목 | 기준값 | 실패 시 증상 |
| :--- | :--- | :--- |
| **슬롯 높이** | `64dp/pt` (큰 글씨 `72dp/pt`) | 100dp 이상 부풀어 올라 메인 콘텐츠 침범 |
| **텍스트 줄 수** | `maxLines = 1` + 말줄임 | 광고 내용에 따라 높이가 들쑥날쑥 팽창 |
| **미로드/실패 처리** | `height = 0.dp` 완전 접힘 | 광고 미로드 시 화면 하단에 휑한 빈 상자 노출 |
| **화면 여백** | 좌우 `16dp` 인셋 | 화면 베젤 끝까지 닿아 답답한 렌더링 |
| **사운드 정책** | `setAppMuted(true)` | 공공장소/독서실에서 비디오 광고 소리 테러 |

이번 정합 작업을 통해 8개 앱 전체의 네이티브 광고 슬롯이 동일한 64dp 컴팩트 스트립으로 통일되었습니다. 광고를 완전히 없앨 수 없는 무료 앱이라면, **"존재하되 절대 거슬리지 않는 단정한 크기"**를 지키는 것이 개발자가 유저에게 보여줄 수 있는 최소한의 예의이자 품격입니다.
