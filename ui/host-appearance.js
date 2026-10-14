var ZLGHostAppearance = (() => {
  "use strict";
  const tokens = ["--color-background", "--color-sidepane", "--color-toolbar", "--color-panedivider", "--color-button", "--color-accent", "--accent-blue", "--fill-primary"];

  function isDark(color, fallback) {
    let rgb;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
    if (hex) {
      const value = hex[1].length === 3 ? [...hex[1]].map(char => char + char).join("") : hex[1];
      rgb = [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16));
    } else {
      const match = /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/.exec(color);
      if (match) rgb = match.slice(1, 4).map(Number);
    }
    return rgb ? rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < 128 : fallback;
  }

  function connect(win, host) {
    if (!host?.document || host.closed) return () => {};
    const root = win.document.documentElement;
    const hostRoot = host.document.documentElement;
    const media = host.matchMedia("(prefers-color-scheme:dark)");
    const sync = () => {
      if (host.closed) return;
      const style = host.getComputedStyle(hostRoot);
      root.dataset.theme = isDark(style.getPropertyValue("--color-background").trim(), media.matches) ? "dark" : "light";
      for (const token of tokens) {
        const value = style.getPropertyValue(token).trim();
        if (value) root.style.setProperty(token, value);
        else root.style.removeProperty(token);
      }
    };
    sync();
    const observer = new host.MutationObserver(sync);
    observer.observe(hostRoot, {attributes:true});
    media.addEventListener("change", sync);
    host.addEventListener("activate", sync);
    win.addEventListener("focus", sync);
    const disconnect = () => {
      observer.disconnect();
      media.removeEventListener("change", sync);
      host.removeEventListener("activate", sync);
      win.removeEventListener("focus", sync);
    };
    win.addEventListener("unload", disconnect, {once:true});
    return disconnect;
  }
  return {connect};
})();
