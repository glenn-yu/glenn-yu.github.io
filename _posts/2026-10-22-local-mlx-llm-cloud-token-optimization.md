---
layout: post
title: "[AI 엔지니어링] 로컬 Mac에 Local LLM(MLX)을 붙여 클라우드 코딩 토큰 90% 아끼기"
date: 2026-10-22 09:00:00 +0900
categories: [AI, Tooling, Architecture]
tags: [LocalLLM, MLX, AppleSilicon, ClaudeCode, Codex, Antigravity, TokenOptimization, MultiAgent]
excerpt: "Claude Code, Codex, Antigravity(agy) 같은 AI 코딩 에이전트를 상시 운영할 때 발생하는 막대한 클라우드 토큰 비용을 Apple Silicon MLX 로컬 모델과 복잡도 기반 라우팅으로 90% 절감한 실전 아키텍처를 정리한다."
---

AI 코딩 에이전트(Claude Code, Codex CLI, Antigravity 등)를 개발 파이프라인의 중심에 두고 작업하다 보면 가장 먼저 마주하는 현실적인 벽은 **'토큰 비용'과 '레이트 리밋(Rate Limit)'**입니다.

기능 구현 하나를 위해 수십 번의 `git diff`를 검토하고, 수백 줄의 빌드 로그 에러를 분석하고, 반복적인 DTO 매퍼나 단위 테스트 스켈레톤을 작성할 때마다 클라우드 LLM(Claude 3.7 Sonnet, Gemini Pro 등)을 호출하면 하루 수십만~수백만 토큰이 순식간에 소모됩니다.

하지만 냉정하게 생각해보면, **모든 작업에 최고 사양의 프론티어 클라우드 모델이 필요하지는 않습니다.**

단순한 보일러플레이트 작성, 컴파일 에러 요약, diff 사전 리뷰 같은 하위 작업은 로컬 Mac의 Apple Silicon(M시리즈) NPU/GPU 위에서 도는 8B~20B 경량 오픈 모델로도 충분히 훌륭하게 처리할 수 있습니다. 

함대(HAMDAE) 프로젝트에서 **Apple의 MLX 프레임워크와 온디맨드 로컬 워커(`local-llm`)**를 구축하여 클라우드 토큰을 80~90% 절감한 실전 아키텍처와 벤치마크 실측 데이터를 공유합니다.

---

## 1. 아키텍처: 계층형 멀티 에이전트 오케스트레이션

