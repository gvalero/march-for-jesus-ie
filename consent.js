/*
 * March for Jesus Dublin — cookie consent + marketing-tracking gate.
 * Custom lightweight banner + Google Consent Mode v2. No third-party CMP.
 *
 * Responsibilities:
 *   - Show a first-visit Accept/Reject banner (equal prominence), remember the
 *     choice, and expose a footer "Cookie settings" re-open control.
 *   - Update Google Consent Mode v2 on Accept.
 *   - Load the Meta Pixel and TikTok Pixel base code (PageView / page) ONLY
 *     after marketing consent is granted.
 *   - Expose window.MFJConsent for the form handlers (script.js) to fire the
 *     Lead / SubmitForm conversions on the same consent state.
 *
 * Conversion events (fbq Lead, ttq SubmitForm) live in script.js, not here.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'mfj_consent'; // 'granted' | 'denied'
  var META_PIXEL_ID = '1325307855616020';
  var TIKTOK_PIXEL_ID = 'D9L843RC77U57S87KRC0';

  var state = null; // null = undecided
  var grantedCbs = [];
  var revokedCbs = [];
  var metaLoaded = false;
  var tiktokLoaded = false;

  function gtagSafe() {
    if (typeof window.gtag === 'function') {
      window.gtag.apply(window, arguments);
    }
  }

  // ---- Google Consent Mode v2 ------------------------------------------------
  function updateConsentMode(granted) {
    var v = granted ? 'granted' : 'denied';
    gtagSafe('consent', 'update', {
      ad_storage: v,
      analytics_storage: v,
      ad_user_data: v,
      ad_personalization: v
    });
  }

  // ---- Meta Pixel base (PageView) — consent-gated ----------------------------
  function loadMetaPixel() {
    if (metaLoaded || window.fbq) { return; }
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', META_PIXEL_ID);
    window.fbq('track', 'PageView');
    metaLoaded = true;
  }

  // ---- TikTok Pixel base (page) — consent-gated ------------------------------
  function loadTikTokPixel() {
    if (tiktokLoaded || window.ttq) { return; }
    !function (w, d, t) {
      w.TiktokAnalyticsObject = t; var ttq = w[t] = w[t] || [];
      ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off',
        'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie',
        'holdConsent', 'revokeConsent', 'grantConsent'];
      ttq.setAndDefer = function (t, e) {
        t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); };
      };
      for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
      ttq.instance = function (t) {
        for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]);
        return e;
      };
      ttq.load = function (e, n) {
        var r = 'https://analytics.tiktok.com/i18n/pixel/events.js', o = n && n.partner;
        ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = r;
        ttq._t = ttq._t || {}; ttq._t[e] = +new Date; ttq._o = ttq._o || {};
        ttq._o[e] = n || {}; n = document.createElement('script'); n.type = 'text/javascript';
        n.async = !0; n.src = r + '?sdkid=' + e + '&lib=' + t;
        e = document.getElementsByTagName('script')[0]; e.parentNode.insertBefore(n, e);
      };
      ttq.load(TIKTOK_PIXEL_ID);
      ttq.page();
    }(window, document, 'ttq');
    tiktokLoaded = true;
  }

  // ---- Apply a granted decision ---------------------------------------------
  function applyGranted() {
    updateConsentMode(true);
    loadMetaPixel();
    loadTikTokPixel();
    for (var i = 0; i < grantedCbs.length; i++) {
      try { grantedCbs[i](); } catch (e) {}
    }
  }

  function applyRevoked() {
    updateConsentMode(false);
    if (window.ttq && typeof window.ttq.revokeConsent === 'function') {
      window.ttq.revokeConsent();
    }
    if (window.fbq) {
      try { window.fbq('consent', 'revoke'); } catch (e) {}
    }
    for (var i = 0; i < revokedCbs.length; i++) {
      try { revokedCbs[i](); } catch (e) {}
    }
  }

  // ---- Persistence -----------------------------------------------------------
  function readStored() {
    try { return window.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function writeStored(v) {
    try { window.localStorage.setItem(STORAGE_KEY, v); } catch (e) {}
  }

  // ---- Banner UI -------------------------------------------------------------
  function buildBanner() {
    var wrap = document.createElement('div');
    wrap.className = 'mfj-consent';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-live', 'polite');
    wrap.setAttribute('aria-label', 'Cookie consent');
    wrap.innerHTML =
      '<div class="mfj-consent-inner">' +
        '<p class="mfj-consent-text">We use cookies for analytics and to measure our ' +
        'advertising (Google, Meta and TikTok). These load only with your consent. ' +
        'See how we use them in our <a href="privacy.html" class="mfj-consent-link">privacy notice</a>.</p>' +
        '<div class="mfj-consent-actions">' +
          '<button type="button" class="mfj-consent-btn mfj-consent-reject">Reject</button>' +
          '<button type="button" class="mfj-consent-btn mfj-consent-accept">Accept</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.querySelector('.mfj-consent-accept').addEventListener('click', function () { accept(); });
    wrap.querySelector('.mfj-consent-reject').addEventListener('click', function () { reject(); });
    return wrap;
  }

  var bannerEl = null;
  function showBanner() {
    if (!bannerEl) { bannerEl = buildBanner(); }
    bannerEl.classList.add('is-visible');
  }
  function hideBanner() {
    if (bannerEl) { bannerEl.classList.remove('is-visible'); }
  }

  // ---- Public actions --------------------------------------------------------
  function accept() {
    state = 'granted';
    writeStored('granted');
    hideBanner();
    applyGranted();
  }
  function reject() {
    state = 'denied';
    writeStored('denied');
    hideBanner();
    applyRevoked();
  }
  function reopen() { showBanner(); }

  // ---- Public API ------------------------------------------------------------
  window.MFJConsent = {
    hasMarketingConsent: function () { return state === 'granted'; },
    onMarketingConsentGranted: function (cb) {
      if (typeof cb !== 'function') return;
      grantedCbs.push(cb);
      if (state === 'granted') { try { cb(); } catch (e) {} }
    },
    onMarketingConsentRevoked: function (cb) {
      if (typeof cb === 'function') revokedCbs.push(cb);
    },
    accept: accept,
    reject: reject,
    reopen: reopen
  };

  // ---- Init ------------------------------------------------------------------
  function init() {
    var stored = readStored();
    if (stored === 'granted') {
      state = 'granted';
      applyGranted();
    } else if (stored === 'denied') {
      state = 'denied';
      // defaults already denied; nothing to load
    } else {
      showBanner();
    }
    // Wire the footer "Cookie settings" re-open control if present.
    var link = document.getElementById('cookie-settings-link');
    if (link) {
      link.addEventListener('click', function (e) { e.preventDefault(); reopen(); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
