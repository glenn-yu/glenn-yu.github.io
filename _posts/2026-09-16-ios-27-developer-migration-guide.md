---
layout: post
title: "[iOS] iOS 27 마이그레이션 가이드 — 빌드가 깨지고 탭뷰가 죽을 때 확인해야 할 것들"
date: 2026-09-16 23:00:00 +0900
categories: [iOS, Swift, Migration]
tags: [iOS, iOS27, Xcode27, Swift6, SwiftUI, TabView, CoreAI, FoundationModels, NeuralEngine, Jetsam, BackgroundAssets, PermissionKit, Mobile]
excerpt: "iOS 27과 Xcode 27 SDK로 전환하면서 마주치는 빌드 에러, TabView selection 런타임 크래시, NPU 백그라운드 자격증명과 메모리 직접 귀속(Jetsam OOM), Background Assets 전환까지 실무 개발자가 챙겨야 할 핵심을 정리한다."
---

매년 가을 새로운 iOS와 Xcode가 나오면 개발자들은 기존 프로젝트를 새 SDK로 빌드해 봅니다.

그리고 대개 비슷한 상황을 마주합니다.

> "코드는 한 줄도 안 건드렸는데 왜 빌드가 깨지지?"  
> "시뮬레이터에서는 잘 돌던 앱이 특정 화면에서 왜 갑자기 죽을까?"

이번 iOS 27은 플랫폼 버전 번호가 전 패밀리(iOS, iPadOS, macOS, watchOS, tvOS, visionOS) 모두 '27'로 맞춰지면서 시스템 전반에 걸쳐 굵직한 아키텍처 변화가 있었습니다.

화려한 신기능을 도입하기 전에, **기존 코드를 새 SDK로 빌드했을 때 발목을 잡는 문제들과 시스템 동작 변화**를 먼저 정리해 둡니다.

---

## 1. 빌드가 안 될 때: Xcode 27과 Swift 6.4에서 정리할 것들

프로젝트를 열자마자 빌드가 멈춘다면 다음 세 가지를 먼저 확인해야 합니다.

### Intel Mac 빌드 환경 확인
Xcode 27은 **macOS Tahoe 26.6 이상**과 **Apple Silicon(M 시리즈) Mac**만 지원합니다. 로컬 머신은 대부분 Apple Silicon으로 넘어왔겠지만, 사내 CI/CD 파이프라인이나 온프레미스 빌드 서버에 아직 Intel Mac 미니가 물려 있다면 Xcode 27 설치 단계에서 막히게 됩니다.

또한 macOS 타깃의 배포 타깃(Deployment Target)을 27.0 이상으로 올리면 기본 아키텍처(`ARCHS_STANDARD`)에서 `x86_64`가 제외되어 Apple Silicon 전용으로 빌드됩니다.

### 클래식 링커 플래그(`-ld_classic`) 제거
오래된 프로젝트나 레거시 C++ 라이브러리를 링크하던 프로젝트의 `OTHER_LDFLAGS`를 보면 종종 `-ld_classic` 플래그가 남아 있습니다. Xcode 27에서는 구형 링커인 `ld64`가 완전히 제거되었기 때문에, 이 플래그가 들어 있으면 링커가 즉시 에러를 내며 빌드가 중단됩니다. 빌드 세팅에서 해당 플래그를 삭제해 주면 정상적으로 빌드됩니다.

### Swift 6.4 편의 문법과 프리뷰
Swift 6.4가 탑재되면서 번거롭던 코드 몇 가지를 줄일 수 있게 되었습니다.

- **`anyAppleOS 27` 가용성 매크로**: 플랫폼마다 버전을 일일이 적던 `@available(iOS 27, macOS 27, ...)` 대신 `anyAppleOS 27` 하나로 묶을 수 있습니다.
- **`async in defer`**: `defer` 블록 안에서 `Task`를 안전하게 띄워 비동기 리소스 해제(Cleanup) 작업을 호출할 수 있습니다.
- **`PreviewProvider` 정리**: 기존 SwiftUI 미리보기 방식인 `PreviewProvider`는 완전히 Deprecated 처리되므로 `#Preview` 매크로로 전환해야 경고를 없앨 수 있습니다.

