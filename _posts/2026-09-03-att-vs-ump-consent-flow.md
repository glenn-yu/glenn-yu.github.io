---
layout: post
title: "[iOS] ATT와 UMP는 같은 동의가 아니다: App Store 심사 거절로 배운 동의 흐름 설계"
date: 2026-09-03 21:30:00 +0900
categories: [iOS, Privacy, AppStore]
tags: [iOS, ATT, AppTrackingTransparency, UMP, AdMob, Privacy, AppReview, Swift, Mobile]
excerpt: "코드에는 ATT 요청이 있었지만 App Store 심사에서는 프롬프트를 찾지 못했다. UMP의 광고 가능 여부 뒤에 ATT를 묶으면서 생긴 도달 불가능 경로와 이를 막는 설계·검증 방법을 정리한다."
---

출시를 준비하던 한 iOS 앱이 App Store 심사에서 거절되었습니다. 심사 의견의 요지는 단순했습니다.

> 앱에서 App Tracking Transparency 권한 요청을 확인할 수 없다.

처음에는 설정 누락을 의심했습니다. 하지만 `Info.plist`에는 `NSUserTrackingUsageDescription`이 있었고, 코드에도 `ATTrackingManager.requestTrackingAuthorization` 호출이 있었습니다. 로컬 테스트에서도 조건만 맞으면 프롬프트가 나타났습니다.

문제는 **ATT 호출의 존재 여부가 아니라 그 호출까지 도달할 수 있느냐**였습니다.

광고 동의 흐름을 다시 따라가 보니 ATT 요청이 Google UMP(User Messaging Platform)의 `canRequestAds` 뒤에 있었습니다. UMP 동의를 거부하거나, 동의 폼을 불러오지 못하거나, 네트워크 오류가 발생하면 함수가 먼저 끝났습니다. 그 경로에서는 ATT 코드가 영원히 실행되지 않았습니다.

이 글에서는 특정 앱 이름과 빌드 정보는 생략하고, 같은 문제를 다른 프로젝트에서도 찾을 수 있도록 동의 흐름 자체에 집중합니다.

---

## 1. 코드에 있었지만 실행되지 않은 ATT

문제가 된 구조를 단순화하면 다음과 같습니다.

```swift
func finishConsentFlow() {
    guard ConsentInformation.shared.canRequestAds else {
        finish()
        return
    }

    requestATTIfNeeded {
        MobileAds.shared.start()
        finish()
    }
}
```

겉으로 보면 자연스럽습니다.

1. 광고를 요청할 수 있는지 확인한다.
2. ATT 권한을 요청한다.
3. 광고 SDK를 시작한다.

하지만 첫 번째 조건은 ATT와 관계없는 UMP의 판단입니다. `canRequestAds == false`이면 ATT에 도달하지 못합니다.

실제 앱에서는 이보다 더 복잡했습니다. UMP 정보 갱신, 동의 폼 표시, 개인정보 옵션 화면이 각각 비동기 콜백을 가지고 있었고 여러 곳에 조기 `return`이 있었습니다. 정상 경로만 테스트하면 문제가 보이지 않았습니다. 심사 환경처럼 동의 상태나 네트워크 조건이 달라졌을 때 비로소 막힌 경로가 드러났습니다.

```text
앱 시작
  └─ UMP 상태 갱신
       ├─ 성공 + 광고 가능 ── ATT 요청 ── 광고 시작
       ├─ 동의 거부 ───────── 종료
       ├─ 폼 로드 실패 ────── 종료
       └─ 네트워크 실패 ───── 종료
```

이 구조에서 아래 세 경로는 ATT 요청을 건너뜁니다.

---

## 2. ATT와 UMP는 서로 다른 질문이다

두 시스템 모두 사용자 동의와 광고에 관련되어 있어 하나의 흐름처럼 보이지만, 실제로 묻는 질문은 다릅니다.

| 구분 | ATT | UMP |
|---|---|---|
| 주체 | Apple / iOS | Google 및 적용되는 개인정보 규정 |
| 질문 | 앱 간·웹 간 추적에 사용할 데이터 접근을 허용할 것인가 | 현재 사용자에게 어떤 개인정보 메시지가 필요하며 광고 요청이 가능한가 |
| 대표 상태 | `notDetermined`, `authorized`, `denied`, `restricted` | `canRequestAds`, consent status |
| 실패 시 제한할 것 | 추적 데이터 접근 | 동의가 필요한 광고 요청 |

