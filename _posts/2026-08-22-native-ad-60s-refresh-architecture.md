---
layout: post
title: "네이티브 광고 60초 자동 갱신(Ad Refresh)의 함정: eCPM 폭락과 계정 정지를 피하는 4대 원칙"
date: 2026-08-22 14:00:00 +0900
categories: [AdTech, Mobile, Android, iOS]
tags: [AdTech, AdMob, Mobile, Android, iOS, JetpackCompose, SwiftUI, Optimization, Performance, eCPM]
---

모바일 앱을 운영하며 광고 수익화를 진행할 때, 배너나 네이티브 광고의 노출 빈도를 높이기 위해 흔히 **자동 갱신(Auto Refresh)** 기능을 도입합니다. 구글 애드몹(AdMob) 가이드라인에서도 사용자 경험을 해치지 않는 선에서 30초~60초 주기의 갱신을 허용하고 권장하기도 합니다.

하지만 단순하게 "60초마다 광고를 다시 요청하면 되겠지"라며 `LaunchedEffect`나 `Timer`를 달아두는 순간, **노출률(Impression Rate)이 바닥을 치고 eCPM이 1/10로 폭락하거나, 심한 경우 구글로부터 무효 트래픽(Invalid Traffic) 경고를 받고 계정이 정지**되는 대참사를 겪게 됩니다.

이 글에서는 여러 모바일 앱(PaletteWeather, SnackPlay 등)을 운영하며 수많은 시행착오 끝에 정립한 **네이티브 광고 60초 자동 회전 아키텍처와 4대 필수 자격 조건, 그리고 순진한 수학적 구현이 부르는 치명적인 함정**들을 상세히 공유합니다.

---

## 1. 문제의 발단: 왜 단순 타이머는 재앙을 부르는가?

앱 화면 하단이나 피드 사이에 네이티브 광고를 배치하고, 다음과 같이 60초마다 새 광고를 불러오도록 구현했다고 가정해 봅시다.

```kotlin
// ❌ 위험천만한 순진한 타이머 구현
LaunchedEffect(Unit) {
    while (isActive) {
        delay(60_000L)
        adViewModel.loadNextAd()
    }
}
```

언뜻 보면 문제없어 보이지만, 실제 사용자의 기기에서는 다음과 같은 시나리오가 쉴 새 없이 발생합니다.

1. **백그라운드 전환**: 사용자가 홈 화면으로 나가거나 카카오톡 답장을 하러 갔는데도 백그라운드 코루틴/타이머가 돌며 광고를 계속 요청합니다.
2. **스크롤 아웃**: 사용자가 화면을 스크롤하여 광고 뷰가 화면 밖(Viewport 밖)으로 벗어났는데도 계속 새 광고를 요청해 메모리에 쌓습니다.
3. **인앱 브라우징/광고 랜딩**: 사용자가 이전 광고를 클릭하여 인앱 웹뷰나 스토어 상세 페이지를 보고 있는 동안에도 뒤에서 광고 갱신이 일어납니다.
4. **네트워크 지연 중복 요청 (In-flight)**: 지하철 등 네트워크가 느린 곳에서 첫 번째 요청이 10초 넘게 지연되고 있는데, 타이머가 발화하여 두 번째 요청을 중복으로 쏩니다.

### 결과: Ad Network의 철퇴

광고 네트워크(Google AdMob, AppLovin 등)는 **요청(Request) 대비 실제 화면 노출(Impression)의 비율(노출률, Match-to-Impression Rate)**을 매우 엄격하게 감시합니다.

```
요청(Request) 1,000건 발생 ➡️ 실제 사용자가 본 노출(Impression) 50건 ➡️ 노출률 5%
```

노출률이 10% 미만으로 떨어지면 광고 서버는 해당 앱을 **"비정상적인 트래픽을 유발하거나 광고를 숨겨서 로드하는 어뷰징 앱"**으로 분류합니다. 그 결과:
- 고단가 입찰자(Advertiser)들의 비딩이 제외되어 **eCPM이 1/10 이하로 폭락**합니다.
- 광고 충전율(Fill Rate)이 0에 가깝게 제한(Ad Serving Limit)됩니다.
- 최악의 경우 **'무효 트래픽 정책 위반'으로 AdMob 계정이 영구 정지**됩니다.

---

## 2. 수학적 함정: `coerceAtLeast`의 치명적 오류

