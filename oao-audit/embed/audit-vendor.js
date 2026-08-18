(function () {
  "use strict";

  const SCRIPTS = [
    {
      local: "vendor/pdfjs-dist/build/pdf.min.js",
      cdn: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
    },
    {
      local: "vendor/xlsx/xlsx.full.min.js",
      cdn: "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
    },
    {
      local: "vendor/mammoth/mammoth.browser.min.js",
      cdn: "https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js",
    },
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => resolve(src);
      el.onerror = () => reject(new Error(src));
      document.head.appendChild(el);
    });
  }

  async function loadWithFallback(item) {
    try {
      await loadScript(item.local);
    } catch (_) {
      await loadScript(item.cdn);
    }
  }

  window.__OAO_AUDIT_VENDOR_READY__ = (async () => {
    for (const item of SCRIPTS) {
      await loadWithFallback(item);
    }
    if (window.pdfjsLib) {
      const workerLocal = "vendor/pdfjs-dist/build/pdf.worker.min.js";
      const workerCdn =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerLocal;
      try {
        const probe = await fetch(workerLocal, { method: "HEAD", cache: "no-store" });
        if (!probe.ok) pdfjsLib.GlobalWorkerOptions.workerSrc = workerCdn;
      } catch (_) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerCdn;
      }
    }
  })();
})();
