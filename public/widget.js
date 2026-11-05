(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var widgetId = script.getAttribute('data-widget-id');
  if (!widgetId) return;

  var baseUrl = script.getAttribute('data-base-url') ||
    (script.src ? script.src.replace('/widget.js', '') : window.location.origin);

  var BUBBLE_SIZE = 56;
  // Window sizes a business can pick (small is today's size and the default).
  // The server decides which one a business gets; unknown names fall back to small.
  var SIZES = { small: [380, 580], medium: [440, 680], large: [520, 760] };
  var DEFAULT_COLOR = '#4f46e5';
  // How long the page waits for the settings lookup before showing the widget
  // as it looked before the lookup existed.
  var CONFIG_TIMEOUT_MS = 2000;
  var PANEL_W = SIZES.small[0];
  var PANEL_H = SIZES.small[1];
  var bubbleColor = DEFAULT_COLOR;
  var isOpen = false;
  var panel = null;
  var bubble = null;

  function createStyles() {
    var style = document.createElement('style');
    style.textContent = [
      '#cp-widget-bubble{position:fixed;bottom:24px;right:24px;z-index:2147483646;width:' + BUBBLE_SIZE + 'px;height:' + BUBBLE_SIZE + 'px;border-radius:50%;background:' + bubbleColor + ';box-shadow:0 4px 16px rgba(79,70,229,.4);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s;}',
      '#cp-widget-bubble:hover{transform:scale(1.08);box-shadow:0 6px 20px rgba(79,70,229,.5);}',
      '#cp-widget-panel{position:fixed;bottom:' + (BUBBLE_SIZE + 32) + 'px;right:24px;z-index:2147483645;width:' + PANEL_W + 'px;height:' + PANEL_H + 'px;max-width:calc(100vw - 48px);max-height:calc(100vh - ' + (BUBBLE_SIZE + 56) + 'px);border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);border:1px solid #e5e7eb;overflow:hidden;transform-origin:bottom right;transition:transform .2s cubic-bezier(.34,1.56,.64,1),opacity .15s;transform:scale(.85);opacity:0;pointer-events:none;}',
      '#cp-widget-panel.cp-open{transform:scale(1);opacity:1;pointer-events:all;}',
      '#cp-widget-panel iframe{width:100%;height:100%;border:none;display:block;}',
    ].join('');
    document.head.appendChild(style);
  }

  function createBubble() {
    bubble = document.createElement('button');
    bubble.id = 'cp-widget-bubble';
    bubble.setAttribute('aria-label', 'Open support chat');
    bubble.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    bubble.addEventListener('click', togglePanel);
    document.body.appendChild(bubble);
  }

  function createPanel() {
    panel = document.createElement('div');
    panel.id = 'cp-widget-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Support chat');

    var iframe = document.createElement('iframe');
    // The embedding origin is not passed here on purpose. The server reads it
    // from the Referer header, which the browser sets and page script cannot
    // forge. Anything this script could send would be equally settable by
    // whoever is embedding the widget, so it would defeat the allowed-domains
    // check rather than support it.
    iframe.src = baseUrl + '/widget/' + widgetId;
    iframe.title = 'Support chat';
    iframe.setAttribute('allow', 'clipboard-write');

    panel.appendChild(iframe);
    document.body.appendChild(panel);
  }

  function togglePanel() {
    isOpen = !isOpen;
    if (isOpen) {
      panel.classList.add('cp-open');
      bubble.setAttribute('aria-label', 'Close support chat');
      bubble.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    } else {
      panel.classList.remove('cp-open');
      bubble.setAttribute('aria-label', 'Open support chat');
      bubble.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    }
  }

  function applyConfig(config) {
    if (!config || typeof config !== 'object') return;
    var display = config.display;
    if (display && typeof display === 'object') {
      if (typeof display.windowSize === 'string' && Object.prototype.hasOwnProperty.call(SIZES, display.windowSize)) {
        PANEL_W = SIZES[display.windowSize][0];
        PANEL_H = SIZES[display.windowSize][1];
      }
      // Checked here as well as on the server: the value ends up inside a
      // stylesheet, so only a plain #rrggbb is ever allowed through.
      if (typeof display.bubbleColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(display.bubbleColor)) {
        bubbleColor = display.bubbleColor;
      }
    }
  }

  // Asks the server how this business wants the widget to look. Never rejects: any failure, a slow reply
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