광고 갱신 주기를 관리할 때 흔히 하는 두 번째 실수는 **경과 시간(Age) 계산과 하한선 적용의 오류**입니다.

"광고가 로드된 지 최소 60초가 지난 시점에만 갱신하고, 만약 로드가 지연되었거나 화면이 다시 켜졌다면 남은 시간만큼만 기다리자"는 의도로 다음과 같은 코드를 작성하기 쉽습니다.

```kotlin
// ❌ 영원히 갱신되지 않는 버그 코드
val elapsed = System.currentTimeMillis() - lastAdLoadedTime
val nextDelay = (REFRESH_INTERVAL_MS - elapsed).coerceAtLeast(REFRESH_INTERVAL_MS)
delay(nextDelay)
```

이 코드의 치명적인 함정이 보이시나요?

`REFRESH_INTERVAL_MS`가 `60_000`(60초)일 때:
- 광고가 로드된 지 10초가 지났다면: `60,000 - 10,000 = 50,000` ➡️ `50,000.coerceAtLeast(60,000)` = **60,000ms**
- 광고가 로드된 지 59초가 지났다면: `60,000 - 59,000 = 1,000` ➡️ `1,000.coerceAtLeast(60,000)` = **60,000ms**
- 광고가 로드된 지 70초가 지났다면: `60,000 - 70,000 = -10,000` ➡️ `-10,000.coerceAtLeast(60,000)` = **60,000ms**

**`coerceAtLeast`의 인자로 주기(60초)를 넣어버렸기 때문에, 남은 대기 시간은 어떤 경우에도 60초 미만으로 내려가지 않습니다.** 즉, 사용자가 50초 동안 앱을 보고 있다가 화면을 껐다 켜도, 10초만 더 기다리면 될 것을 **다시 60초를 풀로 기다리게** 됩니다.

### 올바른 지연 계산 공식

지연은 반드시 **절대 경과 시간(Age)**을 기반으로 0 이상의 남은 시간을 계산해야 하며, 최소 하한선은 네트워크 재시도나 마감 시점 이후에만 적용해야 합니다.

```kotlin
// ✅ 올바른 남은 시간 계산
val age = System.currentTimeMillis() - lastAdLoadedTime
val remaining = REFRESH_INTERVAL_MS - age

val delayMs = when {
    remaining > 0 -> remaining // 아직 60초가 안 지났으면 남은 시간만큼만 대기
    else -> MIN_RETRY_BACKOFF_MS // 이미 60초가 지났다면 즉시 또는 최소 쿨다운(예: 1초) 후 시도
}
```

---

## 3. 안전한 회전을 위한 4대 자격 조건 (Eligibility Guard)

광고 회전 타이머가 발화(Tick)했을 때, 무조건 광고를 요청해서는 안 됩니다. 다음 **4가지 자격 조건(Eligibility)**을 **모두(AND)** 만족할 때만 실제 네트워크 요청을 발행해야 합니다.

```
자격 요건 = [앱 포그라운드] ∧ [슬롯 실제 가시성] ∧ [클릭 목적지 미표시] ∧ [in-flight 아님]
```

```
┌─────────────────────────────────────────────────────────────┐
│                    Ad Refresh Tick (60s)                    │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
   [1. 앱이 포그라운드인가?]                     NO ──► [스킵 & 타이머 대기]
            │ YES
            ▼
   [2. 광고 슬롯이 화면에 보이는가?]             NO ──► [스킵 & 타이머 대기]
            │ YES
            ▼
   [3. 광고 클릭 목적지(웹뷰 등)가 닫혀있는가?]   NO ──► [스킵 & 타이머 대기]
            │ YES
            ▼
   [4. 이미 요청 중인 작업이 없는가?]            NO ──► [스킵 & 타이머 대기]
            │ YES
            ▼
   ┌──────────────────────────────────────────────────────────┐
   │                  Load-then-Swap 광고 로드                 │
   └──────────────────────────────────────────────────────────┘
```

### 1) 앱 포그라운드 (Lifecycle Resumed / Active)
사용자가 앱을 보고 있는 상태여야 합니다.
- **Android**: `Lifecycle.State.RESUMED` 상태 확인
- **iOS**: `scenePhase == .active` 또는 `UIApplication.willEnterForegroundNotification`

