// What nomusic shows on each video: a view of one Session.
// - A button that turns nomusic on or off for the current video. It joins the
//   player's own row of buttons and is drawn as YouTube draws its captions
//   button: outlined while the music plays, filled while nomusic removes it.
//   Where a player has no such row (Shorts, other sites' players) it is the
//   same glyph in the player's top corner, shown with the player's controls.
// - A chip in the player's top corner, only while nomusic needs a moment (the
//   first audio is being prepared) or a click (the browser waits for one before
//   it plays sound), as YouTube shows its own "click to unmute".
// - The recovery dialog when nomusic could not remove the music.

import { setLanguage, t } from "./i18n.js";

// Everything below is resolved while the extension is certainly alive (see
// i18n.js): the "updated" failure shows after it is gone.
const TEXT = {
  name: t("control_name"),
  on: t("control_on"),
  off: t("control_off"),
  setup: t("control_setup"),
  failed: t("control_failed"),
  working: t("notice_working"),
  blocked: t("notice_blocked"),
  title: t("panel_title"),
  retry: t("panel_retry"),
  reload: t("panel_reload"),
  original: t("panel_original"),
};
// status -> [data-state, tooltip and announcement]
const STATES = {
  setup: ["idle", TEXT.setup],
  off: ["idle", TEXT.off],
  starting: ["working", TEXT.working],
  buffering: ["working", TEXT.working],
  on: ["active", TEXT.on],
  blocked: ["attention", TEXT.blocked],
  failed: ["error", TEXT.failed],
};
// A hold shorter than this shows no chip (a short one after a stall would only flicker).
const NOTICE_DELAY_MS = 400;

// The glyph, on YouTube's 24 px grid: a struck-through note in a rounded box,
// outlined while the music plays and filled (the note cut out of it) while
// nomusic removes it. The strike cuts a gap through the note's stem.
// tools/icons.mjs draws the mark from the same note. Built with DOM calls:
// YouTube's pages accept only trusted markup.
const SVG = "http://www.w3.org/2000/svg";
const NOTE = [ // on its own 24 px grid, placed in the box by INSIDE
  ["path", { d: "M12 16.4V4.2", "stroke-width": 2.6, "stroke-linecap": "round" }],
  ["path", { d: "M12 4.2c0 2.2 1.8 3.1 3.4 4.1 1.4.9 2.2 2 2.2 3.7", "stroke-width": 2.6, "stroke-linecap": "round", fill: "none" }],
  ["ellipse", { cx: 9.1, cy: 16.9, rx: 3.4, ry: 2.6, transform: "rotate(-22 9.1 16.9)", stroke: "none" }],
];
const STRIKE = "M4 4 20 20";
const INSIDE = "translate(5.28 5.28) scale(0.56)";
const PLAY = "M8 5.5v13l10.5-6.5z";
let glyphs = 0;
function svg(tag, attributes, ...children) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}
const note = (attributes) => svg("g", { transform: INSIDE, ...attributes }, ...NOTE.map(([tag, a]) => svg(tag, a)));
function glyph() {
  const id = ++glyphs;
  const mask = (name, ...children) => svg("mask", { id: `nomusic-${name}-${id}`, maskUnits: "userSpaceOnUse" },
    svg("rect", { width: 24, height: 24, fill: "#fff" }), ...children);
  const strike = (color, width) => svg("path", { d: STRIKE, transform: INSIDE, stroke: color, "stroke-width": width, "stroke-linecap": "round" });
  return svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
    // The gap around the strike is cut out of the outlined note, and the
    // whole struck note out of the filled box.
    mask("gap", strike("#000", 5)),
    mask("cut", note({ fill: "#000", stroke: "#000" }), strike("#fff", 5), strike("#000", 2.6)),
    svg("g", { class: "nomusic-glyph-outlined" },
      svg("rect", { x: 2, y: 4, width: 20, height: 16, rx: 2, fill: "none", stroke: "currentColor", "stroke-width": 2 }),
      svg("g", { mask: `url(#nomusic-gap-${id})` }, note({ fill: "currentColor", stroke: "currentColor" })),
      strike("currentColor", 2.6)),
    svg("rect", { class: "nomusic-glyph-filled", x: 1, y: 3, width: 22, height: 18, rx: 3, fill: "currentColor", mask: `url(#nomusic-cut-${id})` }));
}
const icon = (d) => svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" }, svg("path", { d, fill: "currentColor" }));

