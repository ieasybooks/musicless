// What nomusic shows on each video: a view of one Session.
// - A button that turns nomusic on or off for the current video. It joins the
//   player's own row of buttons and is drawn as YouTube draws its mute button:
//   a note while the music plays, the note struck through while nomusic
//   removes it. Where a player has no such row (Shorts, other sites' players)
//   it is the same glyph in the player's top corner, shown with the player's
//   controls.
//   Before the first run and after a failure (both wait for the user), it is
//   the plain note with a small dot.
// - In the middle of the video, only while nomusic needs the user to wait or to
//   click: YouTube's spinner, with two words under it, while the first audio is
//   prepared; a round play button when the browser waits for a click before it
//   plays sound.
// - The recovery dialog when nomusic could not remove the music, or, on a
//   video that played before nomusic was turned on, to say that a reload will.

import { setLanguage, t } from "./i18n.js";

// Everything below is resolved while the extension is certainly alive (see
// i18n.js): the "updated" failure shows after it is gone.
const TEXT = {
  remove: t("control_name"),
  restore: t("control_on"),
  setup: t("control_setup"),
  failed: t("control_failed"),
  working: t("notice_working"),
  done: t("notice_done"),
  blocked: t("notice_blocked"),
  title: t("panel_title"),
  ready: t("done_heading"),
  retry: t("panel_retry"),
  reload: t("panel_reload"),
  original: t("panel_original"),
};
// status -> [data-state, the tooltip (what a click does, as YouTube's own
// "Mute" and "Unmute" say), what the live region says]
const STATES = {
  setup: ["setup", TEXT.setup, ""],
  off: ["idle", TEXT.remove, ""],
  starting: ["working", TEXT.restore, TEXT.working],
  buffering: ["working", TEXT.restore, TEXT.working],
  on: ["active", TEXT.restore, ""],
  blocked: ["attention", TEXT.restore, TEXT.blocked],
  failed: ["error", TEXT.failed, ""],
};
const WAITS = new Set(["starting", "buffering"]);
// Failures that no retry and no reload can help: the video's own sound
// (locked, or in a format nomusic cannot read), or a player whose sound it
// cannot reach. The dialog offers only the music.
const FINAL = new Set(["protected", "codec", "source"]);
// A hold shorter than this shows nothing (a short one after a stall would only flicker).
const NOTICE_DELAY_MS = 400;
// The words come with the spinner while a video starts, when nobody knows yet
// why it waits; on later holds (a seek), only if the spinner stays this long.
const WORDS_DELAY_MS = 1500;
// Less motion: our still spinner instead of YouTube's turning one.
const stillness = matchMedia("(prefers-reduced-motion: reduce)");