### 2) 광고 슬롯 가시성 (Slot Visibility)
광고 뷰가 뷰포트 안에 실제로 들어와 있어야 합니다. 리스트/피드 안에 있는 경우 스크롤 위치를 감지하여 뷰포트와 교차하는지 검사합니다.

### 3) 클릭 목적지 미표시 (No Destination Overlay)
사용자가 네이티브 광고를 터치하여 인앱 브라우저(`CustomTabs`, `SFSafariViewController`)나 전체화면 다이얼로그가 열려 있는 동안에는 뒤쪽 화면의 광고가 갱신되면 안 됩니다. 사용자가 광고를 보러 나간 사이 이전 화면의 광고가 바뀌어 있으면 어뷰징 트래픽으로 오인될 수 있습니다.

### 4) In-flight 중복 차단
이전 요청이 아직 완료되지 않았거나 로딩 중(`isLoading == true`)이라면 새 요청을 트리거하지 않고 스킵합니다.

---

## 4. UI 깜빡임을 없애는 Load-then-Swap 패턴

기존 광고를 교체할 때 흔히 저지르는 또 다른 실수는 **"새 광고를 요청하면서 기존 광고 뷰를 먼저 날려버리는 것"**입니다.

```kotlin
// ❌ 깜빡임과 레이아웃 점프를 유발하는 안티패턴
fun refreshAd() {
    currentAd = null // 1. 기존 광고 제거 (화면이 덜컥거리며 사라짐)
    showShimmer()   // 2. 로딩 스켈레톤 노출
    adLoader.load { newAd ->
        currentAd = newAd // 3. 새 광고 도착
    }
}
```

이러면 60초마다 화면이 깜빡거리며 레이아웃 시프트(Layout Shift)가 일어나 사용자 경험이 극도로 불쾌해집니다.

### Load-then-Swap (로드-후-교체)

새 광고는 **백그라운드 메모리에서 완전히 로드가 완료된 후에만** 기존 광고와 원자적(Atomic)으로 교체해야 합니다.

1. 기존 광고는 화면에 그대로 띄워 둡니다.
2. 새 `NativeAd` 객체를 메모리에 로드합니다.
3. 로드가 **성공**하면, 그 순간 새 광고로 뷰를 스왑(Swap)하고 이전 광고 객체는 `destroy()` 합니다.
4. 로드가 **실패**하면, 기존 광고를 그대로 유지하고 다음 주기까지 조용히 대기합니다.

---

## 5. iOS에서 겪은 숨겨진 함정: `willPresent` 시 타이머를 취소하지 마라

iOS(Swift/SwiftUI) 환경에서 AdMob 네이티브 광고 델리게이트(`GADNativeAdDelegate`)를 다룰 때 매우 치명적인 함정이 있습니다.

광고가 전체화면 오버레이를 띄울 때 호출되는 `nativeAdWillPresentScreen(_:)` 콜백에서 **"광고가 떴으니 갱신 타이머를 꺼야지"** 하고 타이머를 `timer?.invalidate()` 해버리는 경우가 많습니다.

```swift
// ❌ 타이머를 취소하면 자가 복구가 죽는다
func nativeAdWillPresentScreen(_ nativeAd: GADNativeAd) {
    self.isAdDestinationPresented = true
    self.refreshTimer?.invalidate() // ⚠️ 위험: 타이머가 영원히 정지됨!
    self.refreshTimer = nil
}
```

광고를 닫고 사용자가 돌아왔을 때(`nativeAdDidDismissScreen`), 만약 시스템 이벤트 누락이나 뷰 계층 구조 이슈로 인해 타이머 재등록이 실패하면, **그 이후로 앱이 종료될 때까지 광고 갱신이 완전히 멈춰버립니다.**

### 해결책: Guard 기반 자가 복구(Self-healing)

타이머 객체 자체는 취소하지 않고 계속 60초마다 돌게 둡니다. 대신 타이머 핸들러 내부에서 **상태 플래그(`isAdDestinationPresented`)를 검사하여 조용히 `return`**하도록 설계합니다.

```swift
// ✅ 타이머는 살려두고 상태로만 가드
private func setupRefreshTimer() {
    Timer.publish(every: 60, on: .main, in: .common)
        .autoconnect()
        .sink { [weak self] _ in
            guard let self = self else { return }
            self.tickRefresh()
        }
        .store(in: &cancellables)
}

private func tickRefresh() {
    // 4대 자격 조건 검사 (하나라도 false면 조용히 스킵)
    guard isAppActive,
          isSlotVisible,
          !isAdDestinationPresented,
          !isLoading else {
        return
    }
    
    loadNextAd()
}
```

