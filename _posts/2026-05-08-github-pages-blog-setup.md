---
title: "GitHub Pages 로 개인 블로그 만들기 — 0 에서 giscus 까지"
date: 2026-05-08 14:00:00 +0900
tags: [github-pages, jekyll, blog, setup]
excerpt: "username.github.io 레포 한 줄 push 부터 logcat 부팅 인트로 · Cmd+K 팔레트 · giscus 댓글 · 커스텀 404 까지. 하루 만에 만든 개인 블로그 셋업 정리."
---

하루 동안 GitHub Pages 로 개인 블로그를 만들었습니다 — 지금 보고 계신 이 사이트입니다.
다음에 또 만들 일이 생길 것 같아서 과정을 기록해 둡니다.

> **결과물**: [glenn-yu.github.io](https://glenn-yu.github.io) — Jekyll · 로그캣 부팅 인트로 · ⌘K 팔레트 · 다크/라이트 · giscus 댓글 · 커스텀 404.
> **전체 코드**: [glenn-yu/glenn-yu.github.io](https://github.com/glenn-yu/glenn-yu.github.io)

## 왜 GitHub Pages 인가

선택지는 많습니다 — Vercel, Netlify, Cloudflare Pages 등.
그중 GitHub Pages 를 고른 이유는 단순합니다.

- **레포 = 사이트** — `username.github.io` 레포를 만들면 그게 그대로 사이트 URL.
- **Jekyll 자동 빌드** — 마크다운만 push 하면 GitHub 가 알아서 빌드. CI 설정 필요 없음.
- **무료 + HTTPS 자동**.
- **버전 관리가 곧 발행 이력** — `git log` 가 변경사항 기록.

단점이라면 "GitHub 화이트리스트된 Jekyll 플러그인만 쓸 수 있다" 정도. 일반 블로그로는 충분합니다.

## 5분 컷 — 한 줄로 사이트 띄우기

가장 빠른 코스부터 가봅시다.

1. GitHub 에서 새 레포: 이름은 정확히 `<본인-username>.github.io`, Public.
2. 클론하고 `index.html` 하나 만들어 push:

```bash
git clone https://github.com/<본인>/<본인>.github.io.git
cd <본인>.github.io
echo "<h1>Hello, world</h1>" > index.html
git add index.html
git commit -m "init"
git push origin main
```

3. 1~2분 후 `https://<본인>.github.io` 접속.

여기서 끝내도 됩니다. 정적 HTML/CSS/JS 만 잘 짜도 사이트 하나 만드는 데 충분해요.
하지만 글이 늘어나면 레이아웃·메타·목록 처리가 귀찮아지니, 다음 단계로 넘어갑니다.

## Jekyll 로 본격 블로그 만들기

블로그 운영에는 Jekyll 이 편합니다. 마크다운 파일을 추가하면 곧 글이 됩니다.

**최소 구성**:

```
.
├── _config.yml          # 사이트 설정
├── _layouts/
│   ├── default.html     # 모든 페이지 공통 레이아웃
│   └── post.html        # 블로그 글 레이아웃
├── _includes/
│   ├── head.html
│   ├── header.html
│   └── footer.html
├── _posts/
│   └── YYYY-MM-DD-제목.md
├── assets/css/main.css
├── index.html           # 홈
└── about.md             # 소개
```

**`_config.yml`** 예시:

```yaml
title: Glenn Yu
tagline: Mobile · Adtech Engineer
url: "https://glenn-yu.github.io"

author:
  name: Glenn Yu
  email: gwangy.yu@gmail.com
  github: glenn-yu

markdown: kramdown
permalink: /posts/:title/
timezone: Asia/Seoul

plugins:
  - jekyll-feed
  - jekyll-sitemap
```

**Gemfile** (로컬 미리보기 안 할 거면 없어도 됨):

```ruby
source "https://rubygems.org"
gem "github-pages", group: :jekyll_plugins
group :jekyll_plugins do
  gem "jekyll-feed"
  gem "jekyll-sitemap"
end
```

**글 한 편** (`_posts/2026-05-08-hello.md`):

{% raw %}
```markdown
---
title: "안녕하세요"
date: 2026-05-08 14:00:00 +0900
tags: [intro]
---

본문...
```
{% endraw %}

push 하면 `/posts/안녕하세요/` 로 자동 발행됩니다.

## 한국어 친화 셋업

기본 시스템 폰트로도 작동하지만, 한국어 가독성에 진심이라면 [Pretendard](https://github.com/orioncactus/pretendard) 추천입니다.
CDN 한 줄로 끝납니다.

```html
<link rel="stylesheet"
      href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css">
```

CSS 폰트 스택:

```css
:root {
  --font-sans: "Pretendard Variable", Pretendard, -apple-system,
               BlinkMacSystemFont, "Apple SD Gothic Neo",
               "Segoe UI", Roboto, sans-serif;
}
body { font-family: var(--font-sans); }
```

## 다크/라이트 자동 + 수동 토글

`prefers-color-scheme` 미디어 쿼리만 쓰면 시스템 설정에 따라 자동 전환됩니다.

```css
:root { --bg: #ffffff; --fg: #111418; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0e1116; --fg: #e6edf3; }
}
```

수동 토글까지 원하면 `data-theme` 속성으로 오버라이드를 추가합니다.

```css
:root[data-theme="light"] { --bg: #ffffff; }
:root[data-theme="dark"]  { --bg: #0e1116; }
```

JS 로 토글하면서 `localStorage` 에 저장하면 페이지 이동에도 유지됩니다.

```js
function toggleTheme() {
  var cur = document.documentElement.getAttribute('data-theme');
  var next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}
```

페인트 깜빡임을 막으려면 `<head>` 에서 동기 스크립트로 미리 적용해 두세요.

## 색다른 한 끗 — 로그캣 부팅 인트로

여기부터는 취향 영역입니다.
저는 안드로이드 개발자 정체성을 살리고 싶어서, 사이트 첫 진입 시 `adb logcat` 같은 텍스트가 흐르는 인트로를 넣었습니다.

핵심 아이디어:

- `sessionStorage` 로 **세션당 1회만** 표시
- 클릭 / 키 입력으로 즉시 skip
- 텍스트는 한 줄씩 `setTimeout` 으로 출력
- 페이지 본문은 `boot-pending` 클래스로 잠시 숨김 → 인트로 끝나면 해제

요지만 옮기면:

```js
function runBoot() {
  if (sessionStorage.getItem('boot-seen') === '1') return;
  // overlay 생성, 줄 단위로 setTimeout 출력
  // 끝나면 sessionStorage.setItem('boot-seen', '1')
}
```

[전체 구현 보기](https://github.com/glenn-yu/glenn-yu.github.io/blob/main/assets/js/site.js).

## ⌘K 커맨드 팔레트

Linear / VSCode 의 그 팔레트입니다. `Cmd+K` 누르면 페이지·글·명령을 한 번에 검색.

페이지·글 데이터는 `_layouts/default.html` 에서 Liquid 로 주입합니다:

{% raw %}
```html
<script>
window.SITE_DATA = {
  pages: [
    { title: "Home",  url: "{{ '/' | relative_url }}" },
    { title: "About", url: "{{ '/about/' | relative_url }}" }
  ],
  posts: [
    {%- for p in site.posts -%}
      { title: {{ p.title | jsonify }},
        url: {{ p.url | relative_url | jsonify }} }
      {%- unless forloop.last -%},{%- endunless -%}
    {%- endfor -%}
  ]
};
</script>
```
{% endraw %}

JS 쪽에서는 `Cmd+K` 핸들링 + 간단한 퍼지 매칭 + 화살표 키 네비게이션만 있으면 됩니다.

## SEO · 공유 기본 — 파비콘 + OG 이미지

여기는 건너뛰면 안 됩니다.
카카오톡·슬랙·트위터 어디든 링크 미리보기가 안 뜨면 사이트가 빈약해 보여요.

**파비콘** (SVG 추천 — 모던 브라우저 모두 지원):

```html
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="icon" type="image/png" sizes="64x64" href="/assets/favicon.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
```

**Open Graph / Twitter Card 메타**:

{% raw %}
```html
<meta property="og:type" content="website">
<meta property="og:title" content="{{ site.title }}">
<meta property="og:description" content="{{ site.description }}">
<meta property="og:image" content="{{ '/assets/og-image.png' | absolute_url }}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{{ '/assets/og-image.png' | absolute_url }}">
```
{% endraw %}

OG 이미지는 1200×630 권장이지만 1200×1200 도 대부분 플랫폼이 받아줍니다.
디자이너 없으면 SVG 로 직접 그리고 macOS 의 `qlmanage` 로 PNG 변환 가능:

```bash
qlmanage -t -s 1200 -o . og-image.svg
mv og-image.svg.png og-image.png
```

## 포스트 UX 폴리시

**읽기 시간** — kramdown 의 `size` 필터로 글자 수 세고 분 단위 환산. 한국어 기준 ~500자/분:

{% raw %}
```liquid
{%- assign chars = content | strip_html | size -%}
{%- assign rt = chars | divided_by: 500 | plus: 1 -%}
📖 {{ rt }}분 읽기
```
{% endraw %}

**코드 복사 버튼** — `<pre>` 마다 버튼 주입:

```js
document.querySelectorAll('.post-content pre').forEach(function (pre) {
  var btn = document.createElement('button');
  btn.textContent = 'Copy';
  btn.onclick = function () {
    var code = (pre.querySelector('code') || pre).textContent;
    navigator.clipboard.writeText(code);
    btn.textContent = 'Copied!';
    setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
  };
  pre.appendChild(btn);
});
```

**헤딩 앵커** — kramdown 은 `auto_ids` 가 기본 활성이라 `h2` / `h3` 에 자동으로 `id` 가 붙습니다.
JS 로 호버 시 보이는 `#` 링크만 추가하면 됩니다.

```js
document.querySelectorAll('.post-content h2[id], .post-content h3[id]')
  .forEach(function (h) {
    var a = document.createElement('a');
    a.className = 'heading-anchor';
    a.href = '#' + h.id;
    a.textContent = '#';
    h.appendChild(a);
  });
```

## giscus 댓글

Disqus 대신 GitHub Discussions 기반 [giscus](https://giscus.app) 를 썼습니다.
광고 없고, 댓글이 곧 디스커션이라 통계 보기도 편합니다.

**셋업 순서**:

1. 레포에 Discussions 활성화:
   ```bash
   gh api -X PATCH repos/<유저>/<레포> -f has_discussions=true
   ```
2. [github.com/apps/giscus](https://github.com/apps/giscus) 에서 giscus 앱을 레포에 설치.
3. [giscus.app](https://giscus.app) 에서 설정 후 스크립트 카피.

**스크립트** (`_includes/giscus.html` 같은 곳에 두고 post 레이아웃에서 include):

```html
<script src="https://giscus.app/client.js"
        data-repo="<유저>/<레포>"
        data-repo-id="..."
        data-category="Announcements"
        data-category-id="..."
        data-mapping="pathname"
        data-theme="preferred_color_scheme"
        data-lang="ko"
        crossorigin="anonymous"
        async>
</script>
```

수동 테마 토글이 있으면 giscus iframe 한테도 알려줘야 합니다:

```js
iframe.contentWindow.postMessage(
  { giscus: { setConfig: { theme: 'dark' } } },
  'https://giscus.app'
);
```

## 404 페이지에도 정체성을

`/404.html` 만들어 두면 GitHub Pages 가 안 잡히는 경로마다 자동으로 띄워줍니다.
저는 안드로이드 크래시 화면 미러링한 logcat 스타일로 만들었습니다.

```
FATAL EXCEPTION: main
Process: io.glenn.site, PID: 404
com.gwangy.site.RouteNotFoundException: no route matched "/asdf"
    at com.gwangy.site.Router.resolve(Router.kt:42)
    ...
```

JS 로 잘못 입력된 경로를 동적으로 박아 넣어서 어디서 길을 잃었는지 보여줍니다.

```js
document.getElementById('bad-path').textContent
  = '"' + (location.pathname + location.search).slice(0, 80) + '"';
```

## 정리하며

하루 만에 만든 셋업이지만 글 쓸 환경으로는 충분합니다.
정리하면 이렇습니다.

**필수**

- `username.github.io` 레포 + `index.html`
- Jekyll layouts / includes / posts
- 다크 · 라이트 + 한국어 폰트
- 파비콘 + OG 이미지

**있으면 좋은**

- 정체성을 드러내는 한 끗 (부팅 인트로 같은)
- ⌘K 팔레트
- 읽기 시간 + 코드 복사 + 헤딩 앵커
- giscus 댓글
- 커스텀 404

다음은 사이트를 만지는 게 아니라 **글을 쓰는 것**입니다.
만든 도구를 실제로 쓰면서 부족한 부분을 발견하는 게 다음 사이클이에요.

---

읽어주셔서 감사합니다.
질문 / 제보 / 잘못된 부분은 아래 댓글이나 [이슈](https://github.com/glenn-yu/glenn-yu.github.io/issues) 로 부탁드립니다 🙇‍♂️
