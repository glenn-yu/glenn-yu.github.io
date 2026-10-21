---
layout: post
title: "[AI 엔지니어링] 로컬 Mac에 Local LLM(MLX)을 붙여 클라우드 코딩 토큰 90% 아끼기"
date: 2026-10-22 09:00:00 +0900
categories: [AI, Tooling, Architecture]
tags: [LocalLLM, MLX, AppleSilicon, ClaudeCode, Codex, Antigravity, TokenOptimization, MultiAgent]
excerpt: "Claude Code, Codex, Antigravity(agy) 같은 AI 코딩 에이전트를 상시 운영할 때 발생하는 막대한 클라우드 토큰 비용을 Apple Silicon MLX 로컬 모델과 복잡도 기반 라우팅으로 90% 절감한 실전 아키텍처를 정리한다."
---

AI 코딩 에이전트(Claude Code, Codex CLI, Antigravity 등)를 개발 파이프라인의 중심에 두고 작업하다 보면 가장 먼저 마주하는 현실적인 벽은 **'토큰 비용'과 '레이트 리밋'**입니다.

기능 구현 하나를 위해 수십 번의 `git diff`를 검토하고, 수백 줄의 빌드 로그 에러를 분석하고, 반복적인 DTO 매퍼나 단위 테스트 스켈레톤을 작성할 때마다 클라우드 LLM(Claude 3.7 Sonnet, Gemini Pro 등)을 호출하면 하루 수십만~수백만 토큰이 순식간에 소모됩니다.

하지만 냉정하게 생각해보면, **모든 작업에 최고 사양의 프론티어 클라우드 모델이 필요하지는 않습니다.**

단순한 보일러플레이트 작성, 컴파일 에러 요약, diff 사전 리뷰 같은 하위 작업은 로컬 Mac의 Apple Silicon(M시리즈) NPU/GPU 위에서 도는 8B~20B 경량 오픈 모델로도 충분히 훌륭하게 처리할 수 있습니다. 

함대(HAMDAE) 프로젝트에서 **Apple의 MLX 프레임워크와 온디맨드 로컬 워커(`local-llm`)**를 구축하여 클라우드 토큰을 80~90% 절감한 실전 아키텍처와 운영 원칙을 공유합니다.

---

## 1. 아키텍처: 계층형 멀티 에이전트 오케스트레이션

핵심 아이디어는 간단합니다. **"클라우드 에이전트(Parent)가 로컬 모델(Worker)을 하위 도구로 부리는 구조"**입니다.

```
┌────────────────────────────────────────────────────────┐
│  Parent AI Agent (Claude Code / Codex CLI / agy)       │
│  - 전체 작업 소유, 아키텍처 판단, 보안, 최종 커밋 결정   │
└───────────────────────────┬────────────────────────────┘
                            │
               난이도 판별 (LOW 등급 작업 위임)
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  local-llm CLI (하드웨어 감지 & 수명주기 오케스트레이터) │
│  - 통합 메모리(RAM) 용량 감지 (16GB vs 32GB vs 64GB+)   │
│  - On-Demand 백그라운드 서버 구동 & 유휴 시 자동 종료  │
└───────────────────────────┬────────────────────────────┘
                            │
              127.0.0.1:8080 (OpenAI 호환 API)
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  MLX LM Server (Apple Silicon Unified Memory 가속)     │
│  - 16GB: Qwen3-8B-4bit (초당 38 tok/s)                 │
│  - 32GB+: gpt-oss-20b-MXFP4-Q8 (초당 30 tok/s)        │
└────────────────────────────────────────────────────────┘
```

### 필수 설계 원칙 3가지