// Only the user's own clicks operate nomusic, never ones the page dispatches.
const trusted = (handler) => (event) => {
  event.stopPropagation();
  event.preventDefault();
  if (event.isTrusted) handler(event);
};
// Keep the player from treating clicks on our controls as clicks on the video
// (play/pause, double-click fullscreen).
function keepPointer(element) {
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick"]) {
    element.addEventListener(type, (event) => event.stopPropagation());
  }
}
// Keys meant for our controls must not reach the player's shortcuts (Space on
// the button would also play or pause the video).
function keepKeys(element, { all = false } = {}) {
  for (const type of ["keydown", "keypress", "keyup"]) {
    element.addEventListener(type, (event) => {
      if (all ? event.key !== "Tab" : event.key === " " || event.key === "Enter") event.stopPropagation();
    });
  }
}
const typing = () => {
  const active = document.activeElement;
  return !!active && (active.isContentEditable || /^(input|textarea|select)$/i.test(active.tagName));
};
const shown = (element) => !!element && element.offsetWidth > 0 && element.offsetHeight > 0;

// The player's own row of buttons, when it shows one: YouTube's control bar
// (the button goes before captions), or the top row of the embedded and mobile
// players. Null for players without one, or while it is hidden (the miniplayer).
function controlRow(host) {
  const right = host.querySelector(".ytp-right-controls");
  if (shown(right)) {
    const row = right.querySelector(".ytp-right-controls-left") ?? right;
    return { row, before: row.querySelector(".ytp-subtitles-button") ?? row.firstElementChild, bar: "ytp" };
  }
  const top = host.querySelector(".player-controls-top-right");
  if (top) {
    const captions = [...top.children].find((child) => child.querySelector?.("[class*='ClosedCaptioning']"));
    return { row: top, before: captions ?? top.firstElementChild, bar: "top" };
  }
  return null;
}
// YouTube's miniplayer shows only play and close: no button of ours either.
const minimized = (host) => host.classList.contains("ytp-player-minimized");

let dialogs = 0;

export class Button {
  constructor(video, session) {
    this.video = video;
    this.session = session;
    this.retired = false;
    this.shownFailure = null;
    this.dismissed = false; // the user closed the dialog without choosing
    this.announced = null;
    this.workingSince = null;
    this.wantedPlay = false;
    this.host = null;
    this.rtl = false; // the player's direction, which the corners follow

    this.el = setLanguage(document.createElement("button"));
    this.el.type = "button";
    this.el.className = "nomusic-btn";
    const dot = document.createElement("span");
    dot.className = "nomusic-btn__dot";
    this.el.append(glyph(), dot);
    keepPointer(this.el);
    keepKeys(this.el);
    this.el.addEventListener("click", trusted(() => {
      if (this.session.status === "setup") openWelcome();
      else if (this.session.failure) this.openRecovery({ focus: true });
      else this.session.toggle();
      this.showTip();
    }));
    // A tooltip in the player's own style, on hover and on keyboard focus.
    this.tip = setLanguage(document.createElement("div"));
    this.tip.className = "nomusic-tip";
    this.tip.setAttribute("aria-hidden", "true");
    this.tip.hidden = true;
    this.el.addEventListener("pointerenter", () => this.showTip());
    this.el.addEventListener("pointerleave", () => this.hideTip());
    this.el.addEventListener("focus", () => {
      if (this.el.matches(":focus-visible")) this.showTip();
    });
    this.el.addEventListener("blur", () => this.hideTip());

    // Status changes for screen readers: a live region beside the button (one
    // inside a button is unreliable), written only when the status changes.
    this.live = setLanguage(document.createElement("span"));
    this.live.className = "nomusic-sr-only";
    this.live.setAttribute("role", "status");

    this.notice = this.buildNotice();
    this.recovery = this.buildRecovery();
    this.onReposition = () => this.positionPanel();
    this.render();
  }