Apple의 ATT는 시스템 권한입니다. 앱은 `NSUserTrackingUsageDescription`을 선언하고, 상태가 `notDetermined`일 때 `requestTrackingAuthorization`을 호출합니다. 사용자의 선택은 시스템이 기억합니다.

UMP는 개인정보 메시지를 표시하고 Google 광고 요청 가능 여부를 판단합니다. Google 문서도 광고를 요청하기 전에는 `canRequestAds`를 확인하도록 안내합니다.

따라서 다음 두 문장은 동시에 참입니다.

- **광고 시작은 `canRequestAds` 뒤에 둔다.**
- **ATT 요청 가능 여부를 `canRequestAds`로 결정하지 않는다.**

`canRequestAds`가 false라고 해서 iOS의 ATT 질문까지 사라져야 하는 것은 아닙니다. 광고를 띄울 수 없는 상태와 추적 권한을 물을 수 없는 상태를 같은 것으로 취급한 것이 이번 결함의 핵심이었습니다.

---

## 3. 올바른 흐름은 의존성이 아니라 순서다

수정한 구조는 다음과 같습니다.

```text
UMP 상태 갱신·필요한 폼 표시를 시도
                    ↓
성공·거부·오류와 무관하게 ATT 단계로 이동
                    ↓
ATT 상태가 notDetermined이면 시스템 권한 요청
                    ↓
canRequestAds가 true일 때만 광고 SDK 시작
                    ↓
앱 시작 흐름 완료
```

Swift 코드로 단순화하면 이런 모양입니다.

```swift
func proceedAfterUMP() {
    requestATTIfNeeded {
        if ConsentInformation.shared.canRequestAds {
            startAdsOnce()
        }
        finish()
    }
}

func requestATTIfNeeded(completion: @escaping () -> Void) {
    guard ATTrackingManager.trackingAuthorizationStatus == .notDetermined else {
        completion()
        return
    }

    ATTrackingManager.requestTrackingAuthorization { _ in
        completion()
    }
}
```

여기서 중요한 것은 UMP가 성공해야만 ATT를 실행하는 **조건부 의존성**을 만들지 않는 것입니다. UMP를 먼저 처리하고 ATT로 넘어가는 **순서**는 유지할 수 있습니다. UMP 폼이 필요하다면 사용자에게 광고·개인정보 맥락을 먼저 설명하고, 이어서 iOS 시스템 프롬프트를 보여주는 편이 자연스럽습니다.

반대로 광고 SDK 초기화는 계속 `canRequestAds`로 보호해야 합니다. ATT를 분리한다는 이유로 UMP 게이트까지 제거하면 다른 개인정보 결함을 만드는 셈입니다.

`startAdsOnce()`처럼 중복 초기화를 막는 장치도 필요합니다. UMP는 이전 세션의 동의 상태를 사용할 수 있어 상태 갱신 직후와 폼 완료 후 모두 광고 가능 상태가 될 수 있기 때문입니다.

---

## 4. 같은 결함은 세 가지 모양으로 숨어 있었다

첫 앱을 수정한 뒤 비슷한 동의 코드를 사용하는 다른 iOS 앱도 전수 조사했습니다. 직접적인 `canRequestAds` 가드만 찾았을 때는 일부만 걸렸지만, 제어 흐름을 따라가니 결국 같은 결과를 만드는 변종이 더 있었습니다.

### 유형 A: 광고 가능 여부 뒤에 ATT가 있음

```swift
guard canRequestAds else { return }
requestATTIfNeeded()
```

가장 찾기 쉬운 형태입니다. 코드의 순서만 봐도 ATT가 UMP 상태에 종속되어 있습니다.

### 유형 B: UMP 폼 실패 분기에서 종료

```swift
loadConsentForm { form, error in
    guard error == nil else {
        completion()
        return
    }

    present(form) {
        requestATTIfNeeded()
    }
}
```

정상적으로 폼이 표시될 때만 ATT가 실행됩니다. 폼 로드 실패가 곧 ATT 생략으로 이어집니다.