1. **저장소 의존성 제로 (Zero-Hard-Dependency)**: 로컬 LLM이 없거나 꺼져 있어도 CI, 빌드, 릴리스 파이프라인은 100% 정상 작동해야 합니다. 도구가 없으면 `SKIPPED_UNAVAILABLE`로 넘어가고 Parent가 직접 클라우드 모델로 계속 진행합니다.
2. **온디맨드 기동 (On-Demand Launch)**: 8GB~14GB의 거대한 모델을 상시 메모리에 띄워두면 개발 중 Xcode나 Android Studio 빌드 속도가 저하됩니다. 첫 요청 시 백그라운드로 즉시 뜨고, 15분(`900초`) 동안 유휴 상태면 스스로 메모리를 반환하고 내려갑니다.
3. **"로컬 출력은 믿을 수 없는 초안(UNTRUSTED DRAFT)이다"**: 로컬 모델의 출력을 검증 없이 그대로 제품에 반영하지 않습니다. Parent 에이전트가 로컬 모델의 결과물을 diff, 컴파일, 린트, 단위 테스트로 독립 재검증한 뒤에만 채택합니다.

---

## 2. 작업 복잡도 기반 라우팅: 무엇을 로컬에 맡길 것인가?

로컬 모델의 토큰 비용은 0원이지만, 복잡한 아키텍처 설계나 동시성 제어 같은 고난이도 작업을 맡기면 오히려 잘못된 코드를 고치느라 클라우드 토큰을 더 쓰게 됩니다.

따라서 작업을 **LOW / MEDIUM / HIGH** 등급으로 명확히 분리하여 라우팅합니다.

| 등급 | 로컬 LLM 역할 | 위임 작업 예시 (로컬 100% 위임) |
| :--- | :--- | :--- |
| **LOW** | **Local-First** (비용 0원) | • DTO / Mapper / Converter 변환 코드<br>• 단위 테스트 스켈레톤 및 Mock 데이터 생성<br>• 다국어(l10n) 번역 키/문자열 초안<br>• 간단한 Compose/SwiftUI 스타일 수정<br>• `git diff` 1차 사전 리뷰 초안<br>• 200줄 빌드 에러 로그 요약 (First-Pass Triage) |
| **MEDIUM** | **Parent 소유** + 로컬 보조 | • 3~10개 파일 규모의 중간 리팩터링<br>• 상태 변경 및 UI 네비게이션 흐름<br>• Android ↔ iOS 크로스 플랫폼 패리티 검토 |
| **HIGH** | **Cloud 전용** (로컬 위임 금지) | • 시스템 아키텍처 및 DB 마이그레이션<br>• 인증/보안/암호화/개인정보 처리<br>• AdMob Bidding 및 인앱 결제 라이프사이클<br>• 스토어 제출 및 프로덕션 릴리스 판정 |

---

## 3. Apple Silicon 통합 메모리 프로파일링

Apple Silicon은 CPU와 GPU가 통합 메모리(Unified Memory)를 공유하므로, VRAM이 부족해 큰 모델을 못 돌리는 x86 PC와 달리 RAM 용량 전체를 모델 가중치로 활용할 수 있습니다.

`local-llm`은 칩 이름(M1/M2/M3)이 아니라 **실제 시스템 RAM 크기**를 읽어 최적의 양자화 모델을 자동 선택합니다.

```bash
# 하드웨어 감지 로직 (tools/local-llm/install.sh 발췌)
MEM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))

if [ "$MEM_GB" -lt 24 ]; then
    PROFILE="APPLE_SILICON_16GB"      # M3 Air 등: Qwen3-8B-4bit (약 4.8GB Footprint)
elif [ "$MEM_GB" -lt 48 ]; then
    PROFILE="APPLE_SILICON_32GB"      # M1 Pro 등: gpt-oss-20b-MXFP4-Q8 (약 13.7GB Footprint)
else
    PROFILE="APPLE_SILICON_64GB_PLUS" # 32GB 선호 단과 동일
fi
```

### 메모리 압박(Memory Pressure) 감지와 자동 단 내리기 (Demotion)

Xcode 빌드나 Gradle 데몬이 돌면서 macOS의 `kern.memorystatus_vm_pressure_level`이 올라가면, 로컬 LLM이 스스로 판단하여 가벼운 단으로 낮추거나 기동을 건너뜁니다:
- **`warn` 상태**: 20B 대신 가장 가벼운 8B 캐시 모델로 강제 전환.
- **`critical` 상태**: 로컬 서버를 띄우지 않고 exit 3(`FAILED_FALLBACK`) 반환 → Parent가 즉시 클라우드로 처리하여 Mac이 버벅이는 현상을 방지.