핵심 아이디어는 간단합니다. **"클라우드 에이전트(Parent)가 로컬 모델(Worker)을 가속 도구로 부리는 구조"**입니다.

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
              127.0.0.1:8765 (OpenAI 호환 API)
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  MLX LM Server (Apple Silicon Unified Memory 가속)     │
│  - 16GB: Qwen3-8B-4bit (6.6GB, 31.7 tok/s)             │
│  - 32GB+: gpt-oss-20b-MXFP4-Q8 (12.0GB, 38.3 tok/s)   │
└────────────────────────────────────────────────────────┘
```

### 필수 설계 원칙 3가지

1. **저장소 의존성 제로 (Zero-Hard-Dependency)**: 로컬 LLM이 없거나 꺼져 있어도 CI, 빌드, 릴리스 파이프라인은 100% 정상 작동해야 합니다. 바이너리가 없으면 `SKIPPED_UNAVAILABLE`로 넘어가고, 서버 기동 실패 시 `exit 3`(`FAILED_FALLBACK`)으로 종료되어 Parent 에이전트가 즉시 클라우드 모델로 직접 작업을 계속합니다.
2. **온디맨드 기동 (On-Demand Launch)**: 8GB~14GB의 거대한 모델을 상시 메모리에 띄워두면 개발 중 Xcode나 Android Studio 빌드 속도가 저하됩니다. 첫 요청 시 백그라운드로 즉시 뜨고, 15분(`LOCAL_LLM_IDLE_SEC=900`) 동안 유휴 상태면 스스로 메모리를 반환하고 내려갑니다.
3. **"로컬 출력은 믿을 수 없는 초안(UNTRUSTED DRAFT)이다"**: 로컬 모델의 출력을 검증 없이 그대로 제품에 반영하지 않습니다. Parent 에이전트가 로컬 모델의 결과물을 diff, 컴파일, 린트, 단위 테스트로 독립 재검증한 뒤에만 채택합니다.

---

## 2. 작업 복잡도 기반 라우팅: 무엇을 로컬에 맡길 것인가?

로컬 모델의 토큰 비용은 0원이지만, 복잡한 아키텍처 설계나 동시성 제어 같은 고난이도 작업을 맡기면 오히려 잘못된 코드를 고치느라 클라우드 토큰을 더 쓰게 됩니다.

따라서 작업을 **LOW / MEDIUM / HIGH** 등급으로 명확히 분리하여 라우팅합니다.

| 등급 | 로컬 LLM 역할 | 위임 작업 예시 (로컬 100% 위임) |
| :--- | :--- | :--- |
| **LOW** | **Local-First** (비용 0원) | • DTO / Mapper / Converter 변환 코드<br>• 단위 테스트 스켈레톤 및 Mock 데이터 생성<br>• 다국어(l10n) 번역 키/문자열 초안<br>• 접근성 라벨 및 간단한 Compose/SwiftUI 스타일 수정<br>• `git diff` 1차 사전 리뷰 초안<br>• 200줄 빌드 에러 로그 요약 (First-Pass Triage) |
| **MEDIUM** | **Parent 소유** + 로컬 보조 | • 3~10개 파일 규모의 중간 리팩터링<br>• 상태 변경 및 UI 네비게이션 흐름<br>• Android ↔ iOS 크로스 플랫폼 패리티 검토 |
| **HIGH** | **Cloud 전용** (로컬 위임 금지) | • 시스템 아키텍처 및 DB 마이그레이션<br>• 인증/보안/암호화/개인정보 처리<br>• AdMob Bidding 및 인앱 결제 라이프사이클<br>• 스토어 제출 및 프로덕션 릴리스 판정 |

---

## 3. Apple Silicon 통합 메모리 프로파일링과 모델 선정 실측

Apple Silicon은 CPU와 GPU가 통합 메모리(Unified Memory)를 공유하므로, VRAM이 부족해 큰 모델을 못 돌리는 x86 PC와 달리 RAM 용량 전체를 모델 가중치로 활용할 수 있습니다.

`local-llm`은 칩 이름(M1/M2/M3)이 아니라 **실제 시스템 RAM 크기(`hw.memsize`)**를 읽어 최적의 양자화 모델을 자동 선택합니다.

```python
# tools/local-llm/local-llm 프로파일링 정의
TIERS = {
    "APPLE_SILICON_16GB": [
        "mlx-community/Qwen3-8B-4bit",
        "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit"
    ],
    "APPLE_SILICON_32GB": [
        "mlx-community/gpt-oss-20b-MXFP4-Q8",
        "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit",
        "mlx-community/Qwen3-8B-4bit"
    ],
    "APPLE_SILICON_64GB_PLUS": [
        "mlx-community/gpt-oss-20b-MXFP4-Q8",
        "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit",
        "mlx-community/Qwen3-8B-4bit"
    ]
}
```

### 실전 벤치마크: 30B 모델이 20B 모델에 밀려 탈락한 이유

처음 설계할 때는 32GB Mac에서 "파라미터가 가장 큰 모델이 당연히 제일 똑똑하겠지"라는 생각으로 `Qwen3-Coder-30B-A3B-Instruct-4bit`를 1순위로 고려했습니다. 

하지만 실제 Android 에뮬레이터와 빌드가 돌고 있는 실무 부하 환경에서 6종의 테스트 픽스처(Kotlin/Swift 구현, JUnit, 컴파일 에러, diff 리뷰, 이슈 트리아지)로 벤치마크를 돌린 결과는 충격적이었습니다.

| 모델 | Footprint | 토큰 생성 속도 | 스왑 메모리 변화 (Δ) | 품질 검증 결과 |
| :--- | :--- | :--- | :--- | :--- |
| **Qwen3-Coder-30B-A3B** | 18.0 GB | 40.3 tok/s | **+6.06 GB (스왑 폭증)** | ❌ Swift 컴파일 실패, 중복 루프, 오타 발생 |
| **gpt-oss-20b-MXFP4-Q8** | **12.0 GB** | **38.3 tok/s** | **-2.38 GB (안정)** | **✔ 6종 픽스처 전원 통과, 정밀 리뷰 성공** |
| **Qwen2.5-Coder-14B** | 11.0 GB | 18.1 tok/s | -1.74 GB | ✔ 통과했으나 속도가 20B의 절반 수준 |
| **Qwen3-8B-4bit** | **6.6 GB** | **31.7 tok/s** | -1.09 GB | △ 경량 8B로서 서브 폴백에 최적 |

30B 모델은 18GB에 달하는 메모리 점유로 인해 6GB가 넘는 스왑 스래싱(Swap Thrashing)을 일으켰고, 부하 상태에서 Swift 코드를 깨뜨리거나 동일한 bullet point를 반복 출력하는 퇴행 현상이 나타났습니다. 

반면 **`gpt-oss-20b-MXFP4-Q8`**는 12GB의 가벼운 메모리 점유율을 유지하면서도 초당 38.3토큰의 초고속 추론과 완벽한 코드 품질을 보여주어 당당히 32GB 프로파일의 **Preferred 1순위 모델**로 채택되었습니다.

### 초안용 모델의 핵심 튜닝: 불필요한 사유(Thinking) 끄기

최신 오픈 추론 모델들은 기본적으로 긴 사유(Thinking trace)를 출력합니다. 하지만 First-pass 초안이나 포맷팅 작업에서 수백 줄의 생각 과정을 거치면 지연 시간과 컨텍스트만 낭비됩니다.

따라서 `local-llm` 내부 템플릿 인자로 불필요한 추론을 강제 제한합니다:
- `Qwen3-8B`: `enable_thinking: False` (생각 과정 생략, 결과 직행)
- `gpt-oss-20b`: `reasoning_effort: "low"` (최소한의 추론만 수행)

---

## 4. 에이전트 CLI에서 실제로 부르는 방법

Claude Code, Codex CLI, Antigravity(agy)는 모델의 이름이나 IP를 직접 알 필요가 없습니다. 표준 유닉스 파이프와 셸 명령 하나로 소통합니다.

### 1) Git Diff 리뷰 초안 (토큰 절약의 핵심 지점)

PR을 올리기 전 수백 줄의 변경 사항을 클라우드에 통째로 보내면 입력 토큰 비용이 큽니다. 이를 로컬 모델에 파이프로 넘겨 1차 초안을 받습니다.

```bash
git diff origin/main | local-llm review
```

```text
[stderr] LOCAL_LLM: USED (UNTRUSTED DRAFT — gpt-oss-20b-MXFP4-Q8, 38.3 tok/s)
[stdout] 
- NativeAdSlot.kt: LinearLayout의 높이가 wrapContentHeight()로 되어 있어 세로 팽창 위험이 있습니다.
- NativeAdSlot.swift: cardStyle()의 16pt 패딩이 프레임과 중첩되어 높이 136pt 부풀려짐이 감지되었습니다.
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
| **단위 테스트 생성 대기 시간** | 12~18초 (네트워크 RTT) | 3~5초 (로컬 38.3 tok/s) | **3배 이상 단축** |
| **API 레이트 리밋 발생 횟수** | 주 4~6회 (작업 중단) | **0회 (Zero)** | 병목 해소 |
| **월 API 비용** | ~$180 | ~$22 | **약 88% 절감** |

---

## 6. 결론: 가장 비싼 모델을 가장 적재적소에 쓰는 기술

AI 코딩 어시스턴트의 시대에 개발자의 생산성은 "얼마나 비싼 모델을 쓰느냐"가 아니라 **"어떤 크기의 모델을 어느 작업에 배치하느냐"**에서 갈립니다.

- 고도의 통찰, 아키텍처 판단, 보안, 배포 결정은 가장 똑똑한 **클라우드 프론티어 모델**에게 맡기고,
- 반복적인 보일러플레이트, 로그 요약, 초안 작성은 책상 위의 **Apple Silicon Local LLM**에게 위임하세요.

Mac의 유휴 NPU와 통합 메모리를 깨우는 것만으로도, 지갑과 레이트 리밋에 구애받지 않는 무제한의 AI 페어 프로그래밍 환경을 구축할 수 있습니다.