이렇게 하면 사용자가 광고 랜딩 페이지를 닫고 돌아오는 순간, 다음 60초 틱에서 자연스럽게 갱신이 재개되는 **견고한 자가 복구(Self-healing)** 능력을 갖추게 됩니다.

---

## 6. 프로덕션 구현 코드 (Kotlin StateFlow 예시)

Android Jetpack Compose 환경에서 위 4대 원칙과 Load-then-Swap을 구현한 핵심 컨트롤러 구조입니다.

```kotlin
@OptIn(ExperimentalCoroutinesApi::class)
class NativeAdRotationController(
    private val adLoader: NativeAdLoader,
    private val refreshIntervalMs: Long = 60_000L
) {
    private val _currentAd = MutableStateFlow<NativeAd?>(null)
    val currentAd: StateFlow<NativeAd?> = _currentAd.asStateFlow()

    private val isAppForeground = MutableStateFlow(true)
    private val isSlotVisible = MutableStateFlow(false)
    private val isDestinationOpened = MutableStateFlow(false)
    private val isLoading = MutableStateFlow(false)

    private var lastAdLoadedTimestamp = 0L

    suspend fun startRotationLoop() = coroutineScope {
        while (isActive) {
            val now = System.currentTimeMillis()
            val age = now - lastAdLoadedTimestamp
            val remaining = refreshIntervalMs - age

            // 1. 남은 시간만큼 대기 (음수면 최소 1초 쿨다운)
            val delayTime = if (remaining > 0) remaining else 1_000L
            delay(delayTime)

            // 2. 4대 자격 조건 검증 (Guard)
            if (!isAppForeground.value || 
                !isSlotVisible.value || 
                isDestinationOpened.value || 
                isLoading.value) {
                continue
            }

            // 3. Load-then-Swap 실행
            loadAndSwapAd()
        }
    }

    private suspend fun loadAndSwapAd() {
        isLoading.value = true
        try {
            val newAd = adLoader.loadNativeAd() // suspend 네트워크 호출
            val oldAd = _currentAd.value

            // 원자적 교체
            _currentAd.value = newAd
            lastAdLoadedTimestamp = System.currentTimeMillis()

            // 이전 광고 해제
            oldAd?.destroy()
        } catch (e: Exception) {
            // 실패 시 기존 광고 유지, 다음 주기에 재시도
        } finally {
            isLoading.value = false
        }
    }

    fun onLifecycleStateChanged(isResumed: Boolean) {
        isAppForeground.value = isResumed
    }

    fun onSlotVisibilityChanged(isVisible: Boolean) {
        isSlotVisible.value = isVisible
    }

    fun onAdDestinationVisibilityChanged(isOpened: Boolean) {
        isDestinationOpened.value = isOpened
    }
}
```

---

## 7. 마치며: 네이티브 광고 갱신 체크리스트

광고 갱신은 단순히 "주기적 호출"의 문제가 아니라, **광고 네트워크와의 신뢰(Compliance) 및 수익률(eCPM)을 보존하는 정밀한 상태 머신**입니다.

배포 전 아래 체크리스트를 꼭 점검해 보세요:

- [ ] **자격 4조건 검사**: 포그라운드 ∧ 화면 노출 ∧ 목적지 미표시 ∧ In-flight 미중복을 모두 확인하는가?
- [ ] **수학적 오류 점검**: `coerceAtLeast`나 지연 계산 공식에서 대기 시간이 영원히 고정되는 버그가 없는가?
- [ ] **Load-then-Swap**: 기존 뷰를 미리 지우지 않고 새 광고가 완전히 준비된 후 교체하는가?
- [ ] **iOS 자가 복구**: 전체화면 표시 시 타이머를 invalidate 하지 않고 상태 가드로 제어하는가?
- [ ] **메모리 릭 방지**: 스왑된 이전 `NativeAd` 객체의 `destroy()`를 잊지 않고 호출하는가?

견고한 광고 회전 아키텍처를 통해 불필요한 무효 트래픽 경고를 방지하고, 안정적인 광고 수익과 쾌적한 사용자 경험을 모두 챙기시길 바랍니다.
