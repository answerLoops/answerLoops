(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var widgetId = script.getAttribute('data-widget-id');
  if (!widgetId) return;

  // The address everything is loaded from: the one the snippet names, or this
  // script's own. Only a full http or https address is accepted, and it is
  // rebuilt from its origin and path, so nothing else the attribute holds is
  // carried along. Anything else and the widget does not start.
  function webAddress(raw) {
    if (typeof raw !== 'string') return null;
    var text = raw.replace(/^\s+|\s+$/g, '');
    if (!/^https?:\/\//i.test(text)) return null;
    if (typeof URL === 'function') {
      try {
        var parsed = new URL(text);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
        return parsed.origin + parsed.pathname.replace(/\/+$/, '');
      } catch (e) {
        return null;
      }
    }
    var plain = text.split(/[?#]/)[0];
    return /^https?:\/\/[^\s"'<>\\]+$/i.test(plain) ? plain.replace(/\/+$/, '') : null;
  }

  // Normalizes the percent-encoding of the accepted address (decode, then
  // encode again), so it is safe to join other path pieces onto. A well-formed
  // address comes back unchanged; one that cannot be decoded is refused.
  function encodedAddress(address) {
    if (!address) return null;
    try {
      return encodeURI(decodeURI(address));
    } catch (e) {
      return null;
    }
  }

  var baseUrl = encodedAddress(webAddress(script.getAttribute('data-base-url') ||
    (script.src ? script.src.replace('/widget.js', '') : window.location.origin)));
  if (!baseUrl) return;

  var BUBBLE_SIZE = 56;
  // Window sizes a business can pick (small is today's size and the default).
  // The server decides which one a business gets; unknown names fall back to small.
  var SIZES = { small: [380, 580], medium: [440, 680], large: [520, 760] };
  // The launcher bubble's color when a business has not chosen one. It is the
  // same blue as the chat window (brand-600 in app/globals.css). The server
  // sends a business's own color, with the icon color that reads best on it.
  var DEFAULT_COLOR = '#2563eb';
  var DEFAULT_ICON_COLOR = '#ffffff';
  // How long the page waits for the settings lookup before showing the widget
  // as it looked before the lookup existed.
  var CONFIG_TIMEOUT_MS = 2000;
  var TOKEN_PATTERN = /^[0-9a-f]{48}$/;
  var PANEL_W = SIZES.small[0];
  var PANEL_H = SIZES.small[1];
  var bubbleColor = DEFAULT_COLOR;
  var iconColor = DEFAULT_ICON_COLOR;
  // The workspace's own logo, when it has one: the lookup gives a version number
  // and the address is built from this script's own base address, the widget
  // token and that number. It is shown inside a white circle on the bubble. If
  // the image cannot load, the normal chat icon is used instead.
  var logoVersion = null;
  var logoFailed = false;
  // The token the chat panel is loaded with. Equal to data-widget-id for a
  // token snippet; for a slug snippet it is whatever the lookup resolves to.
  var panelToken = widgetId;
  var isOpen = false;
  var panel = null;
  var bubble = null;
  // The chat frame is created the first time the bubble is opened, not when
  // the page loads, so what the visitor sees was loaded when they started
  // chatting. If the panel is reopened after the frame has been loaded for
  // longer than this, it is loaded again (the chat keeps the conversation in
  // the visitor's browser, so nothing is lost).
  var FRAME_MAX_AGE_MS = 4 * 60 * 1000;
  var iframe = null;
  var frameLoadedAt = 0;

  // Rebuilds a color that already passed the #rrggbb check from its three
  // numeric channels, so what reaches the page is made only of digits and
  // hex letters this script generated, never the server's text itself.
  function cleanHex(hex) {
    function channel(start) {
      var value = parseInt(hex.slice(start, start + 2), 16);
      return (value < 16 ? '0' : '') + value.toString(16);
    }
    return '#' + channel(1) + channel(3) + channel(5);
  }

  // The bubble's shadows are built from its own color so they follow it. Only
  // called with a value that already passed the #rrggbb check.
  function rgba(hex, alpha) {
    return 'rgba(' + parseInt(hex.slice(1, 3), 16) + ',' + parseInt(hex.slice(3, 5), 16) + ',' + parseInt(hex.slice(5, 7), 16) + ',' + alpha + ')';
  }

  // Builds the icon from DOM nodes and replaces whatever the bubble shows.
  function setBubbleIcon(size, path) {
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', iconColor);
    var shape = document.createElementNS(SVG_NS, 'path');
    shape.setAttribute('d', path);
    svg.appendChild(shape);
    bubble.textContent = '';
    bubble.appendChild(svg);
  }

  var CHAT_ICON_PATH = 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z';
  var CLOSE_ICON_PATH = 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';

  function createStyles() {
    var style = document.createElement('style');
    style.textContent = [
      '#cp-widget-bubble{position:fixed;bottom:24px;right:24px;z-index:2147483646;width:' + BUBBLE_SIZE + 'px;height:' + BUBBLE_SIZE + 'px;border-radius:50%;background:' + bubbleColor + ';box-shadow:0 4px 16px ' + rgba(bubbleColor, .4) + ';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s;}',
      '#cp-widget-bubble:hover{transform:scale(1.08);box-shadow:0 6px 20px ' + rgba(bubbleColor, .5) + ';}',
      // A two-tone ring (white inside, dark outside) so keyboard focus is visible
      // on any brand color and on any page background.
      '#cp-widget-bubble:focus-visible{outline:none;box-shadow:0 0 0 3px #ffffff,0 0 0 6px #111827;}',
      '#cp-widget-bubble .cp-logo{width:44px;height:44px;border-radius:50%;background:#ffffff;object-fit:cover;display:block;}',
      '#cp-widget-panel{position:fixed;bottom:' + (BUBBLE_SIZE + 32) + 'px;right:24px;z-index:2147483645;width:' + PANEL_W + 'px;height:' + PANEL_H + 'px;background:#ffffff;max-width:calc(100vw - 48px);max-height:calc(100vh - ' + (BUBBLE_SIZE + 56) + 'px);border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);border:1px solid #e5e7eb;overflow:hidden;transform-origin:bottom right;transition:transform .2s cubic-bezier(.34,1.56,.64,1),opacity .15s;transform:scale(.85);opacity:0;pointer-events:none;}',
      '#cp-widget-panel.cp-open{transform:scale(1);opacity:1;pointer-events:all;}',
      '#cp-widget-panel iframe{width:100%;height:100%;border:none;display:block;}',
    ].join('');
    document.head.appendChild(style);
  }

  // The closed bubble shows the workspace's logo in a white circle when there is
  // one and it loads, otherwise the chat icon.
  function showClosedBubble() {
    if (logoVersion !== null && !logoFailed && TOKEN_PATTERN.test(panelToken) && /^\d+$/.test(String(logoVersion))) {
      bubble.textContent = '';
      var img = document.createElement('img');
      img.className = 'cp-logo';
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.onerror = function () {
        logoFailed = true;
        if (!isOpen) showClosedBubble();
      };
      img.src = baseUrl + '/api/widget/logo/' + encodeURIComponent(panelToken) + '?v=' + encodeURIComponent(String(logoVersion));
      bubble.appendChild(img);
    } else {
      setBubbleIcon(24, CHAT_ICON_PATH);
    }
  }
  function createBubble() {
    bubble = document.createElement('button');
    bubble.id = 'cp-widget-bubble';
    bubble.setAttribute('aria-label', 'Open support chat');
    showClosedBubble();
    bubble.addEventListener('click', togglePanel);
    document.body.appendChild(bubble);
  }

  function createPanel() {
    panel = document.createElement('div');
    panel.id = 'cp-widget-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Support chat');
    document.body.appendChild(panel);
  }

  // Creates the chat frame on first use and (re)loads it. The embedding origin
  // is not passed here on purpose. The server reads it from the Referer
  // header, which the browser sets and page script cannot forge. Anything
  // this script could send would be equally settable by whoever is embedding
  // the widget, so it would defeat the allowed-domains check rather than
  // support it.
  function loadFrame() {
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.title = 'Support chat';
      iframe.setAttribute('allow', 'clipboard-write');
      panel.appendChild(iframe);
    }
    iframe.src = baseUrl + '/widget/' + panelToken;
    frameLoadedAt = Date.now();
  }

  function togglePanel() {
    isOpen = !isOpen;
    if (isOpen) {
      if (!iframe || Date.now() - frameLoadedAt > FRAME_MAX_AGE_MS) loadFrame();
      panel.classList.add('cp-open');
      bubble.setAttribute('aria-label', 'Close support chat');
      setBubbleIcon(20, CLOSE_ICON_PATH);
    } else {
      panel.classList.remove('cp-open');
      bubble.setAttribute('aria-label', 'Open support chat');
      showClosedBubble();
    }
  }

  function applyConfig(config) {
    if (!config || typeof config !== 'object') return;
    if (typeof config.token === 'string' && TOKEN_PATTERN.test(config.token)) {
      panelToken = config.token;
    }
    var display = config.display;
    if (display && typeof display === 'object') {
      if (typeof display.windowSize === 'string' && Object.prototype.hasOwnProperty.call(SIZES, display.windowSize)) {
        PANEL_W = SIZES[display.windowSize][0];
        PANEL_H = SIZES[display.windowSize][1];
      }
      // Checked here as well as on the server: the value ends up inside a
      // stylesheet, so only a plain #rrggbb is ever allowed through.
      if (typeof display.bubbleColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(display.bubbleColor)) {
        bubbleColor = cleanHex(display.bubbleColor);
      }
      if (typeof display.bubbleIconColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(display.bubbleIconColor)) {
        iconColor = cleanHex(display.bubbleIconColor);
      }
      if (typeof display.logoVersion === 'number' && isFinite(display.logoVersion) && display.logoVersion >= 0) {
        logoVersion = Math.floor(display.logoVersion);
      }
    }
  }

  // Asks the server how this business wants the widget to look and, for a slug
  // snippet, which token is current. Never rejects: any failure, a slow reply
  // or an unreadable answer resolves to null and the widget shows as before.
  function loadConfig() {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    var timeout = new Promise(function (resolve) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        resolve(null);
      }, CONFIG_TIMEOUT_MS);
    });
    var request = fetch(baseUrl + '/api/widget/config?id=' + encodeURIComponent(widgetId), {
      credentials: 'omit',
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
    return Promise.race([request, timeout]).then(function (config) {
      clearTimeout(timer);
      return config;
    });
  }

  function init() {
    loadConfig().then(function (config) {
      applyConfig(config);
      // A slug is only a name. If the lookup could not turn it into a token
      // there is nothing to load, so the widget stays off rather than opening
      // onto a page that cannot exist.
      if (!TOKEN_PATTERN.test(panelToken)) return;
      createStyles();
      createBubble();
      createPanel();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
