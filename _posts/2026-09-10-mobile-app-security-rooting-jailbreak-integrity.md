---
layout: post
title: "[Mobile] 모바일 앱 보안 실무 가이드 — 루팅/탈옥 차단, 디버거 방어, 화면 캡처 방지, 서명 위변조 검증의 진화와 히스토리"
date: 2026-09-10 10:00:00 +0900
categories: [Mobile, Security]
tags: [Android, iOS, Security, Rooting, Jailbreak, AntiDebugging, FlagSecure, PlayIntegrity, AppAttest, CodeSigning, Kotlin, Swift, JetpackCompose, SwiftUI]
excerpt: "Android와 iOS 환경에서 루팅/탈옥 탐지, 디버거 차단, 화면 캡처 방지, 서명 지문 무결성 검증의 세대별 진화 히스토리와 최신 OS(Android 15, iOS 18) 실무 방어 코드를 팩트체크 기반으로 총정리한다."
---

금융, 핀테크, 결제, 엔터프라이즈 등 민감한 자산이나 개인정보를 다루는 모바일 애플리케이션 개발에서 **"클라이언트 보안 대책"**은 금융보안원 점검, ISMS-P 인증, 마이데이터 보안 심사 등의 필수 통과 요건입니다.

보안 요구사항 명세서를 열어보면 항상 다음 4대 핵심 요구사항이 포함되어 있습니다.

1. **루팅(Rooting) 및 탈옥(Jailbreak) 기기 감지 및 앱 실행 차단**
2. **동적 디버거(LLDB, GDB) 및 후킹 도구(Frida, Xposed 등) 부착 차단**
3. **앱 내 민감 정보 화면 캡처, 녹화, 미러링 차단**
4. **바이너리 위변조 및 서명 지문(Signature Fingerprint) 일치 여부 검증**

하지만 클라이언트 사이드 보안의 역사는 공격자와 방어자 사이의 끝없는 **"창과 방패의 군비경쟁(Cat-and-Mouse Game)"**이었습니다. 클라이언트 보안의 본질은 "절대 뚫리지 않는 완벽한 방패"가 아니라, **"공격자의 분석 및 우회 비용을 비즈니스 가치 이상으로 극대화(Cost Escalation)하는 심층 방어(Defense-in-Depth)"**에 있습니다.

각 보안 영역이 **어떤 역사적 기술 변천(히스토리)**을 거쳐 오늘날의 표준에 도달했는지 팩트체크하고, 최신 OS 환경(Android 14/15, iOS 17/18) 및 최신 UI 프레임워크(Jetpack Compose, SwiftUI)에서 바로 복사해 쓸 수 있는 실무 구현 코드를 정리합니다.

---

## 1. [Android] 루팅 탐지 & 기기 무결성의 4세대 진화 히스토리

안드로이드의 루팅은 최고 관리자(root, UID 0) 권한을 획득하여 안드로이드 샌드박스 보안 모델(`run-as`, SELinux 정책)을 무력화하는 행위입니다.

### 📜 기술 변천사 (루팅 vs 방어 히스토리)

```
[1세대: ~2015] SuperSU / Busybox (단순 /system 파티션 변조)
       ▼ (방어: 단순 su 경로 검색 및 test-keys 확인)
[2세대: 2015~2020] Magisk Systemless 루팅 + SafetyNet Attestation
       ▼ (공격: MagiskHide로 샌드박스 속임 / 구글: SafetyNet 하드웨어 증명)
[3세대: 2021~2024] Zygisk + Google Play Integrity API 전환 (SafetyNet 공식 종료)
       ▼ (공격: Zygisk DenyList / 구글: TEE/StrongBox 기반 Play Integrity)
[4세대: 2023~현재] KernelSU / APatch (리눅스 커널 GKI 레벨 루팅)
       ▼ (방어: 로컬 코드 탐지 불가능 ➔ 서버 사이드 원격 증명 필연성)
```