// The glyph, on YouTube's 24 px grid and in its weight: a note (round head,
// straight stem, square flag), plain while the music plays and struck through
// while nomusic removes it. The struck note is the plain one with a strike
// corner to corner, which cuts a gap through it, wider on its upper side, as
// Material's "off" icons do. tools/icons.mjs draws the mark from the same note. Built
// with DOM calls: YouTube's pages accept only trusted markup.
const SVG = "http://www.w3.org/2000/svg";
// One weight, YouTube's: the stem, the flag's height and the strike are 2 units
// or twice that. The stem is long enough to show above and below the strike.
const NOTE = [
  ["circle", { cx: 9.2, cy: 17.9, r: 4.2 }],
  ["rect", { x: 11.4, y: 1.9, width: 2, height: 16 }],
  ["rect", { x: 11.4, y: 1.9, width: 6.4, height: 4.4 }],
];
// Corner to corner, a little above the diagonal, so that it clears the head.
const STRIKE = "M3.4 2.3 21.4 20.3";
// Bottom right, where the note leaves room: the dot that says nomusic waits for the user.
const DOT = { cx: 19.6, cy: 19.6, r: 2.6 };
// The strike's width (2) with a gap of 1.2 above it and 0.7 below, so that it
// reads as a stroke laid over the note.
const CUT = "M3.58 2.12 21.58 20.12";
const PLAY = "M8 5.5v13l10.5-6.5z";
let glyphs = 0;
function svg(tag, attributes, ...children) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}
const note = (attributes) => svg("g", { fill: "currentColor", ...attributes }, ...NOTE.map(([tag, a]) => svg(tag, a)));
function glyph() {
  const cut = `nomusic-cut-${++glyphs}`;
  return svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
    svg("mask", { id: cut, maskUnits: "userSpaceOnUse" },
      svg("rect", { width: 24, height: 24, fill: "#fff" }),
      svg("path", { d: CUT, stroke: "#000", "stroke-width": 3.9, "stroke-linecap": "round" })),
    note({ class: "nomusic-glyph-plain" }),
    svg("g", { class: "nomusic-glyph-struck" },
      note({ mask: `url(#${cut})` }),
      svg("path", { d: STRIKE, stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", fill: "none" })),
    svg("circle", { class: "nomusic-glyph-dot", ...DOT }));
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
// players (drawn beside the main player, not inside it). Null for players
// without one, or while it is hidden (the miniplayer).
function controlRow(host) {
  const right = host.querySelector(".ytp-right-controls");
  if (shown(right)) {
    const row = right.querySelector(".ytp-right-controls-left") ?? right;
    return { row, before: row.querySelector(".ytp-subtitles-button") ?? row.firstElementChild, bar: "ytp" };
  }
  const top = host.querySelector(".player-controls-top-right") ??
    (host.id === "movie_player" ? document.querySelector("#player-controls .player-controls-top-right") : null);
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
    this.source = null; // the video (its source URL) the first wait belongs to
    this.played = false; // its music has been removed at least once
    this.wantedPlay = false;
    this.host = null;
    this.marked = null; // [player, class]: YouTube's spinner shown for our wait, or hidden under the play button
    this.rtl = false; // the player's direction, which the corners follow

    this.el = setLanguage(document.createElement("button"));
    this.el.type = "button";
    this.el.className = "nomusic-btn";
    this.el.append(glyph());
    keepPointer(this.el);
    keepKeys(this.el);
    this.el.addEventListener("click", trusted(() => {
      const status = this.session.status;
      if (status === "setup") openWelcome();
      else if (this.session.failure) this.openRecovery({ focus: true });
      else if (status === "blocked") {
        // What the tooltip says, "Stop removing music"; the click also lets
        // the page play sound, so the music is heard. The play button in the
        // middle is the way to start the sound with the music removed.
        this.session.toggle();
        this.session.returnToOriginal();
      } else this.session.toggle();
      this.showTip();
    }));
    // A play attempt while a failure waits for the user's choice (the dialog
    // was closed) brings the choice back. Our own hold re-pauses the video, so
    // nothing is heard (fail closed); the intent stays "play", so this listens
    // for each attempt rather than for a change of intent.
    this.onPlay = () => {
      if (!this.retired && this.session.failure && this.dismissed) this.openRecovery({ focus: true });
    };
    video.addEventListener("play", this.onPlay);
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
    const [state, tip, says] = STATES[status] ?? STATES.off;
    if (this.el.dataset.state !== state) this.el.dataset.state = state;
    this.el.dataset.nomusicStatus = status;
    // A toggle while it is one (named for what it does, pressed while it does
    // it); setup and a failure open something instead.
    const toggle = status !== "setup" && status !== "failed";
    const pressed = toggle ? String(session.on) : null;
    if (this.el.getAttribute("aria-pressed") !== pressed) {
      if (pressed === null) this.el.removeAttribute("aria-pressed");
      else this.el.setAttribute("aria-pressed", pressed);
    }
    const name = toggle ? TEXT.remove : tip;
    if (this.el.getAttribute("aria-label") !== name) this.el.setAttribute("aria-label", name);
    if (this.tip.textContent !== tip) {
      this.tip.textContent = tip;
      this.placeTip();
    }
    if (status !== this.announced) {
      // The end of a wait is said once; other statuses say what their row says.
      this.live.textContent = status === "on" && WAITS.has(this.announced) ? TEXT.done : says;
      this.announced = status;
    }
    // A video's first wait lasts until its music is first removed (the
    // session counts made audio across videos in one player).
    if (session.sourceUrl !== this.source) {
      this.source = session.sourceUrl;
      this.played = false;
    }
    if (status === "on") this.played = true;
    this.renderNotice(state, says, !this.played);
    if (session.failure !== this.shownFailure) {
      this.shownFailure = session.failure;
      this.dismissed = false;
      if (session.failure) {
        const { reason, message } = session.failure;
        // A video that played before nomusic was turned on did not fail: the
        // dialog says that nomusic is on, and that a reload will do.
        this.recoveryTitle.textContent = reason === "missed" ? TEXT.ready : TEXT.title;
        // The title already says what happened; a reason without more to say is left out.
        this.recoveryMessage.textContent = reason === "error" ? "" : message;
        // Where nothing can help (a locked video, say), the music is the one
        // choice left, so it becomes the main action.
        const final = FINAL.has(reason);
        this.retryBtn.hidden = final;
        this.retryBtn.textContent = session.retryReloads ? TEXT.reload : TEXT.retry;
        this.returnBtn.classList.toggle("nomusic-dialog__action--main", final);
        this.openRecovery({ focus: true });
      } else {
        this.closeRecovery();
      }
    }
    // Closed without a choice: it comes back when the user tries to play (a
    // play event, above, or a page reporting the intent).
    const wantsPlay = !!session.intent?.wantsPlay;
    if (session.failure && this.dismissed && wantsPlay && !this.wantedPlay) this.openRecovery({ focus: true });
    this.wantedPlay = wantsPlay;
  }

  // ---- the wait and the click --------------------------------------------------

  // One layer over the video, below YouTube's controls. The wait: YouTube's
  // spinner where YouTube draws it, and two words under it, where the eye
  // already is; clicks go through to the video. The click: the whole video is
  // the button, a round play button in the middle its sign.
  buildNotice() {
    const notice = setLanguage(document.createElement("button"));
    notice.type = "button";
    notice.className = "nomusic-notice";
    notice.hidden = true;
    notice.tabIndex = -1;
    const half = () => {
      const part = document.createElement("span");
      part.className = "nomusic-spinner__half";
      const arc = document.createElement("span");
      arc.className = "nomusic-spinner__arc";
      part.append(arc);
      return part;
    };
    const spinner = document.createElement("span");
    spinner.className = "nomusic-spinner";
    const rotator = document.createElement("span");
    rotator.className = "nomusic-spinner__rotator";
    rotator.append(half(), half());
    spinner.append(rotator);
    const disc = document.createElement("span");
    disc.className = "nomusic-notice__disc";
    disc.append(icon(PLAY));
    this.noticeText = document.createElement("span");
    this.noticeText.className = "nomusic-notice__text";
    notice.append(spinner, disc, this.noticeText);
    keepPointer(notice);
    keepKeys(notice);
    notice.addEventListener("click", trusted(() => {
      if (this.session.status === "blocked") this.session.toggle();
    }));
    return notice;
  }

  renderNotice(state, text, first) {
    const now = performance.now();
    if (state === "working") this.workingSince ??= now;
    else this.workingSince = null;
    const working = state === "working" && now - this.workingSince >= NOTICE_DELAY_MS;
    const words = String(working && (first || now - this.workingSince >= WORDS_DELAY_MS));
    if (this.notice.dataset.words !== words) this.notice.dataset.words = words;
    const blocked = state === "attention";
    const show = (working || blocked) && !!this.host;
    if (this.notice.hidden === show) this.notice.hidden = !show;
    // Where the player has YouTube's spinner, the wait shows that one (the one
    // it shows while loading, so the two never differ); ours is for other
    // players, and for anyone who asks for less motion (it stands still).
    // While the play button asks for the click, YouTube's stays out.
    const theirs = !stillness.matches && !!this.host?.querySelector(".ytp-spinner");
    this.markHost(show ? this.host : null, blocked ? "nomusic-blocked" : theirs ? "nomusic-waiting" : null);
    if (!show) return;
    if (this.notice.dataset.theirs !== String(theirs)) this.notice.dataset.theirs = String(theirs);
    if (this.noticeText.textContent !== text) this.noticeText.textContent = text;
    const kind = blocked ? "action" : "status";
    if (this.notice.dataset.kind !== kind) {
      this.notice.dataset.kind = kind;
      // The wait is read out by the live region; the play button is a button,
      // named by its text.
      this.notice.tabIndex = blocked ? 0 : -1;
      if (blocked) this.notice.removeAttribute("aria-hidden");
      else this.notice.setAttribute("aria-hidden", "true");
    }
  }

  markHost(host, mark = null) {
    const [was, wasMark] = this.marked ?? [];
    if (was === host && wasMark === mark) return;
    if (wasMark) was.classList.remove(wasMark);
    if (host && mark) host.classList.add(mark);
    this.marked = host && mark ? [host, mark] : null;
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
    panel.hidden = true;
    panel.tabIndex = -1; // focused itself when its one action is the music (see openRecovery)
    const title = document.createElement("p");
    title.className = "nomusic-dialog__title";
    title.id = `${id}-title`;
    title.textContent = TEXT.title;
    this.recoveryTitle = title;
    this.recoveryMessage = document.createElement("p");
    this.recoveryMessage.className = "nomusic-dialog__message";
    this.recoveryMessage.id = `${id}-message`;
    this.retryBtn = this.action("retry", () => this.session.retry());
    this.retryBtn.classList.add("nomusic-dialog__action--main");
    this.returnBtn = this.action("original", () => this.session.returnToOriginal());
    this.returnBtn.textContent = TEXT.original;
    const actions = document.createElement("div");
    actions.className = "nomusic-dialog__actions";
    // The way out first, as a quiet text button; the action that keeps the
    // music off last, where dialogs put their main one, and focused.
    actions.append(this.returnBtn, this.retryBtn);
    keepKeys(panel, { all: true });
    // While it is open, wherever focus is: Escape closes it, Tab moves between
    // its two actions.
    this.onKeys = (event) => {
      if (this.recovery.hidden) return;
      if (event.key === "Escape" && !typing()) {
        event.preventDefault();
        event.stopPropagation();
        this.dismiss();
      } else if (event.key === "Tab") {
        const order = [this.returnBtn, this.retryBtn].filter((action) => !action.hidden);
        const at = order.indexOf(document.activeElement);
        event.preventDefault();
        event.stopPropagation();
        order[at < 0 ? order.length - 1 : (at + 1) % order.length].focus();
      }
    };
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "click"]) {
      panel.addEventListener(type, (event) => event.stopPropagation());
    }
    panel.append(title, this.recoveryMessage, actions);
    // Over the video around it, a clear layer (below YouTube's own controls): a
    // click there closes the dialog, as Escape does; the video stays paused.
    this.scrim = document.createElement("div");
    this.scrim.className = "nomusic-scrim";
    keepPointer(this.scrim);
    this.scrim.addEventListener("click", trusted(() => this.dismiss()));
    return panel;
  }

  // Closed without a choice: the video stays paused and silent, and the
  // choice returns on the next play attempt.
  dismiss() {
    this.dismissed = true;
    this.closeRecovery();
    if (shown(this.el)) this.el.focus();
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

  // Focus moves to the main action (the dialog is read out with its reason)
  // unless the user is typing somewhere. When the music is the only choice,
  // the dialog itself takes focus: a Space or Enter meant for the video must
  // not start the music.
  openRecovery({ focus = false } = {}) {
    if (this.retired) return;
    this.dismissed = false;
    this.recovery.hidden = false;
    document.addEventListener("keydown", this.onKeys, true);
    this.positionPanel();
    if (focus && !typing()) (this.retryBtn.hidden ? this.recovery : this.retryBtn).focus();
  }

  closeRecovery() {
    document.removeEventListener("keydown", this.onKeys, true);
    this.recovery.hidden = true;
    this.recovery.remove();
    this.scrim.remove();
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
        this.host.append(this.scrim, this.recovery);
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
      this.scrim.remove();
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
  // corner, on the inline-end side of the player's direction.
  position(host) {
    if (this.retired) return;
    this.host = host;
    if (this.marked) this.markHost(host, this.marked[1]);
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
    this.markHost(null);
    this.hideTip();
    if (this.session.failure && this.recovery.hidden && !this.dismissed) this.openRecovery({ focus: true });
    else this.positionPanel();
  }

  hide() {
    this.host = null;
    this.el.style.display = "none";
    this.notice.hidden = true;
    this.markHost(null);
    this.hideTip();
    this.closeRecovery();
  }

  destroy() {
    if (this.retired) return;
    this.retired = true;
    this.closeRecovery();
    this.markHost(null);
    this.video.removeEventListener("play", this.onPlay);
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
