---
layout: post
title: "‘CI에서 release 빌드를 돌리지 마라’의 오독: 5개 앱 전체 R8 검증 공백과 런타임 크래시 해결기"
date: 2026-08-23 11:00:00 +0900
categories: [Android, CI/CD, DevOps]
tags: [Android, R8, Proguard, CICD, GitHubActions, Gradle, Mobile, Optimization, Troubleshooting]
---

안드로이드 앱을 개발하고 배포할 때, 모든 개발자가 가장 두려워하는 순간 중 하나는 **"로컬과 CI에서는 완벽하게 테스트를 통과했는데, 구글 플레이 스토어에 배포되자마자 실기기에서 앱이 켜지지도 않고 튕기는(Crash) 현상"**일 것입니다.

이 글은 "CI 러너에 서명 키를 두지 않는다"는 지극히 당연한 보안 원칙이 어떻게 **"CI에서 Release 빌드를 아예 돌리지 않는다"는 치명적인 오독으로 변질**되었는지, 그리고 그로 인해 5개 앱 전체에 수개월간 방치되었던 **R8 난독화 검증 공백과 런타임 크래시를 추적하고 해결한 과정**을 기록한 회고입니다.

---

## 1. 사건의 발단: CI는 초록불인데 실기기에서 터진 앱

어느 날 사진 리사이징 앱(PhotoFit)의 신규 버전을 스토어에 릴리즈한 직후, 사용자 기기에서 알 수 없는 크래시 리포트가 접수되기 시작했습니다.

```
Fatal Exception: java.lang.RuntimeException: 
Cannot create an instance of class com.gwangy.photofit.data.WorkDatabase
Caused by: java.lang.NoSuchMethodException: 
com.gwangy.photofit.data.WorkDatabase.<init> []
    at java.lang.Class.getConstructor0(Class.java:2332)
    at androidx.room.Room.databaseBuilder(Room.kt:54)
    ...
```

분명 GitHub Actions CI 파이프라인에서 단위 테스트(`testDebugUnitTest`), 린트(`ktlintCheck`), 정적 분석까지 모두 **Conclusion=Success (All Green)**으로 통과한 빌드였습니다.

원인은 너무나 명확했습니다. **R8/Proguard 최적화(Tree Shaking)와 난독화가 릴리즈 빌드에서 클래스의 기본 생성자(no-arg constructor)를 "사용되지 않는 코드"로 판단하고 날려버린 것**이었습니다.

하지만 진짜 문제는 따로 있었습니다. **"도대체 왜 이런 치명적인 난독화 결함이 CI 파이프라인에서 사전에 단 한 번도 잡히지 않았는가?"** 였습니다.

---

## 2. 오독의 나비효과: "서명을 올리지 마라" ≠ "Release를 돌리지 마라"

파이프라인의 과거 기록과 `ci.yml` 설정을 전수 조사하던 중, 소름 돋는 주석 한 줄을 발견했습니다.

```yaml
# ❌ CI 워크플로우에 적혀 있던 문제의 주석
# assembleRelease is deliberately NOT used because signing keys must not exist in CI.
- name: Run Unit Tests
  run: ./gradlew testDebugUnitTest
```

### 오독이 발생한 메커니즘

1. **원래의 보안 규약**: "CI 환경(특히 오픈소스나 러너 환경)에 Keystore 파일이나 비밀번호 같은 *릴리즈 서명(Release Signing)* 정보를 두지 않는다."
2. **잘못된 해석**: 서명 키가 없으면 `assembleRelease` 태스크가 실패하므로, **"CI에서는 Release 빌드 태스크 자체를 돌리면 안 된다"**로 오독함.
3. **나비효과**: `testDebugUnitTest`만 돌리도록 파이프라인을 구성했고, "서명 빌드는 CI에서 돌리지 않는다"는 문장이 CI 문서 헤더에 공식 명문화됨.
4. **함대 전파**: 이 잘못된 표준이 5개 자매 앱(PaletteWeather, HealingVisualizer, SnackPlay, NativeLayoutStudio, PhotoFit) 전체로 복사·전파(Propagation)됨.