---

## 2. 탭뷰에서 갑자기 크래시가 난다면: 사라진 탭과 selection

iOS 27 SDK로 빌드한 앱을 테스트하면서 가장 흔하게 겪는 런타임 크래시입니다.

### 원인: 탭의 가시성(Visibility) 강제
iOS 27.0 SDK부터 SwiftUI의 `TabView`는 **`selection` 바인딩 값이 반드시 화면에 '표시 중인(Visible)' 유효한 탭을 가리키고 있어야 한다**는 규칙을 엄격하게 검사합니다.

이전에는 선택된 탭이 조건부 로직으로 사라져도 빈 화면을 보여주거나 첫 번째 탭으로 조용히 넘어갔지만, 이제는 렌더링 대상을 찾지 못해 앱이 그 자리에서 크래시를 냅니다.

주로 다음과 같은 구조에서 터집니다.

1. **조건부 탭**: 권한이나 상태에 따라 탭을 동적으로 넣고 뺄 때 (`if isAdmin { Tab(...) }`)
2. **상태 복원**: `@SceneStorage`나 `UserDefaults`에 저장해 둔 이전 세션의 선택 탭을 앱 시작 시 복원하는데, 현재 로그인 상태에서는 그 탭이 아직 보이지 않을 때

### 해결: selection 유효성 검증과 폴백

탭 목록이 바뀔 수 있는 화면에서는 현재 선택된 탭이 유효한지 확인하고 기본 탭으로 돌려주는 방어 로직이 필요합니다.

```swift
import SwiftUI

enum AppTab: Hashable, CaseIterable {
    case home, feed, settings, admin
}

struct MainContainerView: View {
    @SceneStorage("selectedTab") private var selectedTab: AppTab = .home
    @State private var isAdmin: Bool = false

    // 현재 화면에 노출 가능한 탭 목록
    private var visibleTabs: [AppTab] {
        var tabs: [AppTab] = [.home, .feed, .settings]
        if isAdmin {
            tabs.append(.admin)
        }
        return tabs
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView()
                .tabItem { Label("홈", systemImage: "house") }
                .tag(AppTab.home)

            FeedView()
                .tabItem { Label("피드", systemImage: "list.bullet") }
                .tag(AppTab.feed)

            SettingsView(isAdmin: $isAdmin)
                .tabItem { Label("설정", systemImage: "gear") }
                .tag(AppTab.settings)

            if isAdmin {
                AdminDashboardView()
                    .tabItem { Label("관리자", systemImage: "lock.shield") }
                    .tag(AppTab.admin)
            }
        }
        // 가용 탭이 바뀌거나 화면이 뜰 때 선택 탭의 유효성 검증
        .onAppear {
            validateTabSelection()
        }
        .onChange(of: isAdmin) { _, _ in
            validateTabSelection()
        }
    }

    private func validateTabSelection() {
        if !visibleTabs.contains(selectedTab) {
            // 보이지 않는 탭이 선택되어 있다면 안전한 기본 탭으로 재설정
            selectedTab = .home
        }
    }
}
```

> **참고**: `TabView` 안에 `.searchable`을 붙였을 때 툴바 검색창이 제대로 접히지 않는 렌더링 회귀 이슈도 함께 보고되어 있으므로, 탭 내부 검색 화면의 인터랙션도 한 번씩 눌러보며 확인할 필요가 있습니다.

---

## 3. 백그라운드로 가면 죽는 앱: NPU 메모리와 자격증명

온디바이스 AI 모델이나 Core ML을 사용하는 앱이라면 이번 버전에서 가장 주의 깊게 살펴봐야 할 영역입니다. Apple이 NPU(Neural Engine) 자원을 **기존 GPU와 동일한 수준으로 엄격하게 통제**하기 시작했습니다.