  render() {
    if (this.retired) return;
    const session = this.session;
    const status = session.status;
    const [state, text] = STATES[status] ?? STATES.off;
    if (this.el.dataset.state !== state) this.el.dataset.state = state;
    this.el.dataset.nomusicStatus = status;
    // A toggle while it is one; setup and a failure open something instead.
    const toggle = status !== "setup" && status !== "failed";
    const pressed = toggle ? String(session.on) : null;
    if (this.el.getAttribute("aria-pressed") !== pressed) {
      if (pressed === null) this.el.removeAttribute("aria-pressed");
      else this.el.setAttribute("aria-pressed", pressed);
    }
    const name = toggle ? TEXT.name : text;
    if (this.el.getAttribute("aria-label") !== name) this.el.setAttribute("aria-label", name);
    if (this.tip.textContent !== text) {
      this.tip.textContent = text;
      this.placeTip();
    }
    if (status !== this.announced) {
      this.announced = status;
      this.live.textContent = text;
    }
    this.renderNotice(state, text);
    if (session.failure !== this.shownFailure) {
      this.shownFailure = session.failure;
      this.dismissed = false;
      if (session.failure) {
        this.recoveryMessage.textContent = session.failure.message;
        this.retryBtn.textContent = session.retryReloads ? TEXT.reload : TEXT.retry;
        this.openRecovery({ focus: true });
      } else {
        this.closeRecovery();
      }
    }
    // Closed without a choice: it comes back when the user tries to play, and
    // the button keeps a dot meanwhile.
    const wantsPlay = !!session.intent?.wantsPlay;
    if (session.failure && this.dismissed && wantsPlay && !this.wantedPlay) this.openRecovery({ focus: true });
    this.wantedPlay = wantsPlay;
    this.el.toggleAttribute("data-dismissed", !!session.failure && this.dismissed);
  }

  // ---- the chip ---------------------------------------------------------------

  buildNotice() {
    const notice = setLanguage(document.createElement("button"));
    notice.type = "button";
    notice.className = "nomusic-notice";
    notice.hidden = true;
    notice.tabIndex = -1;
    const spinner = document.createElement("span");
    spinner.className = "nomusic-notice__spinner";
    const play = icon(PLAY);
    play.classList.add("nomusic-notice__play");
    this.noticeText = document.createElement("span");
    notice.append(spinner, play, this.noticeText);
    keepPointer(notice);
    keepKeys(notice);
    // Only the "click to play" chip takes clicks; the other one lets them
    // through to the video.
    notice.addEventListener("click", trusted(() => {
      if (this.session.status === "blocked") this.session.toggle();
    }));
    return notice;
  }

  renderNotice(state, text) {
    const now = performance.now();
    if (state === "working") this.workingSince ??= now;
    else this.workingSince = null;
    const working = state === "working" && now - this.workingSince >= NOTICE_DELAY_MS;
    const blocked = state === "attention";
    const show = (working || blocked) && !!this.host;
    if (this.notice.hidden === show) this.notice.hidden = !show;
    if (!show) return;
    if (this.noticeText.textContent !== text) this.noticeText.textContent = text;
    const kind = blocked ? "action" : "status";
    if (this.notice.dataset.kind !== kind) {
      this.notice.dataset.kind = kind;
      // The status chip is read out by the live region; the action is a button.
      this.notice.tabIndex = blocked ? 0 : -1;
      if (blocked) this.notice.removeAttribute("aria-hidden");
      else this.notice.setAttribute("aria-hidden", "true");
    }
  }

  // ---- the tooltip ----------------------------------------------------------

