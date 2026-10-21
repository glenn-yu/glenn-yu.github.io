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
val container = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(16.dp, 16.dp, 16.dp, 16.dp)
}

val adBadge = TextView(context).apply { text = "AD" }
val headline = TextView(context).apply { textSize = 16f }
val body = TextView(context).apply { textSize = 14f }
val cta = Button(context).apply { text = "설치하기" }

// 위에서 아래로 무조건 쌓아 올림
container.addView(adBadge)
container.addView(headline)
container.addView(body)
container.addView(cta)
```

- 아이콘 뷰가 누락되어 있었고,
- `[AD] 뱃지` → `헤드라인` → `설명문(Body)` → `CTA 버튼`을 4줄로 수직 적층했습니다.
- 광고 텍스트가 2줄 이상으로 줄바꿈되거나 광고주 이미지가 들어올 경우 높이가 **200dp 이상**으로 부풀어 올랐습니다.
- 게다가 화면 좌우 마진도 없어 화면 양 끝에 딱 달라붙어 있었습니다.

### iOS: `.cardStyle()`과 고정 프레임의 충돌

iOS(SwiftUI)는 반대로 고정 프레임을 주었음에도 Modifier가 중첩되면서 높이가 부풀려졌습니다.

```swift
// 문제가 된 구버전 코드 (높이 136pt로 부풀려짐)
NativeAdSlot()
    .frame(height: 72)
    .cardStyle() // 내부적으로 사방 16pt 패딩 + 배경 + 모서리 반경 적용
    .padding(.vertical, 16) // 외부에서 또 16pt 패딩 추가!
```

SwiftUI에서 `frame(height: 72)`를 지정하더라도, 뒤이어 붙은 공용 카드 스타일(`cardStyle()`)의 상하 패딩과 외부 컨테이너의 상하 패딩이 더해지면서 실제 점유 높이는 **136pt**를 넘어섰습니다. 여기에 내부 UIKit 브릿지 뷰의 제약 조건(Constraints) 경고까지 쏟아지고 있었습니다.

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

### 필수 레이아웃 원칙 5가지

1. **가로 1열 단일 스트립**: `[아이콘 40dp]` + `[[AD] + 텍스트 영역]` + `[CTA 48dp]` + `[AdChoices 20dp]`가 가로로 한 줄에 배치됩니다.
2. **높이 상한 64dp / 72dp**: 기본 글꼴 크기에서는 정확히 `64dp`, OS 접근성 '큰 글씨' 모드에서는 `72dp`로 유연하게 늘어납니다.
3. **텍스트 말줄임 강제**: 헤드라인과 보조 정보는 반드시 1줄(`maxLines = 1`, `ellipsize = TextUtils.TruncateAt.END`)로 제한하여 세로 팽창을 원천 차단합니다.
4. **양옆 16dp 인셋**: 콘텐츠 영역과 일치하도록 화면 좌우에 `16dp` 여백을 둡니다.
5. **광고 없을 때 0dp 접힘 (Collapse)**: 광고 로드 전이나 로드 실패(`onAdFailedToLoad`) 시에는 높이 **0dp 및 여백 0**으로 완전히 사라져야 합니다.

---

## 3. Android 구현: Jetpack Compose + View Binding

AdMob의 네이티브 광고 SDK(`com.google.android.gms.ads.nativead.NativeAdView`)는 내부적으로 특정 View가 `headlineView`, `iconView`, `callToActionView`로 등록되어야 클릭 감지와 정책 검증을 통과합니다. 따라서 Compose 환경에서는 `AndroidView`를 통해 경량 XML 레이아웃을 띄우는 것이 가장 안전합니다.

### 1) 경량 가로 스트립 XML (`view_compact_native_ad.xml`)

```xml
<?xml version="1.0" encoding="utf-8"?>
<com.google.android.gms.ads.nativead.NativeAdView
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:id="@+id/native_ad_view"
    android:layout_width="match_parent"
    android:layout_height="wrap_content">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="64dp"
        android:orientation="horizontal"
        android:gravity="center_vertical"
        android:paddingStart="12dp"
        android:paddingEnd="12dp"
        android:background="@drawable/bg_compact_ad_card">

        <!-- 40dp 광고주 아이콘 -->
        <ImageView
            android:id="@+id/ad_app_icon"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:scaleType="centerCrop"
            android:background="@drawable/bg_ad_icon_rounded" />

        <!-- 헤드라인 + 보조정보 -->
        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:layout_marginStart="10dp"
            android:layout_marginEnd="8dp"
            android:orientation="vertical">

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:orientation="horizontal">

                <TextView
                    android:id="@+id/ad_attribution"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="AD"
                    android:textSize="10sp"
                    android:textStyle="bold"
                    android:textColor="#E08A00"
                    android:background="@drawable/bg_ad_badge"
                    android:paddingHorizontal="4dp"
                    android:paddingVertical="1dp" />

                <TextView
                    android:id="@+id/ad_headline"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="6dp"
                    android:maxLines="1"
                    android:ellipsize="end"
                    android:textSize="13sp"
                    android:textStyle="bold"
                    android:textColor="?attr/colorOnSurface" />
            </LinearLayout>

            <TextView
                android:id="@+id/ad_body"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="2dp"
                android:maxLines="1"
                android:ellipsize="end"
                android:textSize="11sp"
                android:textColor="?attr/colorOnSurfaceVariant" />
        </LinearLayout>

        <!-- CTA 버튼 (48dp 높이) -->
        <Button
            android:id="@+id/ad_call_to_action"
            android:layout_width="wrap_content"
            android:layout_height="36dp"
            android:minWidth="64dp"
            android:paddingHorizontal="12dp"
            android:textSize="12sp"
            android:textStyle="bold"
            android:background="@drawable/bg_ad_cta_button" />
    </LinearLayout>