- **1세대 (~2015년: Superuser, SuperSU)**: `/system` 파티션을 직접 R/W로 리마운트하여 su 바이너리를 배치했습니다. 로컬 파일 경로 검색(`File("/system/bin/su").exists()`)만으로도 대부분 탐지 가능했습니다.
- **2세대 (2015~2020년: Magisk와 SafetyNet)**: Topjohnwu가 boot.img를 패치하는 **Systemless(시스템리스)** 루팅을 발표했습니다. `/system` 파티션은 건드리지 않으면서 앱별로 마운트 네임스페이스를 격리하는 MagiskHide가 등장했고, Google은 하드웨어 키스토어 연계 **SafetyNet Attestation API**를 도입했습니다.
- **3세대 (2021~2024년: Zygisk와 Play Integrity)**: Magisk가 Zygote 프로세스 자체에 인젝션하는 Zygisk로 진화했습니다. Google은 SafetyNet을 **2024년 1월 31일부로 완전히 종료(Shutdown)**하고 **Play Integrity API**로 전면 전환했습니다.
- **4세대 (2023년~현재: KernelSU, APatch)**: 안드로이드 커널(GKI, Generic Kernel Image) 레벨에서 특정 프로세스에만 루트 권한을 부여합니다. 유저스페이스 파일시스템이나 Zygote에는 아무런 흔적도 남지 않으므로, **로컬 Java/Kotlin 코드로는 사실상 탐지가 불가능**합니다.

### 1-1. 로컬 휴리스틱 루팅 감지 샘플 코드 (Kotlin)

```kotlin
import android.os.Build
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader

object AndroidRootDetector {

    // 1. 대표적인 su 바이너리 및 슈퍼유저 앱 설치 경로
    private val SU_PATHS = arrayOf(
        "/system/app/Superuser.apk",
        "/sbin/su",
        "/system/bin/su",
        "/system/xbin/su",
        "/data/local/xbin/su",
        "/data/local/bin/su",
        "/system/sd/xbin/su",
        "/system/bin/failsafe/su",
        "/data/local/su",
        "/su/bin/su",
        "/system/xbin/daemonsu"
    )

    fun isDeviceRooted(): Boolean {
        return checkBuildTags() || checkSuBinaryFiles() || checkSuExecution()
    }

    private fun checkBuildTags(): Boolean {
        val buildTags = Build.TAGS
        return buildTags != null && buildTags.contains("test-keys")
    }

    private fun checkSuBinaryFiles(): Boolean {
        return SU_PATHS.any { path ->
            try {
                File(path).exists()
            } catch (e: Exception) {
                false
            }
        }
    }

    private fun checkSuExecution(): Boolean {
        var process: Process? = null
        return try {
            process = Runtime.getRuntime().exec(arrayOf("/system/xbin/which", "su"))
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            reader.readLine() != null
        } catch (t: Throwable) {
            false
        } finally {
            process?.destroy()
        }
    }
}
```