  showTip() {
    if (this.retired || !this.host || !this.el.isConnected) return;
    if (this.tip.parentElement !== this.host) this.host.append(this.tip);
    this.tip.hidden = false;
    this.placeTip();
  }

  hideTip() {
    this.tip.hidden = true;
  }

  // Centred on the button: above YouTube's whole bottom bar (clear of the
  // progress bar, as YouTube's own tooltips are), below a button at the top of
  // the player; kept inside the player.
  placeTip() {
    if (this.tip.hidden || !this.host) return;
    const box = this.el.getBoundingClientRect();
    const frame = this.host.getBoundingClientRect();
    const bar = this.el.closest(".ytp-chrome-bottom")?.getBoundingClientRect();
    const below = box.top - frame.top < frame.height / 2;
    const width = this.tip.offsetWidth;
    const center = box.left + box.width / 2 - frame.left;
    const left = Math.min(Math.max(8, center - width / 2), frame.width - 8 - width);
    const top = below ? box.bottom - frame.top + 8 : (bar ? bar.top : box.top) - frame.top - 12 - this.tip.offsetHeight;
    this.tip.style.left = `${Math.round(left)}px`;
    this.tip.style.top = `${Math.round(top)}px`;
  }

  // ---- the recovery dialog ----------------------------------------------------