</com.google.android.gms.ads.nativead.NativeAdView>
```

### 2) Compose 슬롯 컴포저블: 0dp 접힘 보장

```kotlin
@Composable
fun CompactNativeAdSlot(
    nativeAd: NativeAd?,
    modifier: Modifier = Modifier
) {
    // 광고가 없으면 높이와 마진을 완전히 0으로 수축
    if (nativeAd == null) {
        Spacer(modifier = Modifier.height(0.dp))
        return
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
    ) {
        AndroidView(
            factory = { context ->
                val binding = ViewCompactNativeAdBinding.inflate(LayoutInflater.from(context))
                val adView = binding.root

                adView.headlineView = binding.adHeadline
                adView.bodyView = binding.adBody
                adView.callToActionView = binding.adCallToAction
                adView.iconView = binding.adAppIcon

                bindNativeAd(adView, binding, nativeAd)
                adView
            },
            update = { adView ->
                val binding = ViewCompactNativeAdBinding.bind(adView)
                bindNativeAd(adView, binding, nativeAd)
            },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 64.dp, max = 72.dp)
        )
    }
}
```

---

## 4. iOS 구현: SwiftUI + UIViewRepresentable

iOS에서도 SwiftUI 뷰 계층 안에서 높이 팽창이 일어나지 않도록 `UIViewRepresentable` 내부에서 명시적 오토레이아웃 제약조건을 걸어줍니다.

```swift
struct CompactNativeAdView: UIViewRepresentable {
    let nativeAd: GADNativeAd?

    func makeUIView(context: Context) -> GADNativeAdView {
        let adView = GADNativeAdView()
        adView.translatesAutoresizingMaskIntoConstraints = false
        setupCompactLayout(adView)
        return adView
    }

    func updateUIView(_ adView: GADNativeAdView, context: Context) {
        guard let nativeAd = nativeAd else {
            adView.isHidden = true
            return
        }
        adView.isHidden = false
        populateNativeAd(adView, with: nativeAd)
    }

    private func setupCompactLayout(_ adView: GADNativeAdView) {
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        container.layer.cornerRadius = 12
        container.layer.borderWidth = 1
        container.layer.borderColor = UIColor.separator.cgColor
        adView.addSubview(container)

        // 고정 64pt 제약조건 (접근성 모드 고려 시 >= 64, <= 72)
        NSLayoutConstraint.activate([
            container.topAnchor.constraint(equalTo: adView.topAnchor),
            container.bottomAnchor.constraint(equalTo: adView.bottomAnchor),
            container.leadingAnchor.constraint(equalTo: adView.leadingAnchor),
            container.trailingAnchor.constraint(equalTo: adView.trailingAnchor),
            container.heightAnchor.constraint(greaterThanOrEqualToConstant: 64),
            container.heightAnchor.constraint(lessThanOrEqualToConstant: 72)
        ])
        
        // 아이콘, 헤드라인, CTA 버튼 서브뷰 레이아웃 생략...
    }
}
```

SwiftUI 상위 뷰에서는 추가 패딩을 이중으로 주지 않고 간결하게 사용합니다.

```swift
struct BottomAdBanner: View {
    let nativeAd: GADNativeAd?

