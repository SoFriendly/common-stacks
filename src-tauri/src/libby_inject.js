// Injected into the Libby webview before every page load. Four jobs:
//   1. Retheme libbyapp.com onto the Common Stacks palette (styles.css).
//      Libby themes via :root HSL variable families (--c-h-* / --c-s-* /
//      --c-l-* plus composed --c-hsla-*), so remapping those restyles the
//      whole app without touching minified class names.
//   2. Report the book currently on screen to Rust (title/author/cover) so
//      downloads get named and decorated properly.
//   3. Auto-advance the borrow -> "Read With..." -> EPUB export flow so one
//      Borrow click ends in a file on the shelf.
//   4. Render the download-confirmation modal (Rust calls __csLibbyModal).
// Keep the palette in sync with @theme in src/styles.css.
(function () {
  if (window.__csLibby) return;
  window.__csLibby = true;

  // Force Libby's auto lighting to "light" regardless of the OS appearance:
  // its dark mode swaps dozens of derived variable families to near-black,
  // far more than the palette below overrides. This runs before Libby's boot
  // code, and window-level patches survive its document replacement.
  var origMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = function (query) {
    if (typeof query === "string" && query.indexOf("prefers-color-scheme") !== -1) {
      var wantsDark = query.indexOf("dark") !== -1;
      return origMatchMedia(wantsDark ? "not all" : "all");
    }
    return origMatchMedia(query);
  };

  // One Libby color family: component vars + the composed hsla var. Libby's
  // alpha variants recompose from the h/s/l components, so both forms matter.
  // !important on every declaration: Libby's boot loader re-inserts its
  // stylesheet after ours, and its dark theme overrides these vars via class
  // selectors — importance beats both without fighting order or specificity.
  function family(name, h, s, l) {
    return (
      "--c-h-" + name + ":" + h + " !important;" +
      "--c-s-" + name + ":" + s + "% !important;" +
      "--c-l-" + name + ":" + l + "% !important;" +
      "--c-hsla-" + name + ":hsl(" + h + ", " + s + "%, " + l + "%) !important;"
    );
  }

  var vars = [
    // Text: ink (#1a1814) with softer tones stepping toward ink-soft.
    family("fg", 40, 13, 9),
    family("fg-tone-1", 37, 10, 27),
    family("fg-tone-2", 37, 9, 36),
    family("fg-tone-3", 37, 7, 48),
    // Surfaces: paper (#faf7f2) at the top, stepping through shelf (#efe9df)
    // down to spine (#c7b89c) — same lightness ladder Libby uses, warmed.
    family("bg", 37.5, 44, 96.5),
    family("bg-tone-1", 37.5, 40, 95),
    family("bg-tone-2", 37.5, 36, 94),
    family("bg-tone-3", 37.5, 33, 91),
    family("bg-tone-4", 38, 30, 88),
    family("bg-tone-5", 38, 29, 85),
    family("bg-tone-6", 38, 28, 81),
    family("bg-tone-7", 39, 28, 78),
    family("bg-tone-8", 39, 28, 75),
    family("bg-tone-9", 39, 28, 70),
    family("bg-tone-10", 39, 26, 64),
    // Hairlines.
    family("line-tone-1", 37.5, 25, 92),
    family("line-tone-2", 37.5, 25, 88),
    // Libby brand colors -> accent (#8a5a2b). Wine/plum/turquoise all derive
    // from the brand-* families, so overriding these recolors links, buttons,
    // and highlights in one place; pop, halo, fields, and footer derive from
    // these in turn via var()/calc() and follow automatically.
    family("brand-wine", 29.7, 55, 25),
    family("brand-plum", 29.7, 52.5, 35.5),
    family("brand-turquoise", 29.7, 52.5, 35.5),
    // Remaining families with literal (non-derived) cool-gray or brand values,
    // warmed onto the same ladder. Lightness is kept from Libby's originals so
    // their contrast relationships hold.
    family("interview-speech", 38, 30, 95.7), // chat bubbles on the welcome flow
    family("interview-answer-line", 29.7, 30, 88),
    family("app-notice-fg", 38, 25, 93),
    family("field-active-bg", 37.5, 44, 98),
    family("filter-applied-bg", 29.7, 35, 45),
    family("filter-applied-fg", 38, 30, 96),
    family("filter-applied-icon", 38, 25, 89.6),
    family("map-bg", 38, 15, 81.4),
    family("map-fg", 38, 12, 61),
    // Left alone on purpose: white/black (true monochrome uses), danger &
    // field-danger (error red), yellow/orange/tag-*/subjects-* (already warm,
    // harmonize with the accent), lucky-day (semantic green), library-*
    // (each library's own brand color, set inline by Libby).
  ].join("");

  var CSS = [
    ":root{" + vars + "color-scheme: light !important;}",
    "html, body { background: #faf7f2 !important; }",
    // Boot splash: the pre-app loading screen paints its "wall" with a huge
    // border and a porthole box-shadow, black under prefers-color-scheme:
    // dark. Retint to paper so launch doesn't flash a foreign color.
    ".splash .wall { border-color: #faf7f2 !important; }",
    ".splash .porthole { box-shadow: 0 0 0 500px #faf7f2 !important; }",
    // Libby nags to install its native app; pointless inside Common Stacks.
    '[class*="smart-banner"], [class*="app-banner"], [class*="install-app"] { display: none !important; }',
    "::-webkit-scrollbar { width: 10px; height: 10px; }",
    "::-webkit-scrollbar-thumb { background: rgba(26, 24, 20, 0.18); border-radius: 5px; }",
    "::-webkit-scrollbar-track { background: transparent; }",
  ].join("\n");

  function apply() {
    var style = document.getElementById("cs-libby-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "cs-libby-style";
      style.textContent = CSS;
    }
    var parent = document.head || document.documentElement;
    if (!parent) return;
    // Stay last in <head> so our :root block wins the cascade tie against
    // Libby's own :root definitions.
    if (style !== parent.lastElementChild) parent.appendChild(style);
  }

  // Libby's boot loader replaces the whole document after this script runs,
  // which discards the injected style AND orphans any observer bound to the
  // original document element. Window-level timers survive the replacement,
  // so a heartbeat re-asserts the style and re-binds the observer whenever
  // documentElement changes identity.
  var observed = null;
  var observer = null;
  function ensure() {
    try {
      var docEl = document.documentElement;
      if (!docEl) return;
      if (docEl !== observed) {
        observed = docEl;
        if (observer) observer.disconnect();
        observer = new MutationObserver(apply);
        observer.observe(docEl, { childList: true, subtree: true });
      }
      apply();
    } catch (e) {
      // Never let a transient DOM state kill the heartbeat.
    }
  }

  ensure();
  document.addEventListener("DOMContentLoaded", ensure);
  setInterval(ensure, 1000);

  // ------------------------------------------------------------------
  // Book context reporting. This webview deliberately has no Tauri IPC;
  // instead we "navigate" to cs-libby://ctx?d=<json> — the Rust
  // on_navigation handler captures the payload and cancels the navigation,
  // so the page never moves. Deterministic in WKWebView, unlike fetch()ing
  // a custom scheme from an https origin.
  // ------------------------------------------------------------------
  var lastReport = "";
  function report(ctx, force) {
    try {
      var s = JSON.stringify(ctx);
      if (!force && s === lastReport) return;
      lastReport = s;
      window.location.href = "cs-libby://ctx?d=" + encodeURIComponent(s);
    } catch (e) {}
  }

  function coverUrlOf(el) {
    if (el.tagName === "IMG") return el.currentSrc || el.src || "";
    var bg = (el.style && el.style.backgroundImage) || "";
    var m = bg.match(/url\(["']?(.*?)["']?\)/);
    return m ? m[1] : "";
  }

  function scrapeContext() {
    // The dominant OverDrive CDN cover on screen is the active book. Covers
    // appear as <img> (alt text = title) or as inline background-image divs.
    // Class-name selectors are a last resort — Libby minifies and shuffles
    // them.
    var els = document.querySelectorAll('img, [style*="od-cdn"]');
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < els.length; i++) {
      var url = coverUrlOf(els[i]);
      if (url.indexOf("od-cdn.com") === -1) continue;
      var r = els[i].getBoundingClientRect();
      var area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = els[i];
      }
    }
    if (!best || bestArea < 2000) return null;
    var title = cleanTitle(
      best.getAttribute("alt") || best.getAttribute("aria-label") || ""
    );
    if (!title) {
      var h = document.querySelector('h1, h2, [class*="title-name"]');
      if (h) title = cleanTitle((h.textContent || "").trim());
    }
    if (!title) return null;
    var author = null;
    var authorEl = document.querySelector(
      'a[href*="creator"], [class*="byline"], [class*="title-author"], [class*="author-name"], [class*="creator"]'
    );
    if (authorEl) {
      author =
        (authorEl.textContent || "").replace(/^by\s+/i, "").trim() || null;
    }
    return { title: title, author: author, cover: coverUrlOf(best) };
  }

  // Libby cover alt text reads like `Book: 'Yesteryear'. Cover image.` —
  // peel the media-type prefix, the trailing "Cover image", and the quotes.
  function cleanTitle(raw) {
    var t = String(raw)
      .replace(/^\s*(audiobook|book|magazine|comic)\s*:?\s*/i, "")
      .replace(/^cover( image)? of\s*/i, "")
      .replace(/\.?\s*cover image\.?\s*$/i, "")
      .replace(/\s*\(.*audiobook.*\)$/i, "")
      .trim()
      .replace(/\.\s*$/, "");
    var quoted = t.match(/^['"‘“](.+)['"’”]$/);
    if (quoted) t = quoted[1];
    return t.trim();
  }

  setInterval(function () {
    try {
      var ctx = scrapeContext();
      if (ctx) report(ctx, false);
    } catch (e) {}
  }, 1500);

  // ------------------------------------------------------------------
  // Borrow click-through: after the user confirms a borrow, auto-advance
  // Libby's export flow ("Read With..." -> external/Adobe reader -> download)
  // so the loan lands on the shelf without further clicks. Text-driven — the
  // only stable thing in Libby's minified DOM is what the user reads.
  // ------------------------------------------------------------------
  var auto = { until: 0, step: 0, clicked: [] };
  var AUTO_STEPS = [
    /^read with\b/i,
    /adobe|external reader|sideload|other (apps|readers)|epub/i,
    /^(download|get)( the)?( epub| file)?!?$/i,
  ];

  document.addEventListener(
    "click",
    function (e) {
      try {
        if (!e.isTrusted) return;
        var el =
          e.target && e.target.closest
            ? e.target.closest('button, a, [role="button"]')
            : null;
        if (!el) return;
        var txt = (el.textContent || "").trim().toLowerCase();
        if (/^borrow\b/.test(txt)) {
          // Borrow confirmed: capture this book's context now, then drive
          // the export flow for the next two minutes or until a download
          // starts.
          auto.until = Date.now() + 120000;
          auto.step = 0;
          auto.clicked = [];
          var ctx = scrapeContext();
          if (ctx) report(ctx, true);
        }
      } catch (err) {}
    },
    true
  );

  window.__csLibbyAutoDone = function () {
    auto.until = 0;
  };

  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  setInterval(function () {
    try {
      if (Date.now() > auto.until || auto.step >= AUTO_STEPS.length) return;
      var els = document.querySelectorAll('button, a, [role="button"]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!visible(el) || auto.clicked.indexOf(el) !== -1) continue;
        var txt = (el.textContent || "").trim();
        if (txt.length > 40) continue;
        if (AUTO_STEPS[auto.step].test(txt)) {
          auto.clicked.push(el);
          auto.step++;
          el.click();
          return; // one step per tick; let the UI settle
        }
      }
    } catch (e) {}
  }, 700);

  // ------------------------------------------------------------------
  // Download confirmation modal. The native Libby webview covers the app's
  // React UI, so feedback must render inside this page. Rust calls this via
  // eval() when a download finishes.
  // ------------------------------------------------------------------
  window.__csLibbyModal = function (opts) {
    try {
      var old = document.getElementById("cs-libby-modal");
      if (old) old.remove();

      var overlay = document.createElement("div");
      overlay.id = "cs-libby-modal";
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;" +
        "background:rgba(26,24,20,0.45);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);" +
        "opacity:0;transition:opacity 220ms ease;";

      var card = document.createElement("div");
      card.style.cssText =
        "background:#faf7f2;color:#1a1814;border-radius:18px;padding:32px 36px;max-width:400px;width:calc(100% - 48px);" +
        "text-align:center;box-shadow:0 24px 64px rgba(26,24,20,0.35);" +
        "font:15px/1.5 -apple-system,system-ui,sans-serif;" +
        "transform:scale(0.92) translateY(10px);transition:transform 300ms cubic-bezier(0.2,0.9,0.3,1.15);";

      if (opts.ok && opts.cover) {
        var img = document.createElement("img");
        img.src = opts.cover;
        img.onerror = function () {
          img.remove();
        };
        img.style.cssText =
          "width:150px;aspect-ratio:2/3;object-fit:cover;border-radius:8px;margin:0 auto 20px;display:block;" +
          "box-shadow:0 10px 28px rgba(26,24,20,0.35);";
        card.appendChild(img);
      }

      var headline = document.createElement("div");
      headline.style.cssText =
        'font-family:"Iowan Old Style",Palatino,Georgia,serif;font-size:21px;line-height:1.35;letter-spacing:-0.01em;';
      if (opts.ok) {
        headline.innerHTML =
          (opts.title ? "<em>" + escapeHtml(opts.title) + "</em>" : "Your loan") +
          " is now available in your Downloads";
      } else {
        headline.textContent = "The download didn't finish";
      }
      card.appendChild(headline);

      var sub = document.createElement("div");
      sub.style.cssText = "margin-top:8px;color:#4b463e;font-size:13px;";
      sub.textContent = opts.ok
        ? "Open the Downloads tab to send it to your reader."
        : "Try the export again from your Libby shelf.";
      card.appendChild(sub);

      var btn = document.createElement("button");
      btn.textContent = "Keep Browsing";
      btn.style.cssText =
        "margin-top:22px;background:#1a1814;color:#faf7f2;border:none;border-radius:10px;" +
        "padding:11px 26px;font-size:14px;font-weight:600;cursor:pointer;";
      card.appendChild(btn);

      overlay.appendChild(card);
      (document.body || document.documentElement).appendChild(overlay);

      function close() {
        overlay.style.opacity = "0";
        card.style.transform = "scale(0.95) translateY(8px)";
        setTimeout(function () {
          overlay.remove();
        }, 240);
      }
      btn.addEventListener("click", close);
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) close();
      });

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          overlay.style.opacity = "1";
          card.style.transform = "scale(1) translateY(0)";
        });
      });
    } catch (e) {}
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
