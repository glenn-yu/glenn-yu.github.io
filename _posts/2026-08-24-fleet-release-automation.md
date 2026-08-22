---
layout: post
title: "앱 6개 릴리스를 CLI 하나로: 자동화의 경계를 코드로 못 박기"
date: 2026-08-24 11:00:00 +0900
categories: [DevOps, Android, iOS]
tags: [ReleaseAutomation, CICD, Android, iOS, CodeSigning, GooglePlay, AppStoreConnect, Gradle, Xcode, Mobile]
---

앱이 하나일 때는 릴리스가 "귀찮은 일"입니다. 여섯 개가 되면 **위험한 일**이 됩니다.

버전을 올리고, 서명하고, 빌드하고, 아카이브하고, 스토어에 올리는 절차가 앱마다 조금씩 다른데, 그 "조금씩"이 머릿속에만 있기 때문입니다. 어제 A 앱에서 통했던 손버릇이 오늘 B 앱에서는 조용히 잘못된 결과를 만듭니다.

이 글은 여섯 개 앱의 릴리스를 CLI 하나로 묶으면서, **자동화하면 안 되는 것을 코드로 못 박는 과정**의 기록입니다. 결과물보다는 그 과정에서 "믿고 있었는데 사실이 아니었던 것"들이 더 흥미로웠습니다.

---

## 1. 목표: 버튼 직전까지만 자동화한다

가장 먼저 정한 것은 기능 목록이 아니라 **경계**였습니다.

```text
 자동                                           │  사람
───────────────────────────────────────────────┼──────────────────────
 점검 → 테스트 → Lint → Release Build          │  Play "출시 시작"
 → AAB → iOS Archive → IPA Export               │  Apple "심사 제출"
 → 스토어 업로드 → 상태 조회 → 준비 완료 판정   │  Apple "이 버전 출시"
```

업로드까지는 되돌릴 수 있습니다. 트랙에서 내리거나 새 빌드로 덮으면 됩니다. 하지만 **프로덕션 공개와 심사 제출은 되돌리는 데 대가가 큽니다.** 심사를 취소하면 큐의 맨 뒤로 돌아가고, 롤아웃된 버전은 이미 사용자 기기에 내려가 있습니다.

문제는 이 경계를 **주석으로만 두면 다음 사람이 넘는다**는 것입니다. "API로 되네?" 한마디면 끝입니다. 그래서 두 층으로 만들었습니다.

```python
def guard_play(method, url, body):
    if method in ('GET', 'HEAD'):
        return
    payload = json.loads(body) if body else {}

    def walk(o):
        """중첩 어디에 있든 찾는다. 최상위만 보면 releases[] 안을 놓친다."""
        if isinstance(o, dict):
            for k, v in o.items():
                if k == 'userFraction':
                    raise Blocked('staged rollout 비율은 콘솔에서 사람이 정한다')
                if k == 'status' and v in ('inProgress', 'halted'):
                    raise Blocked(f'진행 중 rollout({v})은 자동화하지 않는다')
                walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(payload)

    if '/tracks/' in url:
        track = url.split('/tracks/')[1].split('?')[0]
        if track in ('internal', 'alpha', 'beta'):
            return
        if track == 'production':
            for rel in payload.get('releases', []):
                if rel.get('status') != 'draft':
                    raise Blocked('production 은 draft 만 허용한다')
            return
        raise Blocked(f'허용 목록에 없는 트랙: {track}')
```

핵심은 세 가지입니다.

- **HTTP를 보내는 지점에 둔다.** 이름 기반 차단은 우회됩니다. 실제로 소켓을 막아놓고 테스트해서, 네트워크에 나가기 **전에** 걸리는 것을 확인했습니다.
- **중첩을 재귀로 훑는다.** `userFraction`을 최상위에서만 찾으면 `releases[0].userFraction`을 놓칩니다.
- **끄는 스위치를 만들지 않는다.** 플래그로 끌 수 있으면 보호막이 아닙니다.

