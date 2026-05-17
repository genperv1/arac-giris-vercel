(function () {
  'use strict';

  try {
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        init = init || {};
        if (!init.credentials) init.credentials = 'same-origin';
      } catch (e) {}
      return origFetch(input, init);
    };
  } catch (e) {}

  var __safeBindMap = new WeakMap();
  function safeBind(el, eventName, handler, options) {
    try {
      if (!el || !eventName || !handler) return;
      var map = __safeBindMap.get(el);
      if (!map) {
        map = {};
        __safeBindMap.set(el, map);
      }
      var prev = map[eventName];
      if (prev) {
        try {
          el.removeEventListener(eventName, prev, options);
        } catch (e) {
          try {
            el.removeEventListener(eventName, prev);
          } catch (_e) {}
        }
      }
      el.addEventListener(eventName, handler, options);
      map[eventName] = handler;
    } catch (e) {}
  }

  function addOnce(el, eventName, handler, options) {
    return safeBind(el, eventName, handler, options);
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(s) {
    if (s === null || s === undefined) return '';
    return escapeHtml(String(s));
  }

  window.safeBind = safeBind;
  window.addOnce = addOnce;
  window.escapeHtml = escapeHtml;
  window.escapeAttr = escapeAttr;
})();
