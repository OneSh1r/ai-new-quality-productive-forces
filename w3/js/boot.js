/* =============================================================================
 * Visual Pandas — boot.js
 * Starts the application with the default dataset so the workspace is never
 * empty on first visit.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = root.PV || {};

  PV.boot = function () {
    PV.shell.init();
    if (!PV.app.state.datasets.length) {
      PV.app.loadSample(PV.datasets.defaultId);
    }
    PV.app.setStatus('');
  };

  if (root.document) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', PV.boot);
    } else {
      PV.boot();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