### 백그라운드 NPU 연산에는 자격증명이 필요하다
앱이 백그라운드로 내려가면 시스템은 NPU 접근을 기본적으로 차단합니다. 백그라운드 작업 중에 Core ML 추론이나 임베딩 연산을 계속 수행해야 한다면, 프로젝트 `.entitlements`에 전용 권한을 명시해야 합니다.

```xml
<key>com.apple.developer.background-tasks.continued-processing.inference</key>
<true/>
```

이 선언 없이 백그라운드에서 NPU 연산을 시도하면 시스템 시그널을 받고 프로세스가 강제 종료됩니다.

### NPU 메모리가 앱 프로세스로 직접 잡힌다 (Jetsam OOM 위험)
더 큰 변화는 메모리 정산 방식입니다.

- **이전**: Core ML이나 NPU가 사용하는 가중치 버퍼의 상당 부분이 시스템 공유 데몬 계정으로 분산 처리되었습니다.
- **iOS 27부터**: **NPU가 사용하는 모델 메모리와 중간 버퍼가 해당 앱의 Memory Footprint에 100% 직접 귀속**됩니다.

이 때문에 Xcode Instruments의 Allocations 도구로 측정해 보면 앱의 메모리 사용량이 이전 OS보다 훨씬 높게 찍힙니다. 평소에는 문제가 없어 보여도, 온디바이스 모델을 메모리에 올려둔 채 홈 화면으로 나가는 순간 OS의 메모리 관리자(Jetsam)가 앱을 OOM(`EXC_RESOURCE` 또는 `0x8badf00d`)으로 종료시키는 일이 빈번해집니다.

대응 방법은 세 가지입니다.

1. **가중치 스트리밍**: 대형 모델을 통째로 RAM에 상주시키지 않고 mmap 방식으로 필요할 때만 읽어오도록 구성합니다.
2. **백그라운드 진입 시 명시적 해제**: `sceneDidEnterBackground` 시점에 추론 세션을 정리하고 버퍼를 내립니다.
3. **양자화**: FP16 모델 대신 INT4/FP8 양자화 모델을 적극적으로 활용합니다.

---

## 4. AI 기능 붙이기: Core AI와 FoundationModels

Apple은 개발자가 AI 기능을 구현할 수 있도록 성격이 다른 두 가지 프레임워크를 제공합니다.

### 1) 저수준 최적화: `Core AI`
기존 Core ML의 상위 특화 프레임워크입니다. Apple Silicon 하드웨어에 맞춰 온디바이스 모델을 사전 컴파일(Ahead-Of-Time, AOT)하여 1GB가 넘는 모델도 빠르게 띄울 수 있도록 돕습니다. macOS 27의 Xcode에서는 페어링된 iOS 기기의 NPU 텐서 흐름을 눈으로 보며 디버깅할 수 있는 Core AI Debugger도 제공됩니다.

### 2) 고수준 추론: `FoundationModels`
온디바이스 경량 언어 모델(SLM)과 Apple Private Cloud Compute(PCC)를 단일 Swift 인터페이스로 다룰 수 있는 네이티브 프레임워크입니다. 텍스트와 이미지를 함께 넘기는 멀티모달 프롬프트와, Vision 프레임워크(OCR, 바코드 인식)를 엮는 도구 호출(Tool Calling)을 직관적으로 작성할 수 있습니다.

```swift
import FoundationModels
import Vision

@available(anyAppleOS 27, *)
final class ReceiptScanner {
    private let model = LanguageModel.default

    func parseReceipt(image: CGImage, instruction: String) async throws -> String {
        let prompt = Prompt {
            "영수증 이미지를 분석하여 요청된 항목을 추출하세요."
            Prompt.Image(image)
            instruction
        }

        // OCR 도구를 모델 추론 과정에 연결
        let options = GenerationOptions(
            toolCallingMode: .auto,
            tools: [VisionTool.ocr]
        )

        let response = try await model.generate(prompt, options: options)
        return response.text
    }
}
```

> **비용 참고**: App Store Small Business Program(누적 첫 다운로드 200만 회 미만)에 등록된 개발사라면 Private Cloud Compute 클라우드 추론 API를 무료 쿼터로 이용할 수 있습니다.

---

