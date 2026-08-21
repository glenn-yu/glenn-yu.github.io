# glenn-yu.github.io

[https://glenn-yu.github.io](https://glenn-yu.github.io) — Glenn Yu 의 개인 사이트 / 블로그.

Jekyll + GitHub Pages 로 만들어졌습니다.

홈의 Mobile Apps 섹션은 HAMDAE Character/App Family 6개 앱을 실제 192px web export 아이콘으로 표시합니다. 스토어 미출시 앱은 존재하지 않는 링크를 만들지 않고 개발 중 상태만 노출합니다.

## 글 쓰기

`_posts/` 폴더에 `YYYY-MM-DD-title.md` 형식의 마크다운 파일을 추가하면 됩니다.

```yaml
---
title: "글 제목"
date: 2026-05-07 21:00:00 +0900
tags: [android, kotlin]
excerpt: "한 줄 요약"
---

본문 내용...
```

## 로컬에서 미리보기 (선택)

```bash
bundle install
bundle exec jekyll serve
# → http://localhost:4000
```

로컬 미리보기 없이 바로 `git push` 해도 GitHub Pages 가 자동으로 빌드합니다.

## 구조

```
.
├── _config.yml          # 사이트 설정
├── _includes/           # head, header, footer 부분
├── _layouts/            # default, post 레이아웃
├── _posts/              # 블로그 글 (마크다운)
├── assets/css/main.css  # 스타일
├── assets/projects/     # HAMDAE 앱 아이콘 web export
├── index.html           # 홈
└── about.md             # 소개 페이지
```