> **오픈소스 라이브러리 활용**  
> 실무에서는 [RootBeer](https://github.com/scottyab/rootbeer) 라이브러리를 주로 병행합니다. NDK C 계층 검사, Busybox 바이너리 확인, 위험 패키지 조회를 수행하지만, 여전히 4세대 KernelSU 환경에서는 우회됩니다.

### 1-2. 현대의 정석: Google Play Integrity API 원격 증명 샘플 코드

4세대 루팅을 막으려면 클라이언트 판정이 아닌 **구글 서버가 발행하는 TEE/하드웨어 증명 토큰**을 검증해야 합니다.

```
[클라이언트 앱] ──(일회용 Nonce 요청)──> [자체 백엔드 서버]
       │                                         │
 (Nonce 수신)                              (Nonce 생성)
       ▼                                         │
[Google Play Core SDK]                           │
       │ (하드웨어 TEE 원격 증명)                 │
       ▼                                         │
[Integrity Token 수신] ──(Token 전달)─────────────┤
                                                 ▼
                                     [자체 백엔드 서버]
                                                 │
                                    (Google API 호출로 토큰 복호화)
                                                 ▼
                                     [Google Play 판정 결과 검증]
```

Play Integrity API 판정 레벨 (`deviceRecognitionVerdict`):
- `MEETS_BASIC_INTEGRITY`: 에뮬레이터가 아니며 기본적인 시스템 무결성을 만족함
- `MEETS_DEVICE_INTEGRITY`: Google CTS 인증을 통과한 정식 기기 (일반적인 Magisk/루팅 차단)
- `MEETS_STRONG_INTEGRITY`: 하드웨어(StrongBox/Keymaster) 보증 및 최신 OS 보안 패치 적용 기기

```kotlin
// Android 클라이언트: Play Integrity 토큰 획득
import android.content.Context
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest

fun requestIntegrityToken(
    context: Context,
    nonce: String,
    cloudProjectNumber: Long,
    onSuccess: (String) -> Unit,
    onError: (Exception) -> Unit
) {
    val integrityManager = IntegrityManagerFactory.create(context)
    val responseTask = integrityManager.requestIntegrityToken(
        IntegrityTokenRequest.builder()
            .setCloudProjectNumber(cloudProjectNumber)
            .setNonce(nonce) // 리플레이 방지용 일회용 난수
            .build()
    )
    
    responseTask.addOnSuccessListener { response ->
        onSuccess(response.token()) // 토큰을 자체 백엔드로 전송
    }.addOnFailureListener { exception ->
        onError(exception)
    }
}
```

---

## 2. [iOS] 탈옥(Jailbreak) & 디버거 차단의 진화 히스토리

### 📜 기술 변천사 (탈옥 vs 방어 히스토리)

```
[1세대: ~iOS 8] 완전 탈옥 (redsn0w, evasi0n, TaiG)
       ▼ (방어: /Applications/Cydia.app, MobileSubstrate 파일 존재 검사)
[2세대: iOS 9~14] 반탈옥 & checkm8 부트롬 익스플로잇 (unc0ver, checkra1n)
       ▼ (방어: ptrace(PT_DENY_ATTACH), sysctl KERN_PROC_PID 디버거 탐지)
[3세대: iOS 15~현재] SSV(Signed System Volume) 도입 ➔ Rootless 탈옥 (Dopamine, palera1n)
       ▼ (방어: /var/jb/ 경로 감지, Apple 공식 App Attest / DeviceCheck 도입)
```

- **1세대 (~iOS 8: 완전 탈옥)**: 부팅 시 커널 패치가 유지되는 완전 탈옥. 루트 파티션(`/`)을 R/W로 변경하고 Cydia와 MobileSubstrate를 주입.
- **2세대 (iOS 9~14: 반탈옥 및 checkm8)**: 재부팅할 때마다 앱을 통해 탈옥을 활성화하는 반탈옥(Semi-Untethered)과 A5~A11 칩셋의 하드웨어 취약점(checkm8) 기반 탈옥 유행.
- **3세대 (iOS 15~현재: Rootless 탈옥)**: 애플이 iOS 15부터 시스템 볼륨에 암호학적 서명 트리인 **SSV(Signed System Volume)**를 도입하여 루트 파티션이 1바이트라도 변경되면 기기가 부팅되지 않도록 봉쇄했습니다. 이에 따라 최신 탈옥(Dopamine, Fugu15, palera1n)은 시스템 볼륨을 건드리지 않고 유저 파티션인 **/var/jb/** 아래에만 탈옥 바이너리를 설치하는 **Rootless(루트리스)** 구조로 완전히 전환되었습니다.

### 2-1. iOS 탈옥 탐지: Rootless 탈옥 대응 샘플 코드 (Swift)

```swift
import Foundation
import UIKit
import Darwin

enum JailbreakDetector {

    // 전통적인 경로 + 최신 Rootless(/var/jb/) 탈옥 경로
    private static let suspiciousPaths: [String] = [
        "/Applications/Cydia.app",
        "/Library/MobileSubstrate/MobileSubstrate.dylib",
        "/bin/bash",
        "/usr/sbin/sshd",
        "/etc/apt",
        "/private/var/lib/apt/",
        "/usr/bin/ssh",
        // 최신 Rootless 탈옥(Dopamine, Fugu15 등) 전용 경로
        "/var/jb/Applications/Sileo.app",
        "/var/jb/Applications/Zebra.app",
        "/var/jb/bin/bash",
        "/var/jb/usr/sbin/sshd",
        "/var/jb/usr/bin/dpkg"
    ]

    static func isJailbroken() -> Bool {
        #if targetEnvironment(simulator)
        return false // 시뮬레이터 제외
        #endif

        return checkSuspiciousPaths() ||
               checkSandboxWriteAccess() ||
               checkCanOpenCydiaURL() ||
               checkForkProcess()
    }

    private static func checkSuspiciousPaths() -> Bool {
        for path in suspiciousPaths {
            if FileManager.default.fileExists(atPath: path) {
                return true
            }
        }
        return false
    }

    // 샌드박스 밖 쓰기 권한 테스트 (순정 기기라면 권한 에러 발생해야 정상)
    private static func checkSandboxWriteAccess() -> Bool {
        let testPath = "/private/jailbreak_sandbox_test.txt"
        do {
            try "test".write(toFile: testPath, atomically: true, encoding: .utf8)
            try? FileManager.default.removeItem(atPath: testPath)
            return true // 쓰기에 성공했다면 샌드박스가 뚫린 탈옥 상태
        } catch {
            return false
        }
    }

    // Cydia 커스텀 URL Scheme 오픈 가능 여부
    // ⚠️ 팩트체크: Info.plist의 'LSApplicationQueriesSchemes'에 "cydia"가 등록되어 있어야 동작함
    private static func checkCanOpenCydiaURL() -> Bool {
        guard let cydiaUrl = URL(string: "cydia://package/com.example.package") else { return false }
        return UIApplication.shared.canOpenURL(cydiaUrl)
    }

    // fork() 시스템 콜 호출 (정상 iOS 샌드박스에서는 금지되어 음수 반환)
    private static func checkForkProcess() -> Bool {
        let pid = fork()
        if pid >= 0 {
            if pid > 0 {
                var status: Int32 = 0
                waitpid(pid, &status, 0)
            }
            return true // fork가 성공했다면 샌드박스가 무력화된 탈옥 상태
        }
        return false
    }
}
```

### 2-2. iOS 디버거 부착 차단 샘플 코드 (Anti-Debugging)

공격자가 LLDB나 Frida를 프로세스에 부착(`attach`)하여 메모리나 분기문을 조작하는 것을 방어합니다.

#### 1) `ptrace(PT_DENY_ATTACH)`와 App Store 심사 주의사항
BSD 시스템 콜인 `ptrace(PT_DENY_ATTACH, 0, nil, 0)`는 디버거 부착 시 프로세스를 강제 종료시킵니다. 하지만 애플 심사(App Review)에서 정적 `ptrace` 호출은 비공개 API(Private API)로 오인되어 가이드라인 2.5.2 리젝 사유가 될 수 있습니다. 실무에서는 `dlsym`을 통한 동적 바인딩을 사용하거나, 더 안전한 `sysctl` 방식을 권장합니다.

```swift
import Darwin

let PT_DENY_ATTACH: Int32 = 31
typealias PtraceType = @convention(c) (Int32, pid_t, caddr_t?, Int32) -> Int32

func disableDebuggerAttach() {
    let handle = dlopen(nil, RTLD_GLOBAL | RTLD_NOW)
    if let sym = dlsym(handle, "ptrace") {
        let ptraceFunc = unsafeBitCast(sym, to: PtraceType.self)
        _ = ptraceFunc(PT_DENY_ATTACH, 0, nil, 0)
    }
}
```

#### 2) `sysctl` 기반 `P_TRACED` 플래그 감지 (실무 권장)

```swift
import Darwin
import Foundation

func isDebuggerAttached() -> Bool {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]

    let result = sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0)
    if result != 0 {
        return false
    }

    // kp_proc.p_flag의 P_TRACED(0x00000800) 비트 활성화 여부 확인
    return (info.kp_proc.p_flag & P_TRACED) != 0
}
```

### 2-3. Apple 공식: App Attest (DeviceCheck 프레임워크)

iOS 14+에서는 Google Play Integrity에 대응하는 **DCAppAttestService**를 기본 제공합니다. Secure Enclave 하드웨어 서명 키를 생성하여 앱 바이너리의 변조 여부와 디바이스 정품 상태를 애플 검증 서버를 통해 백엔드에서 원격 증명할 수 있습니다.

---

## 3. 화면 캡처 및 녹화 차단의 진화 히스토리

### 📜 플랫폼별 화면 보호 API 변천사

| 플랫폼 | 도입 시점 | 주요 API / 기법 | 특징 |
| :--- | :--- | :--- | :--- |
| **Android** | Android 3.0 (API 11) | `FLAG_SECURE` | SurfaceFlinger 하드웨어 컴포지터 레벨 원천 차단 (스크린샷, 미러링, Recent 가림) |
| **Android** | **Android 14 (API 34)** | `Activity.ScreenCaptureCallback` | 스크린샷 차단이 아닌 **사용자의 캡처 행위 감지(Detection)** 공식 지원 |
| **iOS** | iOS 4.0 | `userDidTakeScreenshotNotification` | 스크린샷이 완료된 **사후(Post-event)** 알림만 제공 (사전 차단 불가) |
| **iOS** | iOS 11.0 | `UIScreen.capturedDidChangeNotification` | 화면 녹화(Screen Recording) 및 AirPlay 미러링 실시간 감지 |
| **iOS** | 실무 테크닉 | `UITextField.isSecureTextEntry` 레이어 | 하드웨어 렌더링 시 비밀번호 필드가 블랭크 처리되는 특성을 이용한 컨테이너 뷰 트릭 |

### 3-1. [Android] `FLAG_SECURE` 및 Jetpack Compose / Android 14 샘플 코드

#### 1) XML Activity 기반 `FLAG_SECURE`
```kotlin
import android.os.Bundle
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity

class SecureActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // 하드웨어 레벨 원천 차단 (FLAG_SECURE)
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
        
        setContentView(R.layout.activity_secure)
    }
}
```

#### 2) Jetpack Compose: 화면 진입 시 동적으로 보호하는 `SecureScreen` Composable
```kotlin
import android.app.Activity
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext

@Composable
fun SecureScreen(content: @Composable () -> Unit) {
    val context = LocalContext.current
    
    DisposableEffect(Unit) {
        val window = (context as? Activity)?.window
        window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        
        onDispose {
            // 해당 화면을 빠져나갈 때 플래그 해제
            window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
    
    content()
}
```

#### 3) Android 14(API 34) 신규: `ScreenCaptureCallback` (캡처 감지 액티비티)
```kotlin
import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class ScreenshotDetectionActivity : AppCompatActivity() {

    private val screenCaptureCallback = Activity.ScreenCaptureCallback {
        // 사용자가 볼륨하단+전원키로 스크린샷을 찍었을 때 호출됨
        Toast.makeText(this, "화면 캡처가 감지되었습니다. 보안 로그가 기록됩니다.", Toast.LENGTH_SHORT).show()
    }

    override fun onStart() {
        super.onStart()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            registerScreenCaptureCallback(mainExecutor, screenCaptureCallback)
        }
    }

    override fun onStop() {
        super.onStop()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            unregisterScreenCaptureCallback(screenCaptureCallback)
        }
    }
}
```

### 3-2. [iOS] `UITextField` 캔버스 트릭 & SwiftUI 연동 샘플 코드

#### 1) UIKit 컨테이너 뷰 (`SecureContainerView.swift`)
```swift
import UIKit

/// 스크린샷 및 화면 녹화 시 내용이 검게 마스킹되는 보안 컨테이너 뷰
final class SecureContainerView: UIView {
    private let secureTextField = UITextField()
    private var secureContainer: UIView?

    override init(frame: CGRect) {
        super.init(frame: frame)
        setupSecureView()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupSecureView()
    }

    private func setupSecureView() {
        secureTextField.isSecureTextEntry = true
        secureTextField.translatesAutoresizingMaskIntoConstraints = false
        addSubview(secureTextField)

        NSLayoutConstraint.activate([
            secureTextField.topAnchor.constraint(equalTo: topAnchor),
            secureTextField.bottomAnchor.constraint(equalTo: bottomAnchor),
            secureTextField.leadingAnchor.constraint(equalTo: leadingAnchor),
            secureTextField.trailingAnchor.constraint(equalTo: trailingAnchor)
        ])

        // isSecureTextEntry 활성화 시 생성되는 비공개 캔버스 레이어 (_UITextLayoutCanvasView) 바인딩
        if let canvasView = secureTextField.subviews.first(where: { 
            type(of: $0).description().contains("Canvas") 
        }) ?? secureTextField.subviews.first {
            secureContainer = canvasView
            canvasView.isUserInteractionEnabled = true
        }
    }

    /// 민감 정보를 담는 실제 뷰를 보안 캔버스 계층에 추가
    func addSecuredSubview(_ view: UIView) {
        if let container = secureContainer {
            container.addSubview(view)
        } else {
            addSubview(view) // fallback
        }
    }
}
```

#### 2) SwiftUI 연동을 위한 `SecureView` 래퍼
```swift
import SwiftUI

/// SwiftUI 뷰를 감싸서 캡처 방지 처리하는 ViewModifier / View
struct SecureView<Content: View>: UIViewRepresentable {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    func makeUIView(context: Context) -> SecureContainerView {
        let secureView = SecureContainerView()
        let hostingController = UIHostingController(rootView: content)
        hostingController.view.backgroundColor = .clear
        hostingController.view.translatesAutoresizingMaskIntoConstraints = false
        
        secureView.addSecuredSubview(hostingController.view)
        
        NSLayoutConstraint.activate([
            hostingController.view.topAnchor.constraint(equalTo: secureView.topAnchor),
            hostingController.view.bottomAnchor.constraint(equalTo: secureView.bottomAnchor),
            hostingController.view.leadingAnchor.constraint(equalTo: secureView.leadingAnchor),
            hostingController.view.trailingAnchor.constraint(equalTo: secureView.trailingAnchor)
        ])
        
        return secureView
    }

    func updateUIView(_ uiView: SecureContainerView, context: Context) {}
}

// SwiftUI 사용 예시
struct SensitiveDataView: View {
    var body: some View {
        SecureView {
            VStack {
                Text("계좌번호: 110-123-456789")
                Text("보안카드 비밀번호: ****")
            }
            .padding()
            .background(Color.white)
        }
    }
}
```

---

## 4. 앱 서명 지문 & 위변조 무결성 검증의 진화 히스토리

### 📜 Android APK 서명 체계 변천사 (v1 ~ v4)

1. **v1 서명 (JAR 서명, Android 1.0+)**: ZIP 메타데이터(`META-INF`) 파일 단위 서명. ZIP 파일 헤더나 미검증 영역을 변조하여 악성 코드를 주입하는 **Janus 취약점(CVE-2017-13156)**에 노출됨.
2. **v2 서명 (Android 7.0 Nougat+)**: APK 전체 바이트를 보호하는 **APK Signing Block** 도입. 설치 속도 향상 및 바이트 단위 변조 원천 차단.
3. **v3 서명 (Android 9.0 Pie+)**: **키 순환(Key Rotation)** 지원. 과거 서명 키가 유출되었더라도 새로운 키로 서명하고 히스토리를 증명할 수 있는 `SigningInfo` API 도입.
4. **v4 서명 (Android 11+)**: 대용량 앱의 스트리밍 설치를 지원하기 위한 fs-verity 해시 트리 기반 서명.

### 4-1. [Android] SigningInfo 기반 SHA-256 서명 지문 검증 샘플 코드 (Kotlin)

```kotlin
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.security.MessageDigest

object AppSignatureVerifier {

    // 정식 릴리스 배포 키의 SHA-256 지문 (반드시 대문자 콜론 구분 포맷)
    private const val EXPECTED_RELEASE_SIGNATURE_SHA256 = 
        "A1:B2:C3:D4:E5:F6:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34"

    fun verifyAppSignature(context: Context): Boolean {
        return try {
            val currentSignatureHex = getSignatureSha256(context)
            EXPECTED_RELEASE_SIGNATURE_SHA256.equals(currentSignatureHex, ignoreCase = true)
        } catch (e: Exception) {
            false
        }
    }

    private fun getSignatureSha256(context: Context): String {
        val pm = context.packageManager
        val packageName = context.packageName

        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signingInfo = pm.getPackageInfo(
                packageName,
                PackageManager.GET_SIGNING_CERTIFICATES
            ).signingInfo
            
            if (signingInfo.hasMultipleSigners()) {
                signingInfo.apkContentsSigners
            } else {
                signingInfo.signingCertificateHistory
            }
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(
                packageName,
                PackageManager.GET_SIGNATURES
            ).signatures
        }

        val cert = signatures?.firstOrNull()?.toByteArray() ?: return ""
        val md = MessageDigest.getInstance("SHA-256")
        val digest = md.digest(cert)

        return digest.joinToString(":") { String.format("%02X", it) }
    }
}
```

> **⚠️ [실무 팩트체크] Google Play App Signing의 SHA-256 함정!**  
> Google Play App Signing 도입 이후, 개발자가 Play Console에 업로드할 때 사용하는 **"업로드 키(Upload Key)"**와 구글 서버가 최종 사용자에게 배포할 때 새로 서명하는 **"앱 서명 키(App Signing Key)"**의 지문이 다릅니다.  
> 코드에 하드코딩할 값은 개발자의 로컬 keystore 지문이 아니라, **Google Play Console > 설정 > 앱 무결성(App Integrity) > 앱 서명** 탭의 **"앱 서명 키 인증서 SHA-256 지문"**이어야 합니다. 그렇지 않으면 스토어 배포 직후 모든 앱이 무결성 검증 실패로 튕기는 대형 장애가 발생합니다.

### 4-2. [iOS] 번들 ID 및 프로비저닝 프로파일 검증 샘플 코드 (Swift)

공격자가 유출된 기업용(In-House) 인증서나 무료 개발자 계정으로 앱을 재서명(Resigning)하여 AltStore, TrollStore 등으로 유포하는 행위를 탐지합니다.

```swift
import Foundation

enum AppIntegrityChecker {

    // 1. 프로비저닝 프로파일 유무 검사
    // 팩트: App Store 정식 배포 빌드는 FairPlay DRM으로 패키징되어 번들 내에 embedded.mobileprovision이 없음!
    static func checkEmbeddedProvisioningProfile() -> Bool {
        #if DEBUG
        return true // 개발/디버그 빌드는 정상적으로 프로파일이 존재함
        #else
        if let _ = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") {
            return false // App Store 프로덕션 빌드에 프로비저닝 프로파일이 있다면 재서명된 변조 앱!
        }
        return true
        #endif
    }

    // 2. 번들 식별자(Bundle Identifier) 변조 검사
    static func verifyBundleIdentifier(expected: String) -> Bool {
        guard let bundleID = Bundle.main.bundleIdentifier else { return false }
        return bundleID == expected
    }
}
```

---

## 5. 심층 방어(Defense-in-Depth)를 위한 종합 매트릭스

| 구분 | 주요 대상 | 로컬 방어 난이도 | Frida/후킹 저항력 | 실무 권장 베스트 프랙티스 |
| :--- | :--- | :---: | :---: | :--- |
| **루팅 차단** | Android | 보통 | **낮음** (Zygisk/KernelSU) | 로컬 휴리스틱 + **Play Integrity API 서버 판정** 필수 결합 |
| **탈옥 차단** | iOS | 보통 | **낮음** (Shadow, Choicy) | Rootless(`/var/jb`) 감지 + **App Attest** 원격 증명 |
| **안티 디버깅** | iOS / Android | 보통 | **보통** | Native C 레벨 `sysctl(P_TRACED)` 주기적 검사 |
| **화면 캡처 차단** | Android | **매우 낮음** | **매우 높음** | `FLAG_SECURE` 단일 적용 (하드웨어 레벨 보장) |
| **화면 캡처 차단** | iOS | 높음 | 보통 | `UITextField.isSecureTextEntry` 서브뷰 계층화 트릭 |
| **서명 지문 검증** | Android | 보통 | **보통** | NDK(C++) 레이어 은닉 + Play Console 앱 서명 키 SHA-256 검증 |
| **재서명 방지** | iOS | 보통 | 보통 | `embedded.mobileprovision` 유무 및 번들 식별자 검증 |

### 핵심 요약: 클라이언트 보안 3대 철칙
1. **단일 실패점(Single Point of Failure)을 두지 말 것**: `if (isDeviceRooted()) exitProcess(0)`와 같은 단순 분기문은 Frida 스크립트 한 줄(`Java.use(...).isDeviceRooted.implementation = () => false`)로 1초 만에 무력화됩니다.
2. **핵심 보안 로직은 Native(C/C++/NDK/Rust) 계층으로 은닉**: Java/Swift 바이트코드는 디컴파일 및 런타임 심볼 조작이 매우 쉽습니다. 안티 디버깅과 서명 해시 계산은 가급적 인라인 어셈블리 또는 난독화된 Native 라이브러리(`.so`)에서 처리해야 분석 난이도가 급상승합니다.
3. **서버 사이드 신뢰 모델 구축**: 기기 상태의 최종 판정은 클라이언트가 아니라, Play Integrity / App Attest 토큰을 수신받은 **백엔드 서버가 직접 구글/애플 API와 통신하여 세션을 차단**하도록 설계해야 합니다.