## 5. ODR의 퇴장과 Background Assets 전환

대용량 게임이나 리소스가 큰 앱에서 오랫동안 사용해 온 **On-Demand Resources(ODR, `NSBundleResourceRequest`)가 공식적으로 지원 중단(Deprecated)**되었습니다.

이제 추가 리소스 다운로드는 `BackgroundAssets.framework`를 사용하는 것이 기본 흐름입니다.

그동안 Background Assets는 외부 CDN 서버가 필요해서 로컬 개발이나 CI 환경에서 테스트하기 까다로운 편이었습니다. 다행히 Xcode 27에서는 Run Scheme의 `Options` 탭에 **"Background Asset Packs"** 폴더 지정 옵션이 생겼습니다. 로컬 디렉터리의 에셋 팩을 지정해 두면 별도 서버 없이도 시뮬레이터나 실기기에서 에셋 다운로드와 패치 로직을 바로 검증할 수 있습니다.

---

## 6. 아동 보호 규제와 소셜 기능 대응

글로벌 시장의 온라인 아동 안전 규제(미국의 KOSA, 호주, 브라질의 연령 확인법 등)가 강화되면서, 앱 수준에서 처리하던 연령 확인과 보호자 동의를 시스템 표준 프레임워크로 처리할 수 있게 되었습니다.

### `DeclaredAgeRange`
사용자의 생년월일이나 주민번호 같은 민감한 개인정보를 앱이 직접 수집하지 않아도, 기기 시스템이 보증하는 연령대 구간(성인, 청소년, 아동)만 안전하게 조회할 수 있습니다.

### `PermissionKit`
앱 내에 1:1 채팅, 피드 댓글, 친구 추가 같은 소셜 인터랙션이 포함되어 있다면, 미성년자 계정이 해당 기능을 누를 때 자체 팝업 대신 시스템의 Family Sharing(가족 공유) 기반 부모 승인 창을 호출할 수 있습니다.

앱에 소셜이나 메시징 기능이 있다면 App Store Connect의 메타데이터 설문에서도 해당 내용을 명시해야 심사가 지연되지 않습니다.

---

## 7. 마이그레이션 우선순위와 일정

Apple의 App Store Connect 정책상 **2027년 4월**부터는 모든 신규 앱과 업데이트 바이너리를 반드시 iOS 27 SDK(Xcode 27)로 빌드해야 합니다.

아직 시간적 여유가 있는 것처럼 보이지만, 작업의 성격에 따라 우선순위를 나누어 대비하는 것이 좋습니다.

```text
[지금 바로 확인할 것]
  ├─ CI/CD 빌드 머신의 Apple Silicon 지원 여부
  ├─ 빌드 플래그에서 -ld_classic 제거
  └─ TabView의 conditional 탭에 selection 방어 코드 추가

[다음 스프린트에서 다룰 것]
  ├─ Core ML / AI 모델 사용 시 NPU 메모리 프로파일링 (Jetsam OOM 방지)
  ├─ 백그라운드 AI 작업 시 Inference Entitlement 추가
  └─ 소셜/채팅 기능이 있다면 DeclaredAgeRange 및 PermissionKit 검토

[중장기 과제]
  ├─ 레거시 ODR을 Background Assets로 전환
  └─ 2027년 4월 Hard Gate 전 최종 빌드 SDK 전환 완료
```

신규 프레임워크 도입보다 중요한 것은 **새 SDK로 빌드했을 때 기존 사용자 경험이 망가지지 않는 것**입니다. 특히 `TabView` 크래시와 NPU 메모리 정책 변경은 실서비스에서 예기치 못한 장애로 이어질 수 있으므로, 최소 타깃을 올리기 전에 미리 테스트해 보시길 권합니다.

---

### 참고 문서
- [Apple Developer — Xcode 27 Release Notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes)
- [Apple Developer — iOS & iPadOS 27 Release Notes](https://developer.apple.com/documentation/xcode-release-notes/ios-and-ipados-27-release-notes)
- [Apple Developer — What's New in iOS 27](https://developer.apple.com/ios/)