### 유형 C: 동의 정보 갱신 실패 분기에서 종료

```swift
requestConsentInfoUpdate { error in
    if error != nil {
        completion()
        return
    }

    gatherConsentThenRequestATT()
}
```

네트워크가 끊기거나 UMP 갱신에 실패하면 ATT까지 도달하지 못합니다.

코드 리뷰에서는 모든 조기 종료 지점마다 한 가지를 물어보면 됩니다.

> 이 경로로 빠지면 ATT 단계는 누가 이어서 실행하는가?

답이 “아무도”라면 같은 결함입니다.

---

## 5. Android 흐름을 그대로 이식하면서 생긴 문제

이 결함이 여러 앱에서 반복된 데에는 이유가 있었습니다. Android와 iOS 앱의 광고 동의 흐름을 최대한 비슷하게 유지하고 있었기 때문입니다.

Android에는 ATT가 없습니다. 따라서 Android에서 다음 구조는 문제가 없습니다.

```text
UMP 처리 → canRequestAds 확인 → 광고 SDK 시작
```

그런데 이 구조를 iOS로 옮기면서 ATT를 “광고 초기화 전에 할 일” 정도로만 생각하면 자연스럽게 `canRequestAds` 뒤에 넣게 됩니다.

```text
UMP 처리 → canRequestAds 확인 → ATT → 광고 SDK 시작
```

표면적으로는 Android와 iOS가 대칭이지만 정책 의미는 대칭이 아닙니다. 플랫폼별 코드를 맞출 때는 함수 이름과 실행 순서만 복사할 것이 아니라, 각 단계가 **누구의 판단이며 어떤 실패를 막는지**를 분리해야 합니다.

저는 동의 흐름을 다음 세 단계로 나누는 편이 더 안전하다고 결론 내렸습니다.

```text
1. collectRegulatoryConsent()          // UMP
2. requestPlatformTrackingPermission() // iOS ATT, Android는 no-op
3. startAdsIfAllowed()                 // UMP canRequestAds
```

공통 오케스트레이션은 유지하되, 플랫폼 전용 정책은 별도의 단계로 드러내는 방식입니다.

---

## 6. 프롬프트 자체보다 도달 가능성을 테스트한다

ATT는 일반적인 단위 테스트가 까다롭습니다. 시스템이 사용자 선택을 기억하고, 앱이 활성 상태여야 하며, 다른 권한 프롬프트가 떠 있으면 표시되지 않을 수 있습니다. 시뮬레이터나 CI에서 실제 팝업이 보였는지를 안정적으로 단언하기 어렵습니다.

이번에는 기존 코드 구조를 크게 바꾸지 않는 선에서 **소스 구조 회귀 테스트**를 추가했습니다. 완벽한 제어 흐름 분석기는 아니지만, 이번에 확인한 직접적인 회귀는 확실하게 막을 수 있습니다.

테스트가 잠근 조건은 네 가지입니다.

1. ATT 호출이 같은 흐름의 `canRequestAds` 가드보다 앞에 있다.
2. 광고 SDK 시작은 계속 `canRequestAds` 뒤에 있다.
3. ATT 요청 전에 `.notDetermined` 상태를 확인한다.
4. 최종 설정에 `NSUserTrackingUsageDescription`이 존재한다.

여기서도 정상 코드가 통과하는 것만 확인하지 않았습니다. 코드를 일부러 이전 순서로 되돌렸을 때 테스트가 실패하는지 확인했습니다. **가드는 잘될 때 통과하는 것보다 잘못됐을 때 실제로 막는지가 더 중요합니다.**

또 하나의 함정은 테스트 파일을 만들고 Xcode 테스트 타깃에 등록하지 않는 경우입니다. 파일이 저장소에 있어도 빌드 페이즈에 포함되지 않으면 테스트는 실행되지 않습니다. “테스트 성공”이 아니라 실제 실행된 테스트 수가 증가했는지도 함께 확인해야 합니다.

---

## 7. 자동 검사는 확실한 범위까지만

처음에는 UMP 오류 콜백 안의 모든 조기 `return`을 자동으로 찾으려 했습니다. 하지만 곧 오탐이 생겼습니다.