    var body: some View {
        if let ad = nativeAd {
            CompactNativeAdView(nativeAd: ad)
                .frame(maxWidth: .infinity)
                .frame(height: 64)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
        }
    }
}
```

---

## 5. 실전에서 마주친 두 가지 함정과 해결책

### 함정 1: 아이콘이 없는 텍스트 전용 광고

일부 광고주는 1:1 앱 아이콘을 등록하지 않고 텍스트만 전송합니다. 이때 `ImageView`가 빈 채로 남아있으면 왼쪽 공간이 흉하게 비어 보입니다.

**해결책**: 광고주 아이콘이 `null`일 경우 헤드라인 첫 글자를 딴 **모노그램 뱃지(`MonogramDrawable`)**를 대신 그려 넣어 레이아웃 정렬이 무너지지 않도록 방어했습니다.

```kotlin
val icon = nativeAd.icon
if (icon != null) {
    binding.adAppIcon.setImageDrawable(icon.drawable)
    binding.adAppIcon.visibility = View.VISIBLE
} else {
    // 첫 글자 모노그램 폴백
    val firstChar = nativeAd.headline?.firstOrNull()?.toString() ?: "A"
    binding.adAppIcon.setImageDrawable(MonogramDrawable(firstChar, context))
    binding.adAppIcon.visibility = View.VISIBLE
}
```

### 함정 2: Android 종료 팝업의 AdChoices 마커 겹침 현상

Android의 "뒤로가기 두 번 눌러 앱 종료" 다이얼로그(`FleetExitDialog`) 하단에 네이티브 광고를 넣을 때, Google의 AdChoices 마커(i 모양 아이콘)가 다이얼로그 카드의 둥근 모서리 바깥으로 삐져나가는 시각적 결함이 있었습니다.

**해결책**: 다이얼로그 카드 호스트에 사방 `12dp`의 안전 패딩(`cardPadding`)을 두고, 네이티브 광고 뷰의 `setAdChoicesView()` 위치를 우측 하단에서 우측 상단으로 이동시켜 닫기 버튼 및 모서리와 충돌하지 않도록 조정했습니다.

---

## 6. 정리: 무자극 네이티브 광고 체크리스트

모바일 앱에서 광고는 양날의 검입니다. 수익을 위해 넣지만, 유저의 시각적 흐름을 깨뜨리는 순간 앱의 완성도 전체가 의심받게 됩니다.

| 점검 항목 | 기준값 | 실패 시 증상 |
| :--- | :--- | :--- |
| **카드 높이** | `64dp` (큰 글씨 `72dp`) | 100dp 이상 부풀어 올라 메인 콘텐츠 침범 |
| **텍스트 줄 수** | `maxLines = 1` + 말줄임 | 광고 내용에 따라 높이가 들쑥날쑥 팽창 |
| **로드 실패 처리** | `height = 0.dp` 완전 접힘 | 광고 미로드 시 화면 하단에 휑한 빈 상자 노출 |
| **화면 여백** | 좌우 `16dp` 인셋 | 화면 베젤 끝까지 닿아 답답한 렌더링 |
| **사운드 정책** | `setAppMuted(true)` | 공공장소/독서실에서 비디오 광고 소리 테러 |

이번 정합 작업을 통해 8개 앱 전체의 네이티브 광고 슬롯이 동일한 64dp 컴팩트 스트립으로 통일되었습니다. 광고를 완전히 없앨 수 없는 무료 앱이라면, **"존재하되 절대 거슬리지 않는 단정한 크기"**를 지키는 것이 개발자가 유저에게 보여줄 수 있는 최소한의 예의이자 품격입니다.