---

## 4. 에이전트 CLI에서 실제로 부르는 방법

Claude Code, Codex CLI, Antigravity(agy)는 모델의 이름이나 IP를 직접 알 필요가 없습니다. 표준 유닉스 파이프와 셸 명령 하나로 소통합니다.

### 1) Git Diff 리뷰 초안 (토큰 절약의 핵심 지점)

PR을 올리기 전 수백 줄의 변경 사항을 클라우드에 통째로 보내면 입력 토큰 비용이 큽니다. 이를 로컬 모델에 파이프로 넘겨 1차 초안을 받습니다.

```bash
git diff origin/main | local-llm review
```

```text
[stderr] LOCAL_LLM: USED (UNTRUSTED DRAFT - Qwen3-8B-4bit, 38 tok/s)
[stdout] 
- NativeAdSlot.kt: LinearLayout의 높이가 wrapContentHeight()로 되어 있어 세로 팽창 가능성 확인 필요.
- NativeAdSlot.swift: cardStyle()의 16pt 패딩이 프레임과 중첩되어 높이 136pt 부풀려짐 감지됨.
```

Parent 에이전트는 이 로컬 초안을 힌트 삼아 실제 소스 코드의 특정 라인만 표적 검증하므로, 클라우드 입력 토큰을 80% 이상 아낄 수 있습니다.

### 2) 단위 테스트 스켈레톤 초안 작성

```bash
local-llm tests android/app/src/main/java/com/gwangy/videofit/ads/ConversionInterstitialPolicy.kt
```

로컬 모델이 `ConversionInterstitialPolicyTest.kt`의 Given-When-Then 골격과 테스트 케이스 5개를 화면에 출력합니다. 파일을 덮어쓰지 않고 표준 출력(`stdout`)으로만 뱉어내므로, Parent가 안전하게 읽어 검증한 뒤 파일에 기록합니다.

### 3) 500줄 컴파일 에러 로그 요약 (First-Pass Triage)

```bash
./gradlew :app:assembleDebug 2>&1 | tail -100 | local-llm summarize
```

수많은 스택 트레이스 중에서 실제 에러 원인(`Type mismatch: inferred type is String? but String was expected at line 42`) 한 줄만 정확히 뽑아냅니다.

---

## 5. 실측 결과: 4주간의 운영 데이터

함대 8개 앱의 동시 리팩터링 및 UI v3 전 화면 확장 작업을 진행하며 4주간 측정한 실측 결과입니다.

| 지표 | 클라우드 단독 운영 (Before) | Local MLX 워커 병행 (After) | 절감 효과 |
| :--- | :--- | :--- | :--- |
| **주간 클라우드 토큰 소모** | 약 1,850만 토큰 | 약 210만 토큰 | **88.6% 절감** |
| **단위 테스트 생성 대기 시간** | 12~18초 (네트워크 RTT) | 3~5초 (로컬 38 tok/s) | **3배 이상 단축** |
| **API 레이트 리밋 발생 횟수** | 주 4~6회 (작업 중단) | **0회 (Zero)** | 병목 해소 |
| **월 API 비용** | ~$180 | ~$22 | **약 88% 절감** |

---

## 6. 결론: 가장 비싼 모델을 가장 적재적소에 쓰는 기술

AI 코딩 어시스턴트의 시대에 개발자의 생산성은 "얼마나 비싼 모델을 쓰느냐"가 아니라 **"어떤 크기의 모델을 어느 작업에 배치하느냐"**에서 갈립니다.

- 고도의 통찰, 아키텍처 판단, 보안, 배포 결정은 가장 똑똑한 **클라우드 프론티어 모델**에게 맡기고,
- 반복적인 보일러플레이트, 로그 요약, 초안 작성은 책상 위의 **Apple Silicon Local LLM**에게 위임하세요.

Mac의 유휴 NPU와 통합 메모리를 깨우는 것만으로도, 지갑과 레이트 리밋에 구애받지 않는 무제한의 AI 페어 프로그래밍 환경을 구축할 수 있습니다.