  buildRecovery() {
    const id = `nomusic-dialog-${++dialogs}`;
    const panel = setLanguage(document.createElement("div"));
    panel.className = "nomusic-dialog";
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("aria-labelledby", `${id}-title`);
    panel.setAttribute("aria-describedby", `${id}-message`);
    panel.tabIndex = -1;
    panel.hidden = true;
    const title = document.createElement("p");
    title.className = "nomusic-dialog__title";
    title.id = `${id}-title`;
    title.textContent = TEXT.title;
    this.recoveryMessage = document.createElement("p");
    this.recoveryMessage.className = "nomusic-dialog__message";
    this.recoveryMessage.id = `${id}-message`;
    this.retryBtn = this.action("retry", () => this.session.retry());
    this.returnBtn = this.action("original", () => this.session.returnToOriginal());
    this.returnBtn.textContent = TEXT.original;
    const actions = document.createElement("div");
    actions.className = "nomusic-dialog__actions";
    // The way out first; the action that keeps the music off last, where
    // dialogs put their main action.
    actions.append(this.returnBtn, this.retryBtn);
    keepKeys(panel, { all: true });
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.dismissed = true;
      this.closeRecovery();
      this.render();
      if (shown(this.el)) this.el.focus();
    });
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "click"]) {
      panel.addEventListener(type, (event) => event.stopPropagation());
    }
    panel.append(title, this.recoveryMessage, actions);
    return panel;
  }

  action(name, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nomusic-dialog__action";
    button.dataset.action = name;
    button.addEventListener("click", trusted(() => {
      if (shown(this.el)) this.el.focus();
      handler();
    }));
    return button;
  }

  // Focus moves to the dialog (read out with its reason) unless the user is
  // typing somewhere; Tab then reaches its two choices.
  openRecovery({ focus = false } = {}) {
    if (this.retired) return;
    this.dismissed = false;
    this.recovery.hidden = false;
    this.positionPanel();
    if (focus && !typing()) this.recovery.focus();
  }

  closeRecovery() {
    this.recovery.hidden = true;
    this.recovery.remove();
    this.recovery.style.cssText = "";
    window.removeEventListener("scroll", this.onReposition, true);
    window.removeEventListener("resize", this.onReposition, true);
  }

  // The dialog sits in the middle of the player. A player too small to hold
  // the button gets it over the video instead, on document.body (or the
  // fullscreen element), where the player cannot clip it.
  positionPanel() {
    if (this.recovery.hidden) return;
    const focused = this.recovery.contains(document.activeElement) ? document.activeElement : null;
    if (this.host) {
      if (this.recovery.parentElement !== this.host) {
        this.host.append(this.recovery);
        focused?.focus(); // moving it blurs whatever is focused inside
      }
      this.recovery.classList.remove("nomusic-dialog--floating");
      this.recovery.style.left = this.recovery.style.top = "";
      window.removeEventListener("scroll", this.onReposition, true);
      window.removeEventListener("resize", this.onReposition, true);
      return;
    }
    const layer = document.fullscreenElement ?? document.body;
    if (this.recovery.parentElement !== layer) {
      layer.appendChild(this.recovery);
      focused?.focus();
    }
    this.recovery.classList.add("nomusic-dialog--floating");
    window.addEventListener("scroll", this.onReposition, true);
    window.addEventListener("resize", this.onReposition, true);
    const rect = this.video.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = this.recovery;
    const left = rect.left + (rect.width - width) / 2;
    const top = rect.top + (rect.height - height) / 2;
    this.recovery.style.left = `${Math.round(Math.min(Math.max(8, left), window.innerWidth - 8 - width))}px`;
    this.recovery.style.top = `${Math.round(Math.min(Math.max(8, top), window.innerHeight - 8 - height))}px`;
  }

  // ---- placement ----------------------------------------------------------

  // In the player's own row of buttons when it has one; otherwise in its top
  // corner. The corner button and the chip take the player's direction: an
  // Arabic player puts the chip top-right, where its readers look first.
  position(host) {
    if (this.retired) return;
    this.host = host;
    this.rtl = getComputedStyle(host).direction === "rtl";
    const row = controlRow(host);
    if (row) {
      if (this.el.parentElement !== row.row || this.el.nextElementSibling !== row.before) row.row.insertBefore(this.el, row.before);
      this.el.classList.toggle("ytp-button", row.bar === "ytp");
      this.el.dataset.place = row.bar;
      this.el.style.left = this.el.style.right = "";
    } else {
      if (this.el.parentElement !== host) host.append(this.el);
      this.el.classList.remove("ytp-button");
      this.el.dataset.place = "corner";
      this.el.style.left = this.rtl ? "8px" : "";
      this.el.style.right = this.rtl ? "" : "8px";
    }
    this.el.style.display = !row && minimized(host) ? "none" : "";
    for (const part of [this.live, this.notice]) if (part.parentElement !== host) host.append(part);
    this.notice.style.left = this.rtl ? "" : "16px";
    this.notice.style.right = this.rtl ? "16px" : "";
    // The player got its box back while a failure waits: show the dialog again.
    if (this.session.failure && this.recovery.hidden && !this.dismissed) this.openRecovery();
    else this.positionPanel();
    this.placeTip();
  }

  // Is the button still where position() put it? (YouTube rebuilds its
  // controls, and moves the player into and out of the miniplayer.)
  placed(host) {
    if (!this.el.isConnected || this.host !== host) return false;
    const row = controlRow(host);
    if (row) return this.el.parentElement === row.row;
    return this.el.dataset.place === "corner" && this.el.parentElement === host && (this.el.style.display === "none") === minimized(host);
  }

  // No player big enough for the button, but the video shows and a failure
  // needs a decision: the dialog alone, over the video.
  float() {
    if (this.retired) return;
    this.host = null;
    this.el.style.display = "none";
    this.notice.hidden = true;
    this.hideTip();
    if (this.session.failure && this.recovery.hidden && !this.dismissed) this.openRecovery({ focus: true });
    else this.positionPanel();
  }

  hide() {
    this.host = null;
    this.el.style.display = "none";
    this.notice.hidden = true;
    this.hideTip();
    this.closeRecovery();
  }

  destroy() {
    if (this.retired) return;
    this.retired = true;
    this.closeRecovery();
    for (const part of [this.el, this.live, this.notice, this.tip]) part.remove();
  }
}

// Before the first run, the welcome page turns nomusic on (background.js opens
// or focuses it).
function openWelcome() {
  try {
    chrome.runtime.sendMessage({ type: "open-welcome" }).catch(() => {});
  } catch {
    // The extension was updated or removed under this page.
  }
}
