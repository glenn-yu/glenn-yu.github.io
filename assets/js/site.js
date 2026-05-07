/* glenn-yu.github.io — boot intro · cmd+k palette · easter eggs */
(function () {
  'use strict';

  var SITE_DATA = window.SITE_DATA || { pages: [], posts: [] };
  var BOOT_KEY = 'glenn:boot-seen';
  var THEME_KEY = 'glenn:theme';

  // ============================================================
  // 1. Console banner (easter egg)
  // ============================================================
  var banner =
    '\n' +
    '       .--.       \n' +
    '      |o_o |      \n' +
    '      |:_/ |      \n' +
    '     //   \\ \\     \n' +
    '    (|     | )    \n' +
    '   /\'\\_   _/`\\   \n' +
    '   \\___)=(___/    \n' +
    '\n' +
    '  Hi 👋  — github.com/glenn-yu/glenn-yu.github.io\n' +
    '  Press [Cmd/Ctrl + K] for the command palette.\n' +
    '  Try the Konami code: ↑ ↑ ↓ ↓ ← → ← → B A\n';
  try { console.log('%c' + banner, 'color:#3ddc84;font-family:monospace;line-height:1.3'); } catch (e) {}

  // ============================================================
  // 2. Logcat boot intro (first visit per session)
  // ============================================================
  function runBoot() {
    if (sessionStorage.getItem(BOOT_KEY) === '1') {
      document.documentElement.classList.remove('boot-pending');
      return;
    }
    var overlay = document.createElement('div');
    overlay.className = 'boot-overlay';
    overlay.innerHTML =
      '<div class="boot-screen">' +
        '<div class="boot-bar"><span class="boot-dot"></span><span class="boot-dot"></span><span class="boot-dot"></span><span class="boot-title">adb logcat -s glenn:*</span></div>' +
        '<pre class="boot-log" aria-live="polite"></pre>' +
        '<p class="boot-skip">[ click or press any key to skip ]</p>' +
      '</div>';
    document.body.appendChild(overlay);

    var logEl = overlay.querySelector('.boot-log');
    var pid = String(Math.floor(1000 + Math.random() * 9000));
    var theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    var lines = [
      ['D', 'init',      'glenn-yu.github.io booting...'],
      ['V', 'stack',     'kotlin · compose · react-native · spring · adtech'],
      ['I', 'theme',     'detect=' + theme],
      ['D', 'router',    'route=' + location.pathname],
      ['I', 'palette',   'press [Cmd/Ctrl + K] for quick nav'],
      ['V', 'render',    'mounting page...'],
      ['I', 'lifecycle', 'onResume() — welcome.']
    ];

    function pad(s, n) { while (s.length < n) s += ' '; return s.slice(0, n); }
    function ts() {
      var d = new Date();
      var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
             '.' + String(d.getMilliseconds() + 1000).slice(1);
    }

    var i = 0, killed = false;
    function step() {
      if (killed) return;
      if (i >= lines.length) { setTimeout(close, 380); return; }
      var l = lines[i++];
      logEl.textContent += ts() + '  ' + l[0] + '/' + pad(l[1], 10) + ' (' + pid + '): ' + l[2] + '\n';
      setTimeout(step, 80 + Math.random() * 90);
    }

    function close() {
      if (killed) return;
      killed = true;
      sessionStorage.setItem(BOOT_KEY, '1');
      overlay.classList.add('boot-fade');
      document.documentElement.classList.remove('boot-pending');
      setTimeout(function () { overlay.remove(); }, 320);
    }

    overlay.addEventListener('click', close);
    var onKey = function () { close(); document.removeEventListener('keydown', onKey, true); };
    document.addEventListener('keydown', onKey, true);

    // Reveal page after first frame so layout is ready behind overlay
    requestAnimationFrame(function () {
      document.documentElement.classList.remove('boot-pending');
      step();
    });
  }

  // ============================================================
  // 3. Cmd+K command palette
  // ============================================================
  var paletteApi = null;
  function buildPalette() {
    var overlay = document.createElement('div');
    overlay.className = 'palette-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">' +
        '<input type="text" class="palette-input" placeholder="페이지·글·명령 검색…" autocomplete="off" spellcheck="false" aria-label="Search">' +
        '<ul class="palette-list" role="listbox"></ul>' +
        '<div class="palette-hint"><span><kbd>↑</kbd><kbd>↓</kbd> 이동</span><span><kbd>↵</kbd> 선택</span><span><kbd>esc</kbd> 닫기</span></div>' +
      '</div>';
    document.body.appendChild(overlay);

    var input = overlay.querySelector('.palette-input');
    var list = overlay.querySelector('.palette-list');

    var commands = [].concat(
      (SITE_DATA.pages || []).map(function (p) {
        return { kind: 'page', title: p.title, sub: p.url, action: function () { location.href = p.url; } };
      }),
      (SITE_DATA.posts || []).map(function (p) {
        return { kind: 'post', title: p.title, sub: p.date, action: function () { location.href = p.url; } };
      }),
      [
        { kind: 'cmd', title: '🌗 테마 토글 (다크/라이트)', sub: 'theme', action: toggleTheme },
        { kind: 'cmd', title: '↗ GitHub 으로 이동', sub: 'github.com/glenn-yu', action: function () { window.open('https://github.com/glenn-yu', '_blank', 'noopener'); } },
        { kind: 'cmd', title: '✉️ 이메일 보내기', sub: 'nasmediagyyoo@gmail.com', action: function () { location.href = 'mailto:nasmediagyyoo@gmail.com'; } },
        { kind: 'cmd', title: '📡 RSS 구독', sub: '/feed.xml', action: function () { location.href = '/feed.xml'; } },
        { kind: 'cmd', title: '🟢 CRT 모드 (Konami 효과)', sub: 'easter egg', action: triggerCRT }
      ]
    );

    var filtered = commands.slice();
    var activeIdx = 0;

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
      });
    }
    function render() {
      if (!filtered.length) {
        list.innerHTML = '<li class="palette-empty">결과 없음</li>';
        return;
      }
      list.innerHTML = filtered.map(function (c, i) {
        return '<li class="palette-item ' + (i === activeIdx ? 'is-active' : '') + '" data-idx="' + i + '" role="option" aria-selected="' + (i === activeIdx) + '">' +
          '<span class="palette-kind palette-kind-' + c.kind + '">' + c.kind + '</span>' +
          '<span class="palette-title">' + escapeHtml(c.title) + '</span>' +
          '<span class="palette-sub">' + escapeHtml(c.sub || '') + '</span>' +
        '</li>';
      }).join('');
      var act = list.querySelector('.is-active');
      if (act) act.scrollIntoView({ block: 'nearest' });
    }
    function fuzzy(q, s) {
      q = q.toLowerCase(); s = s.toLowerCase();
      var i = 0, j = 0;
      while (i < q.length && j < s.length) {
        if (q[i] === s[j]) i++;
        j++;
      }
      return i === q.length;
    }
    function filter(q) {
      q = q.trim();
      if (!q) return commands.slice();
      return commands.filter(function (c) { return fuzzy(q, c.title + ' ' + (c.sub || '')); });
    }
    function open() {
      overlay.hidden = false;
      input.value = '';
      filtered = commands.slice();
      activeIdx = 0;
      render();
      requestAnimationFrame(function () { input.focus(); });
    }
    function close() { overlay.hidden = true; }

    input.addEventListener('input', function () {
      filtered = filter(input.value);
      activeIdx = 0;
      render();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, filtered.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); render(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        var sel = filtered[activeIdx];
        if (sel) { close(); sel.action(); }
      } else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    list.addEventListener('click', function (e) {
      var li = e.target.closest('.palette-item');
      if (!li) return;
      var sel = filtered[parseInt(li.dataset.idx, 10)];
      if (sel) { close(); sel.action(); }
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    return { open: open, close: close };
  }
  function getPalette() { return paletteApi || (paletteApi = buildPalette()); }

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      getPalette().open();
    }
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('.palette-trigger');
    if (t) { e.preventDefault(); getPalette().open(); }
  });

  // ============================================================
  // 4. Theme toggle
  // ============================================================
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
    var next;
    if (!cur) next = sysDark ? 'light' : 'dark';
    else next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    showToast('theme=' + next);
  }

  // ============================================================
  // 5. Konami code → CRT mode
  // ============================================================
  var KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  var konamiIdx = 0;
  document.addEventListener('keydown', function (e) {
    var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === KONAMI[konamiIdx]) {
      konamiIdx++;
      if (konamiIdx === KONAMI.length) { konamiIdx = 0; triggerCRT(); }
    } else {
      konamiIdx = (key === KONAMI[0]) ? 1 : 0;
    }
  });

  function triggerCRT() {
    document.body.classList.add('crt-mode');
    showToast('🟢 CRT MODE ENGAGED');
    setTimeout(function () { document.body.classList.remove('crt-mode'); }, 6000);
  }

  // ============================================================
  // 6. Toast
  // ============================================================
  function showToast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('toast-show'); });
    setTimeout(function () {
      t.classList.remove('toast-show');
      setTimeout(function () { t.remove(); }, 320);
    }, 2200);
  }

  // ============================================================
  // Boot
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runBoot);
  } else {
    runBoot();
  }
})();
