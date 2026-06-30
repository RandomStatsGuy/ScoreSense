import React, { useEffect, useMemo, useState } from "react";

const DISMISS_KEY = "scoresense_pwa_install_dismissed";
const DISMISS_KEY_IOS = "scoresense_pwa_install_ios_dismissed";

function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true
  );
}

function isIosInstallable() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isOtherBrowser = /crios|fxios|edgios/i.test(ua);
  return isIos && !isOtherBrowser && !isStandaloneDisplay();
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const [iosMode, setIosMode] = useState(false);

  const showIos = useMemo(() => {
    if (typeof localStorage === "undefined") return false;
    return isIosInstallable() && !localStorage.getItem(DISMISS_KEY_IOS);
  }, []);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return undefined;
    const onBeforeInstall = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
      setVisible(true);
      setIosMode(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  useEffect(() => {
    if (!showIos || deferredPrompt) return;
    setIosMode(true);
    setVisible(true);
  }, [showIos, deferredPrompt]);

  if (!visible) return null;

  const dismiss = () => {
    if (iosMode) {
      localStorage.setItem(DISMISS_KEY_IOS, "1");
    } else {
      localStorage.setItem(DISMISS_KEY, "1");
    }
    setVisible(false);
    setDeferredPrompt(null);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    dismiss();
  };

  return (
    <div
      className={`pwa-install-banner${iosMode ? " pwa-install-banner--ios" : ""}`}
      role="region"
      aria-label="Install app"
    >
      <div className="pwa-install-banner-copy">
        <strong>{iosMode ? "Add ScoreSense to Home Screen" : "Install ScoreSense"}</strong>
        {iosMode ? (
          <span>
            Tap Share
            {" "}
            <span className="pwa-install-ios-share" aria-hidden="true">□↑</span>
            {" "}
            then &quot;Add to Home Screen&quot; for quick access.
          </span>
        ) : (
          <span>Add to your home screen for quick access.</span>
        )}
      </div>
      <div className="pwa-install-banner-actions">
        <button type="button" className="btn-ghost btn-sm" onClick={dismiss}>
          Not now
        </button>
        {!iosMode && (
          <button type="button" className="btn-primary btn-sm" onClick={install}>
            Install
          </button>
        )}
      </div>
    </div>
  );
}