여기에 더해 **서비스 계정 권한 자체에서 "프로덕션 출시 관리"를 빼두었습니다.** 코드가 뚫려도 계정 수준에서 불가능하게 만드는 이중 방어입니다.

최종적으로 차단 15건 / 정상 통과 5건으로 회귀 테스트를 돌립니다. 여기서 중요한 건 **정상 통과 5건**입니다. 과차단은 조용히 도구를 쓸모없게 만들거든요.

---

## 2. 첫 번째 거짓말: "파일명이 서명을 증명한다"

함대 표준 문서에 이런 문장이 있었습니다.

> 산출물은 `app-release-unsigned.apk`(서명 안 됨) 아니면 `app-release.apk`/`.aab`(서명 됨) 둘 중 하나로 **파일명 자체가 결과를 증명한다.**

그래서 처음엔 파일명으로 판정하는 코드를 짰습니다. 서명 키가 없는 상태로 빌드를 돌려보니 이렇게 나왔습니다.

```text
✅ AAB(signed) 10M — app-release.aab
```

**키가 없는데 "서명됨"이라고 합니다.** 확인해봤습니다.

```console
$ jarsigner -verify app/build/outputs/bundle/release/app-release.aab

no manifest.
jar is unsigned.
```

`-unsigned` 접미사는 **APK 전용 규약**이었습니다. AGP는 서명되지 않은 AAB도 그냥 `app-release.aab`로 냅니다. 문서의 문장은 APK에 대해서는 참이고 AAB에 대해서는 거짓이었는데, 한 문장 안에 `.aab`가 같이 적혀 있어서 아무도 눈치채지 못한 상태였습니다.

파일명 대신 실제로 확인하도록 고쳤습니다.

```bash
aab_is_signed() {
  # AAB 는 JAR 서명(v1) 규약을 쓴다. apksigner 는 AAB 를 읽지 못한다.
  jarsigner -verify "$1" 2>&1 | grep -q 'jar verified'
}
```

그리고 **양방향으로 증명**했습니다. 폐기용 키를 만들어 서명된 케이스도 확인하고, 확인이 끝나자마자 그 키와 산출물을 지웠습니다. 통과만 확인하면 검증이 아니라 우연입니다.

---

## 3. 두 번째 거짓말: 빌드는 성공했는데 앱이 죽는다

앱 두 개에는 런타임 무결성 검사가 있었습니다. 실행 시 자기 APK의 서명 SHA-256을 `BuildConfig` 상수와 대조하고, 다르면 UI가 뜨기 전에 앱을 종료합니다. 리패키징 방어용입니다.

이 값은 로컬 설정 파일에서 주입되는데, **그 파일은 버전 관리되지 않습니다.** 그래서 값이 없는 PC에서 빌드하면 기대값이 빈 문자열이 되고 —

```text
기대값 "" ≠ 실제 서명 → SIGNATURE_CONFIG_MISSING → finishAndRemoveTask()
```

— **정식 배포본이 모든 기기에서 켜자마자 종료됩니다.** 이 팀은 이미 한 번 겪었습니다. 값이 없는 PC에서 빌드한 버전이 그대로 스토어에 올라갔고, 전 사용자 기기에서 앱이 죽었습니다.

무서운 건 **빌드가 성공한다**는 점입니다. 산출물만 보면 정상과 구분되지 않습니다. 업로드도 됩니다. 사용자가 열어야 드러납니다.

그래서 이 검사를 진단 명령이 아니라 **빌드 경로**에 넣었습니다.

```bash
android_build() {
  # 빌드 전에 막는다. 빌드 후에 경고해 봐야
  # 이미 업로드 가능한 산출물이 디스크에 있다.
  if sgkey="$(securitygate_key_for "$APP_SLUG")"; then
    if ! printf '%s' "$norm" | grep -qE '^[0-9A-F]{64}$'; then
      fail "release 빌드 중단 — $sgkey 가 비었거나 형식이 틀렸다"
      return 1
    fi
  fi
  ...
}
```