결과적으로 **5개 앱 전체가 디버그 빌드(R8이 적용되지 않는 빌드)만 테스트하고 있었고, R8이 코드를 어떻게 난도질하는지는 스토어에 올리기 전까지 아무도 모르는 무방비 상태**였던 것입니다.

> 💡 **핵심 교훈**: 금지되는 것은 **서명(Signing)**이지, **Release 컴파일 및 R8 최적화 빌드**가 아닙니다.

---

## 3. 실패했던 첫 번째 해결 시도: "Missing class 0건" 검사의 함정

문제를 인지한 후, "R8 난독화 로그에서 누락된 클래스(`Missing class`) 경고가 0건인지 검사하자"는 스크립트를 CI에 추가했습니다.

```bash
# ❌ 런타임 크래시를 못 잡는 무의미한 검사
grep "Missing class" r8_output.log | wc -l # 0건이면 통과?
```

하지만 이 검사는 **PhotoFit의 크래시를 전혀 잡아내지 못했습니다.**

### 왜 못 잡았는가?

R8은 `WorkDatabase`라는 **클래스 자체는 제거하지 않고 남겨두었습니다.** 그러나 Room/WorkManager가 내부 리플렉션으로 호출하는 **매개변수 없는 기본 생성자(`<init>()`)만 콕 집어서 제거(Dead code stripping)**했습니다.

- 컴파일러와 R8 입장에서는 "어디에서도 직접 new 하지 않으니 지워도 안전하다"고 판단함.
- 클래스 자체가 누락된 것은 아니므로 `Missing class` 경고는 **0건**.
- 빌드는 **Exit Code 0**으로 산뜻하게 통과.
- 그러나 런타임에 리플렉션으로 객체를 생성하려는 순간 `NoSuchMethodException` 발생.

---

## 4. 진짜 해법: 무서명 `assembleRelease` + `seeds.txt` 보존 단언

이 문제를 완벽히 해결하기 위해 두 가지 방어선을 구축했습니다.

### 1단계: CI에서 서명 없는 Release 아티팩트 빌드 (`build.gradle.kts`)

서명 키가 없어도 릴리즈 컴파일과 R8 난독화가 돌아가도록 Gradle 빌드 타입을 구성합니다. 서명 설정이 없으면 Unsigned APK/AAR을 생성하고 정상 종료됩니다.

```kotlin
android {
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // CI에서는 signingConfig를 지정하지 않거나 debug 키로 대체
            signingConfig = null 
        }
    }
}
```

CI 워크플로우(`ci.yml`)에서는 디버그 테스트뿐만 아니라 릴리즈 빌드 태스크를 필수로 수행합니다:

```yaml
- name: Run Release Build and Optimization
  run: ./gradlew testReleaseUnitTest assembleRelease
```

---

### 2단계: `seeds.txt` 파싱을 통한 클래스 & 생성자 보존 단언 (Assertion)

R8이 빌드를 완료하면 `app/build/outputs/mapping/release/seeds.txt` 파일에 **"Keep 규칙에 의해 살아남은(제거되지 않은) 모든 클래스와 메서드/생성자 목록"**이 기록됩니다.

이 파일을 파싱하여, 리플렉션이나 프레임워크가 요구하는 필수 클래스와 생성자가 실제로 살아있는지 단언(Assert)하는 검증 스크립트를 작성했습니다.