- 테스트 픽스처 안의 실패 예시를 실제 결함으로 인식함
- `canRequestAds` 값을 읽어 변수에 저장한 코드까지 게이트로 인식함
- 오류 분기에서 다른 함수로 위임하고, 그 함수가 ATT를 호출하는 경우를 추적하지 못함
- 결함을 설명하는 주석 속 코드 조각을 실제 코드로 인식함

함수 간 호출 관계까지 정적으로 추적하지 않는 한 모든 변종을 정확히 판정하기 어려웠습니다. 오탐이 많아지면 개발자는 리포트 전체를 무시하기 시작하고, 확실한 결함까지 같이 묻힙니다.

그래서 자동 검사는 같은 함수 안에서 명백하게 보이는 다음 형태만 차단하도록 좁혔습니다.

```swift
guard canRequestAds else { ... }
// 이 뒤에서 ATT 호출
```

대입과 단순 참조는 제외하고, 검사 전에 줄 주석도 제거했습니다. 폼 로드 실패나 네트워크 오류처럼 위임 관계를 따라가야 하는 변종은 코드 리뷰 체크리스트로 남겼습니다.

모든 것을 어설프게 자동 판정하는 것보다 **확실한 것은 자동 차단하고, 불확실한 것은 사람의 확인 대상으로 명시하는 것**이 더 신뢰할 수 있었습니다.

---

## 8. 코드만 고치고 끝내면 안 된다

ATT 흐름을 수정한 뒤에는 다음 항목도 함께 확인해야 합니다.

- `Info.plist` 또는 빌드 설정에 `NSUserTrackingUsageDescription`이 있는가
- `PrivacyInfo.xcprivacy`의 추적 선언이 실제 코드 동작과 맞는가
- 수정된 값이 소스에만 있는 것이 아니라 최종 `.app`과 Archive에 포함됐는가
- App Store Connect의 앱 개인정보 답변이 앱과 포함된 SDK의 동작을 반영하는가

특히 소스의 `Info.plist`만 보고 끝내면 안 됩니다. 빌드 설정 치환이나 타깃 포함 여부가 잘못되면 소스에는 키가 있어도 최종 앱 번들에서는 사라질 수 있습니다. 스토어에 올라가는 것은 소스가 아니라 Archive이므로 최종 산출물을 기준으로 확인해야 합니다.

ATT 요청 코드, 사용 목적 문구, 개인정보 manifest, App Store Connect 신고는 서로 연결되어 있지만 같은 파일이 아닙니다. 하나를 고쳤다고 나머지가 자동으로 맞아지지는 않습니다.

---

## 9. 결론

이번 심사 거절의 원인은 ATT API를 몰라서도, 권한 문구를 빼먹어서도 아니었습니다. 서로 다른 두 동의 체계를 하나의 Boolean으로 묶은 것이 문제였습니다.

가장 중요한 교훈은 세 가지입니다.

1. **호출이 존재하는 것과 호출에 도달할 수 있는 것은 다르다.** 정상 경로뿐 아니라 거부·오류·오프라인 경로를 따라가야 한다.
2. **UMP는 광고 요청을 보호하고, ATT는 iOS 추적 권한을 다룬다.** 순서는 연결할 수 있지만 성공 조건까지 종속시키면 안 된다.
3. **플랫폼 간 대칭보다 정책 의미를 우선한다.** Android에서 맞는 광고 게이트가 iOS 전용 권한의 게이트까지 되어서는 안 된다.

지금 iOS 앱에서 UMP와 ATT를 함께 사용하고 있다면 `canRequestAds` 검색 결과만 보지 말고, UMP의 모든 오류 콜백과 조기 `return`을 따라가 보세요. 각 경로에서 “ATT 단계는 누가 이어서 실행하는가?”라고 물으면 숨어 있던 결함을 빠르게 찾을 수 있습니다.

## 참고

- [Apple — App Tracking Transparency](https://developer.apple.com/documentation/apptrackingtransparency)
- [Apple — requestTrackingAuthorization](https://developer.apple.com/documentation/apptrackingtransparency/attrackingmanager/requesttrackingauthorization%28completionhandler%3A%29)
- [Google — Set up UMP SDK for iOS](https://developers.google.com/admob/ios/privacy)
- [Google — Privacy strategies for iOS](https://developers.google.com/admob/ios/privacy/strategies)