한 걸음 더 나아가, **값이 형식은 맞는데 틀린 키인 경우**도 잡습니다.

---

## 4. Upload Key ≠ App Signing Key

Play App Signing을 쓰면 키가 두 개입니다.

| 키 | 보관 | 역할 |
|---|---|---|
| **App Signing Key** | Google | 사용자 기기에 설치되는 최종 서명 |
| **Upload Key** | 개발자 | 스토어에 올릴 때만 쓰는 키 |

Play는 업로드된 AAB를 **App Signing Key로 재서명**합니다. 즉 기기에 설치된 APK의 서명은 upload key가 **아닙니다.**

그러니 §3의 무결성 검사에 upload key 지문을 넣으면? 형식은 완벽하고, 빌드도 되고, 업로드도 되고, **모든 기기에서 앱이 죽습니다.**

이건 자동으로 검사할 수 있습니다.

```bash
# 등록된 keystore 의 인증서와 무결성 검사 기대값이 같으면 그건 언제나 오류다
securitygate_vs_upload_key() {
  upload="$(keystore_cert_sha256)" || return 2   # 대조 불가
  [ "$1" = "$upload" ] && return 0                # 일치 = 위험
  return 1                                        # 불일치 = 정상
}
```

조건을 실제로 만들어서 차단되는 것을 확인했습니다. 빌드가 멈추고 산출물이 생기지 않습니다.

---

## 5. 증거 등급: "아마 이 키일 것"을 금지하기

키를 등록하려는데, 어느 키가 어느 앱 것인지 확실하지 않았습니다. 정황은 있었습니다 — 홈 디렉터리에 keystore 두 개, 세 앱의 서명된 산출물이 동일한 인증서, IDE가 기억하는 경로 하나.

여기서 "아마 이거겠지"로 등록하면 **틀렸을 때 업로드가 영구히 거부됩니다.** 그래서 판정을 다섯 단계로 나누고 승격 조건을 코드에 고정했습니다.

| 등급 | 조건 |
|---|---|
| `CONFIRMED` | 등록된 keystore 인증서 SHA-256 **== 기존 release artifact 인증서** |
| `LIKELY` | 강한 정황은 있으나 지문 대조 불가 |
| `UNKNOWN` | 근거 부족 |
| `MISMATCH` | 인증서가 기존 artifact와 다름 → 등록 차단 |
| `NOT CONFIGURED` | 첫 출시 전 |

**정황을 CONFIRMED로 올리는 코드 경로를 만들지 않았습니다.** IDE 기록이 있어도 지문을 대조하기 전까지는 LIKELY입니다.

대조는 이렇게 합니다. 기존 서명본에서 인증서를 뽑고, keystore의 인증서와 비교합니다.

```bash
# 기존 서명본에서 인증서 지문 추출
unzip -oq "$aab" -d "$tmp" 'META-INF/*'
cert="$(find "$tmp/META-INF" -name '*.RSA' -o -name '*.EC' | head -1)"
openssl pkcs7 -inform DER -in "$cert" -print_certs \
  | openssl x509 -noout -fingerprint -sha256
```

그리고 **비밀번호는 인자로 받지 않습니다.**

```bash
$ ./fleet keystore-info ~/some.jks --password hunter2
fleet: 비밀번호를 인자로 받지 않는다 — shell history/ps/log 에 남는다.
```

`keytool`도 `-storepass`를 명령행에 두면 `ps`에 노출되므로, 프롬프트로 받아 stdin으로 넘깁니다.

> 참고로 `keytool`에는 `-storepass:stdin`이 **없습니다.** 그건 `apksigner` 문법입니다. 잘못 쓰면 `ArrayIndexOutOfBoundsException`이 나는데, 이게 "비밀번호 틀림"으로 오진되어 한참 헤맸습니다. `-storepass`를 생략하면 프롬프트를 띄우고 stdin에서 읽습니다.

