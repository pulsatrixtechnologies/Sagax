// DOM measurements of the surface on screen, evaluated in the page by
// capture-desktop.mjs (the expression's value is the JSON written next to the
// PNG). Coordinates and sizes are CSS px, which are iPad points at these
// viewports.
//
// `tokens`: the active skin's custom properties on :root (every --*).
// `focusedField`: the focused text field's rect, or null (its caret is masked).
// `boxes`: every visible element that draws something or holds text: its
//   rect, the computed styles a SwiftUI reproduction needs, and a short
//   identity (tag, role, aria-label, data-* names, a few classes, own text).
//   Ordered in document order; a box fully hidden behind an overlay is still
//   listed (hit-testing is in `hit`: the element found at its centre).
(() => {
  const PROPS = [
    "display", "position", "flexDirection", "alignItems", "justifyContent", "gap",
    "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textTransform", "textAlign", "whiteSpace",
    "color", "backgroundColor", "backgroundImage", "opacity",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "borderStyle",
    "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "marginTop", "marginRight", "marginBottom", "marginLeft",
    "boxShadow", "backdropFilter", "outlineStyle", "outlineColor", "outlineWidth", "zIndex", "overflow", "cursor",
  ];
  // Defaults left out of each record to keep the dump readable.
  const DEFAULTS = {
    position: "static", flexDirection: "row", alignItems: "normal", justifyContent: "normal", gap: "normal",
    letterSpacing: "normal", textTransform: "none", textAlign: "start", whiteSpace: "normal",
    backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none", opacity: "1",
    borderTopWidth: "0px", borderRightWidth: "0px", borderBottomWidth: "0px", borderLeftWidth: "0px", borderStyle: "none",
    borderTopLeftRadius: "0px", borderTopRightRadius: "0px", borderBottomRightRadius: "0px", borderBottomLeftRadius: "0px",
    paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
    marginTop: "0px", marginRight: "0px", marginBottom: "0px", marginLeft: "0px",
    boxShadow: "none", backdropFilter: "none", outlineStyle: "none", zIndex: "auto", overflow: "visible", cursor: "auto",
  };
  const vw = innerWidth, vh = innerHeight;
  const round = (n) => Math.round(n * 100) / 100;

  const rootStyle = getComputedStyle(document.documentElement);
  const tokens = {};
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.style) {
          for (const name of rule.style) if (name.startsWith("--") && !(name in tokens)) tokens[name] = rootStyle.getPropertyValue(name).trim();
        }
        if (rule.cssRules) walk(rule.cssRules);
      }
    };
    walk(rules);
  }
  for (const name of Object.keys(tokens)) if (tokens[name] === "") delete tokens[name];

  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").replace(/\s+/g, " ").trim();
  const boxes = [];
  const all = document.body.querySelectorAll("*");
  for (const el of all) {
    if (boxes.length >= 2500) break;
    if (el.closest("script,style,noscript,template")) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1 || b.right <= 0 || b.bottom <= 0 || b.left >= vw || b.top >= vh) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const text = ownText(el);
    const tag = el.tagName.toLowerCase();
    const paints = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || cs.boxShadow !== "none"
      || ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0)
      || ["svg", "img", "canvas", "video", "input", "textarea", "button", "select", "hr"].includes(tag)
      || el.getAttribute("role");
    if (!paints && !text) continue;
    const style = {};
    for (const p of PROPS) {
      const v = cs[p];
      if (v !== undefined && v !== "" && DEFAULTS[p] !== v) style[p] = p === "backgroundImage" && v.length > 300 ? `${v.slice(0, 300)}…` : v;
    }
    const cx = Math.min(vw - 1, Math.max(0, b.left + b.width / 2)), cy = Math.min(vh - 1, Math.max(0, b.top + b.height / 2));
    const top = document.elementFromPoint(cx, cy);
    const data = [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => (a.value ? `${a.name}=${a.value.slice(0, 40)}` : a.name));
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean) : [];
    boxes.push({
      tag,
      ...(el.getAttribute("role") ? { role: el.getAttribute("role") } : {}),
      ...(el.getAttribute("aria-label") ? { label: el.getAttribute("aria-label").slice(0, 80) } : {}),
      ...(data.length ? { data } : {}),
      ...(cls.length ? { cls: cls.slice(0, 12).join(" ") } : {}),
      ...(text ? { text: text.slice(0, 80) } : {}),
      rect: [round(b.left), round(b.top), round(b.width), round(b.height)],
      ...(top === el || (top && el.contains(top)) ? {} : { hit: false }),
      style,
    });
  }
  // The focused text field: the iPad diff masks its caret line.
  const active = document.activeElement;
  const activeRect = active && active !== document.body && /^(INPUT|TEXTAREA)$|true/.test(active.tagName + (active.isContentEditable ? "true" : ""))
    ? (() => { const r = active.getBoundingClientRect(); return [round(r.left), round(r.top), round(r.width), round(r.height)]; })()
    : null;
  return {
    url: location.pathname,
    focusedField: activeRect,
    skin: document.documentElement.dataset.skin,
    viewportCss: [vw, vh],
    tokens,
    boxes,
  };
})()
