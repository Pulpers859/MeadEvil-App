(function(){
  "use strict";

  const LOCAL_CONFIG_SCRIPTS = [
    "./config/firebase/meadevil-firebase-config.js",
    "./config/firebase/meadevil-firebase-config.local.js"
  ];

  function hasFirebaseConfig(){
    return Boolean(
      window.MEADEVIL_FIREBASE &&
      window.MEADEVIL_FIREBASE.apiKey &&
      window.MEADEVIL_FIREBASE.projectId &&
      window.MEADEVIL_FIREBASE.appId
    );
  }

  function loadScript(src){
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  async function hydrateFirebaseConfig(){
    if (hasFirebaseConfig()) return true;

    const isHttp = window.location.protocol === "http:" || window.location.protocol === "https:";
    if (isHttp) {
      const netlifyConfigUrl = new URL("/.netlify/functions/firebase-config", window.location.origin).toString();
      await loadScript(netlifyConfigUrl);
      return hasFirebaseConfig();
    }

    for (const src of LOCAL_CONFIG_SCRIPTS){
      if (hasFirebaseConfig()) return true;
      await loadScript(src);
    }

    return hasFirebaseConfig();
  }

  window.MEADEVIL_FIREBASE_READY = hydrateFirebaseConfig();
})();