결과적으로 등록 시점에도 지문을 다시 대조하고, 어긋나면 배치한 파일을 되돌립니다.

```text
❌ SIGNING KEY MISMATCH

  Expected (기존 서명본)  A5...
  Provided (이 keystore)  C4...

  이 키로 서명하면 Play 가 upload key 불일치로 업로드를 거부한다.
  Registration aborted.
```

강제 override는 만들지 않았습니다.

---

## 6. 시크릿을 어디에 둘 것인가

파일 시크릿과 문자열 시크릿을 다르게 다뤘습니다.

| 종류 | 보관 | 이유 |
|---|---|---|
| 서비스 계정 JSON, `.p8`, keystore | `~/.fleet/` (0600) | 도구가 **파일 경로**를 요구한다. Keychain에 넣어도 결국 임시 파일로 꺼내야 하고 그게 새 유출 지점이 된다 |
| keystore 비밀번호 | **macOS Keychain** | 되돌릴 수 없는 값인데 평문 파일 하나에만 두면 그 파일이 지워지는 순간 앱을 영영 업데이트할 수 없다 |
| Key ID, Issuer ID | 설정 파일 | 시크릿이 아니라 식별자 |

문제는 Gradle이 Keychain을 읽지 못한다는 점입니다. 그래서 역할을 나눴습니다.

```text
macOS Keychain        원본(source of truth)
keystore.properties   Keychain 에서 생성한 0600 파생물 (gitignored)
```

앱의 `build.gradle.kts`는 건드리지 않았습니다. 릴리스 자동화를 이유로 앱 코드를 고치기 시작하면 끝이 없습니다.

---

## 7. 업로드 전에 잡아야 할 것들

여기까지 만들고 나니, 정작 업로드 단계에서 튕기는 것들이 보였습니다.

**버전 재사용.** Play는 같은 `versionCode`를, App Store Connect는 같은 build 번호를 거부합니다. 로컬 값이 스토어 최신값 이하면 업로드에서 튕기는데, **그때는 이미 Archive와 Export를 다 돌린 뒤**입니다. 수십 분이 날아갑니다.

그래서 빌드 전에 스토어에 물어봅니다.

```text
❌ ASC build 15 은 스토어(15) 이하 — 업로드가 거부된다
   CURRENT_PROJECT_VERSION 을 16 이상으로 올린다 (재사용 불가)
```

조회는 읽기 전용입니다. Play 쪽은 edit을 만들어 조회한 뒤 **commit 없이 폐기**하므로 스토어 상태가 변하지 않습니다.

**낡은 프로비저닝 프로파일.** 새 배포 인증서를 만들어도 기존 프로파일은 갱신되지 않습니다. 프로파일은 발급 시점의 인증서 목록을 담기 때문입니다. 인증서를 깔았는데도 이렇게 막힙니다.

```text
error: exportArchive Provisioning profile "..." doesn't include
signing certificate "Apple Distribution: ...".
```

`-allowProvisioningUpdates`로 xcodebuild가 갱신하게 하면 되는데, 여기서 한 번 더 걸렸습니다. API 키로 인증을 넘겼더니 `Cloud signing permission error`가 났습니다. **App Manager 역할에는 클라우드 서명 권한이 없습니다.** 개발 머신에서는 Xcode 계정 세션이 권한이 더 넓어서, 기본값을 그쪽으로 두고 헤드리스용으로만 키 인증을 옵션으로 남겼습니다.

**진단 메시지의 해상도.** 처음엔 403을 전부 "권한 없음"으로 보고했습니다. 그런데 원인이 셋이고 해야 할 일이 완전히 다릅니다.

| 증상 | 원인 | 할 일 |
|---|---|---|
| `API has not been used in project` | API 미활성 | Cloud Console에서 사용 설정 |
| `403 Forbidden` | 계정 권한 없음 | 콘솔에서 초대/권한 |
| `404 Package not found` | 앱 미생성 | 첫 출시는 사람이 콘솔에서 |

