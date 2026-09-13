((root, factory) => {
  const api = factory(root);
  root.AtlasDataLoader = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis, (root) => {
  "use strict";

  async function loadPayload({ jsonURL, snapshotURL }) {
    // Browsers cannot fetch JSON from file: URLs. A local classic script can
    // load the same checked-in snapshot without changing browser permissions.
    if (root.location.protocol !== "file:") {
      const response = await root.fetch(jsonURL);
      if (!response.ok) throw new Error(`Could not load ${jsonURL} (HTTP ${response.status})`);
      return response.json();
    }

    return new Promise((resolve, reject) => {
      const script = root.document.createElement("script");
      script.src = snapshotURL;
      script.async = true;
      delete root.AtlasArticleSnapshot;
      const finish = () => {
        script.onload = null;
        script.onerror = null;
        script.remove();
      };
      script.onload = () => {
        const payload = root.AtlasArticleSnapshot;
        delete root.AtlasArticleSnapshot;
        finish();
        if (!payload || !Array.isArray(payload.records)) {
          reject(new Error(`The local collection snapshot ${snapshotURL} is invalid`));
          return;
        }
        resolve(payload);
      };
      script.onerror = () => {
        finish();
        reject(new Error(`Could not load the local collection snapshot ${snapshotURL}`));
      };
      root.document.head.appendChild(script);
    });
  }

  return { loadPayload };
});