```python
#!/usr/bin/env python3
"""verify-r8-seeds.py: R8 seeds.txt에서 필수 클래스 및 생성자 보존 여부를 검증"""

import os
import sys

SEEDS_PATH = "android/app/build/outputs/mapping/release/seeds.txt"

# 릴리즈 시 절대 생성자가 날아가면 안 되는 필수 클래스 목록
CRITICAL_CLASSES = [
    "com.gwangy.photofit.data.WorkDatabase",
    "com.gwangy.paletteweather.widget.WeatherGlanceWidgetReceiver",
    "com.gwangy.snackplay.worker.RewardSyncWorker"
]

def verify_seeds():
    if not os.path.exists(SEEDS_PATH):
        print(f"❌ Error: {SEEDS_PATH} not found. Did you run assembleRelease?")
        sys.exit(1)

    with open(SEEDS_PATH, "r", encoding="utf-8") as f:
        seeds_content = f.read()

    missing = []
    for cls in CRITICAL_CLASSES:
        # 클래스 선언뿐만 아니라 기본 생성자 <init>()까지 seeds에 남아있는지 확인
        constructor_pattern = f"{cls}: <init>()"
        if cls not in seeds_content:
            missing.append(f"Class missing: {cls}")
        elif constructor_pattern not in seeds_content:
            missing.append(f"Constructor missing: {constructor_pattern}")

    if missing:
        print("❌ R8 Proguard Assertion Failed!")
        for m in missing:
            print(f"  - {m}")
        sys.exit(1)

    print("✅ All critical classes and constructors are safely preserved in R8 seeds.txt!")

if __name__ == "__main__":
    verify_seeds()
```

이 스크립트를 CI 파이프라인의 `assembleRelease` 바로 뒤에 배치함으로써, Proguard 규칙 실수로 생성자가 날아가는 순간 CI가 즉시 **Red(빌드 실패)**로 차단하도록 만들었습니다.

---

## 5. 리플렉션 기반 라이브러리 Proguard Keep 수칙

Android에서 R8 크래시가 가장 빈번하게 발생하는 4대 라이브러리와 필수 `proguard-rules.pro` 수칙입니다.

### 1) WorkManager (Worker & InputMerger)
WorkManager는 클래스 이름 문자열을 기반으로 리플렉션을 통해 Worker와 InputMerger를 인스턴스화합니다. 생성자가 날아가면 백그라운드 작업이 조용히 실패합니다.

```proguard
-keepclasseswithmembers class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-keep class * extends androidx.work.InputMerger {
    public <init>();
}
```

### 2) Glance AppWidget (Jetpack Compose Widget)
위젯 리시버와 액션 콜백 역시 매니페스트나 PendingIntent에서 리플렉션으로 생성됩니다.

```proguard
-keep class * extends androidx.glance.appwidget.GlanceAppWidgetReceiver {
    public <init>();
}
-keep class * implements androidx.glance.appwidget.action.ActionCallback {
    public <init>();
}
```

### 3) Google Mobile Ads (AdMob) Mediation Adapters
네이티브 광고 커스텀 렌더러나 미디에이션 어댑터 클래스는 코드에서 직접 참조되지 않더라도 AdMob SDK가 동적으로 로드합니다.

```proguard
-keep class com.google.android.gms.ads.mediation.** { *; }
-keep class com.google.ads.mediation.** { *; }
```

---

## 6. 결론: "통과가 아니라, 실패를 증명하라"

이번 트러블슈팅을 통해 얻은 가장 큰 엔지니어링 교훈은 다음 세 가지입니다.

1. **`qa green ≠ release green`**: 디버그 빌드와 릴리즈 빌드는 완전히 다른 컴파일러 최적화 파이프라인을 거칩니다. 디버그 빌드의 통과는 릴리즈 안정성을 보장하지 못합니다.
2. **보안과 빌드 검증을 분리하라**: 서명 키를 숨기는 것과 릴리즈 바이너리를 빌드/테스트하는 것은 완전히 별개의 관심사입니다.
3. **가드는 통과가 아니라 실패를 증명해야 한다**: 테스트와 가드 스크립트는 "정상일 때 통과하는가"보다 **"의도적으로 Proguard Keep을 뺐을 때 실제로 빌드를 터뜨릴 수 있는가(Negative Testing)"**를 증명해야 비로소 신뢰할 수 있습니다.

혹시 여러분의 CI에서도 `testDebugUnitTest`만 돌리고 계시진 않나요? 지금 바로 `ci.yml`을 확인해 보세요!