뭉뚱그리면 사용자가 엉뚱한 곳만 들여다봅니다. 실제로 API가 꺼져 있는 상태를 "권한 문제"로 보고해서 한참 권한 설정만 확인했습니다.

---

## 8. 조용히 이기고 있던 사본

원본 자격증명을 백업 삼아 `_original-...json`이라는 이름으로 같이 뒀습니다. 그리고 키를 찾는 코드는 이랬습니다.

```python
hits = sorted(glob.glob(os.path.join(d, '*.json')))
return hits[0] if hits else None
```

밑줄이 알파벳순으로 앞섭니다. **백업본이 정본을 이기고 있었습니다.**

지금은 내용이 같아서 아무 일도 없습니다. 하지만 나중에 키를 교체하면서 정본만 덮어쓰면, 낡은 백업본이 조용히 선택됩니다. 그리고 그건 "인증은 되는데 권한이 이상한" 형태로 나타나서 원인을 찾기 어렵습니다.

같은 개인키를 두 벌 두는 것은 백업이 아니라 **유출 표면 두 배**이기도 합니다. 중복을 없애고, 규약 파일명을 먼저 보도록 고쳤습니다.

```python
canonical = os.path.join(d, 'service-account.json')
if os.path.exists(canonical):
    return canonical
```

---

## 9. 결과

```console
$ ./fleet doctor

Environment
  Xcode / JDK 17·21 / xcodegen / altool / openssl   ✅
Google Play
  Service Account · API Authentication · Upload Permission   ✅
App Store Connect
  API Key · Key ID · Issuer ID · API Authentication          ✅
Apple Signing
  Development · Distribution · Provisioning · Team ID        ✅
Android Signing (upload key)
  5개 앱  ✅ CONFIRMED   (지문 실대조)
  1개 앱  ➖ NOT CONFIGURED (첫 출시 전)
Runtime SecurityGate
  2개 앱  ✅ upload key 와 다름 (정상)
```

한 앱은 실제로 전 구간을 완주했습니다. 서명된 AAB → Play 업로드, Archive → IPA → TestFlight까지. 그리고 거기서 멈춥니다.

```text
NEXT — 사람이 직접 수행
  Play Console → 릴리스 → 프로덕션 → 릴리스 검토 → "출시 시작"
  App Store Connect → App Store → 빌드 선택 → "심사 제출"

  이 CLI 는 위 두 버튼을 누르지 않는다.
```

---

## 10. 남은 생각

가장 시간을 많이 쓴 건 CLI를 만드는 일이 아니었습니다. **"알고 있다고 믿었던 것"을 실제로 확인하는 일**이었습니다.

- 파일명이 서명을 증명한다 → APK만 그렇다
- 표준 문서에 적혀 있다 → 문서도 틀린다
- IDE가 기억하는 경로니까 그 키다 → 지문을 대조하기 전엔 모른다
- 인증서를 깔았으니 서명된다 → 프로파일은 따로 갱신해야 한다
- 403은 권한 문제다 → 세 가지 원인이 있다

도구가 좋아진 지점도 대부분 여기서 나왔습니다. 통과를 확인한 게 아니라 **실패를 만들어봤을 때** 구멍이 보였습니다. 가드를 만들었으면 뚫으려고 해보고, 검사를 만들었으면 걸리는 조건을 만들어봐야 합니다. 통과만 확인한 검증은 검증이 아니라 우연입니다.

그리고 하나 더. 자동화 범위를 정할 때 "할 수 있는가"보다 **"되돌릴 수 있는가"**를 기준으로 삼은 게 결과적으로 가장 잘한 선택이었습니다. API로 프로덕션 롤아웃을 시작하는 건 기술적으로 어렵지 않습니다. 다만 잘못됐을 때 되돌릴 방법이 없을 뿐입니다.

마지막 버튼은 사람이 누르는 게 맞습니다.
