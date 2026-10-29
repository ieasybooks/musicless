// What Musicless shows on each video: a view of one Session.
// - A button that turns Musicless on or off for the current video, in the
//   player's own row of buttons (YouTube's bar, an embed's or a Short's top
//   row), else in its top corner: a note while the music plays, struck through
//   while Musicless removes it, as YouTube draws mute; with a small dot while
//   Musicless waits for the user (before the first run, after a failure).
// - In the middle of the video, only while Musicless needs the user to wait or to
//   click: YouTube's spinner with two words under it while the first audio is
//   prepared; a round play button when the browser waits for a click to play
//   sound.
// - The recovery dialog when Musicless could not remove the music, or, on a
//   video that played before Musicless was turned on, to say that a reload will.

import { setLanguage, t } from "./i18n.js";

// Everything below is resolved while the extension is certainly alive (see
// i18n.js): the "updated" failure shows after it is gone.
const TEXT = {
  remove: t("control_name"),
  restore: t("control_on"),
  working: t("notice_working"),
  done: t("notice_done"),
  title: t("panel_title"),
  ready: t("done_heading"),
  retry: t("panel_retry"),
  reload: t("panel_reload"),
  original: t("panel_original"),
};
// status -> [data-state, the tooltip (what a click does, as YouTube's own
// "Mute" and "Unmute" say), what the live region says]
const STATES = {
  setup: ["setup", t("control_setup"), ""],
  off: ["idle", TEXT.remove, ""],
  starting: ["working", TEXT.restore, TEXT.working],
  buffering: ["working", TEXT.restore, TEXT.working],
  on: ["active", TEXT.restore, ""],
  blocked: ["attention", TEXT.restore, t("notice_blocked")],
  failed: ["error", TEXT.remove, ""],
};
const WAITS = new Set(["starting", "buffering"]);
// Failures that no retry and no reload can help: the video's own sound
// (locked, or in a format Musicless cannot read), or a player whose sound it
// cannot reach. The dialog offers only the music.
const FINAL = new Set(["protected", "codec", "source"]);
// A hold shorter than this shows nothing (a short one after a stall would only flicker).
const NOTICE_DELAY_MS = 400;
// The words come with the spinner while a video starts, when nobody knows yet
// why it waits; on later holds (a seek), only if the spinner stays this long.
const WORDS_DELAY_MS = 1500;
// Less motion: our still spinner instead of YouTube's turning one.
const stillness = matchMedia("(prefers-reduced-motion: reduce)");

// The glyph, on YouTube's 24 px grid and in its 2-unit weight: a note (round
// head, straight stem, square flag), plain while the music plays; struck through
// while Musicless removes it, the strike a little above the diagonal so it clears
// the head, cutting a gap 1.2 units above it and 0.7 below, as Material's "off"
// icons do; and a dot at the bottom right while Musicless waits for the user.
// tools/icons.mjs draws the player's glyphs from the same note. Built with DOM
// calls: YouTube's pages accept only trusted markup.
const SVG = "http://www.w3.org/2000/svg";
const NOTE = [
  ["circle", { cx: 9.2, cy: 17.9, r: 4.2 }],
  ["rect", { x: 11.4, y: 1.9, width: 2, height: 16 }],
  ["rect", { x: 11.4, y: 1.9, width: 6.4, height: 4.4 }],
];
const STRIKE = "M3.4 2.3 21.4 20.3";
const CUT = "M3.58 2.12 21.58 20.12";
const DOT = { cx: 19.6, cy: 19.6, r: 2.6 };
const PLAY = "M8 5.5v13l10.5-6.5z";
let glyphs = 0;
function svg(tag, attributes, ...children) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}
// An HTML element with its properties set and its children in it.
function html(tag, properties, ...children) {
  const element = Object.assign(document.createElement(tag), properties);
  element.append(...children);
  return element;
}
const note = (attributes) => svg("g", { fill: "currentColor", ...attributes }, ...NOTE.map(([tag, a]) => svg(tag, a)));
function glyph() {
  const cut = `musicless-cut-${++glyphs}`;
  return svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
    svg("mask", { id: cut, maskUnits: "userSpaceOnUse" },
      svg("rect", { width: 24, height: 24, fill: "#fff" }),
      svg("path", { d: CUT, stroke: "#000", "stroke-width": 3.9, "stroke-linecap": "round" })),
    note({ class: "musicless-glyph-plain" }),
    svg("g", { class: "musicless-glyph-struck" },
      note({ mask: `url(#${cut})` }),
      svg("path", { d: STRIKE, stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", fill: "none" })),
    svg("circle", { class: "musicless-glyph-dot", ...DOT }));
}

// Only the user's own clicks operate Musicless, never ones the page dispatches.
const trusted = (handler) => (event) => {
  event.stopPropagation();
  event.preventDefault();
  if (event.isTrusted) handler(event);
};
// Keep the player from treating clicks on our controls as clicks on the video
// (play/pause, double-click fullscreen).
function keepPointer(element, ...more) {
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", ...more]) {
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
// Set an attribute, or remove it for null, touching the DOM only on a change.
function attr(element, name, value) {
  if (value === null) element.removeAttribute(name);
  else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

// The player's own row of buttons, when it shows one: YouTube's control bar
// (the button goes before captions), or the top row of the embedded and mobile
// players (drawn beside the main player, not inside it). Null for players
// without one, or while it is hidden (the miniplayer).
function controlRow(host) {
  const right = host.querySelector(".ytp-right-controls");
  if (shown(right)) {
    const row = right.querySelector(".ytp-right-controls-left") ?? right;
    return { row, before: childHolding(row, row.querySelector(".ytp-subtitles-button")), bar: "ytp" };
  }
  // Shorts: the active Short's own row at its top, before captions, its menu
  // and fullscreen; it shows and hides with that row.
  const shorts = host.closest("ytd-reel-video-renderer")?.querySelector("ytd-shorts-player-controls #right-controls");
  if (shorts) return { row: shorts, before: shorts.firstElementChild, bar: "top" };
  const top = host.querySelector(".player-controls-top-right") ??
    (host.id === "movie_player" ? document.querySelector("#player-controls .player-controls-top-right") : null);
  if (top) {
    const captions = [...top.children].find((child) => child.querySelector?.("[class*='ClosedCaptioning']"));
    return { row: top, before: captions ?? top.firstElementChild, bar: "top" };
  }
  return null;
}
// The row's own child that holds `element`, else its first child: YouTube may
// wrap a button in a container, and only a child of the row can be the place
// to insert before.
function childHolding(row, element) {
  while (element && element.parentElement !== row) element = element.parentElement;
  return element ?? row.firstElementChild;
}
// Does YouTube's spinner really show (it may be hidden some other way than the
// one musicless-waiting undoes)?
function renders(element) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
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
    this.host = null;
    this.marked = null; // [player, class]: YouTube's spinner shown for our wait, or hidden under the play button
    this.unseen = null; // YouTube's spinner, if it did not show when marked: ours is drawn instead

    this.el = setLanguage(html("button", { type: "button", className: "musicless-btn" }, glyph()));
    keepPointer(this.el);
    keepKeys(this.el);
    this.el.addEventListener("click", trusted(() => {
      const status = this.session.status;
      if (status === "setup") openWelcome();
      else if (this.session.failure) this.openRecovery({ focus: true });
      else if (status === "blocked") {
        // What the tooltip says, "Restore original sound"; the click also lets
        // the page play sound, so the music is heard. The play button in the
        // middle is the way to start the sound with the music removed.
        this.session.toggle();
        this.session.returnToOriginal();
      } else this.session.toggle();
    }));
    // A play attempt while a failure waits for the user's choice (the dialog
    // was closed) brings the choice back. Our own hold re-pauses the video, so
    // nothing is heard (fail closed); the intent stays "play", so this listens
    // for each attempt rather than for a change of intent. (A page's play()
    // reaches the element too: intent.js passes it on.)
    this.onPlay = () => {
      if (!this.retired && this.session.failure && this.dismissed) this.openRecovery({ focus: true });
    };
    video.addEventListener("play", this.onPlay);
    // A tooltip in the player's own style, on hover and on keyboard focus.
    this.tip = setLanguage(html("div", { className: "musicless-tip", hidden: true }));
    this.tip.setAttribute("aria-hidden", "true");
    this.el.addEventListener("pointerenter", () => this.showTip());
    this.el.addEventListener("pointerleave", () => this.hideTip());
    this.el.addEventListener("focus", () => {
      if (this.el.matches(":focus-visible")) this.showTip();
    });
    this.el.addEventListener("blur", () => this.hideTip());

    // Status changes for screen readers: a live region beside the button (one
    // inside a button is unreliable), written only when the status changes.
    this.live = setLanguage(html("span", { className: "musicless-sr-only" }));
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
    if (this.el.dataset.musiclessStatus !== status) this.el.dataset.musiclessStatus = status;
    // A toggle while it is one (named for what it does, pressed while it does
    // it); setup and a failure open something instead.
    const toggle = status !== "setup" && status !== "failed";
    attr(this.el, "aria-pressed", toggle ? String(session.on) : null);
    attr(this.el, "aria-label", toggle ? TEXT.remove : tip);
    if (this.tip.textContent !== tip) {
      this.tip.textContent = tip;
      this.placeTip();
    }
    // The end of a wait is said once; other statuses say what their row says.
    const waited = status === "on" && WAITS.has(this.announced);
    if (status !== this.announced) {
      this.live.textContent = waited ? TEXT.done : says;
      this.announced = status;
    }
    // A video's first wait lasts until it ends in removed music (the session
    // counts made audio across videos in one player, and a video can show "on"
    // for a moment before its first hold).
    if (session.sourceUrl !== this.source) {
      this.source = session.sourceUrl;
      this.played = false;
    }
    if (waited) this.played = true;
    this.renderNotice(state, says, !this.played);
    if (session.failure !== this.shownFailure) {
      this.shownFailure = session.failure;
      if (session.failure) {
        const { reason, message } = session.failure;
        // A video that played before Musicless was turned on did not fail: the
        // dialog says that Musicless is on, and that a reload will do.
        this.recoveryTitle.textContent = reason === "missed" ? TEXT.ready : TEXT.title;
        // The title already says what happened; a reason without more to say is left out.
        this.recoveryMessage.textContent = reason === "error" ? "" : message;
        attr(this.recovery, "aria-describedby", this.recoveryMessage.textContent ? this.recoveryMessage.id : null);
        // Where nothing can help (a locked video, say), the music is the one
        // choice left, so it becomes the main action.
        const final = FINAL.has(reason);
        this.retryBtn.hidden = final;
        this.retryBtn.textContent = session.retryReloads ? TEXT.reload : TEXT.retry;
        this.returnBtn.classList.toggle("musicless-dialog__action--main", final);
        this.openRecovery({ focus: true });
      } else {
        this.closeRecovery();
      }
    }
  }

  // ---- the wait and the click --------------------------------------------------

  // One layer over the video, below YouTube's controls. The wait: YouTube's
  // spinner where YouTube draws it, and two words under it, where the eye
  // already is; clicks go through to the video. The click: the whole video is
  // the button, a round play button in the middle its sign.
  buildNotice() {
    const play = svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" }, svg("path", { d: PLAY, fill: "currentColor" }));
    this.noticeText = html("span", { className: "musicless-notice__text" });
    const notice = setLanguage(html("button", { type: "button", className: "musicless-notice", hidden: true, tabIndex: -1 },
      html("span", { className: "musicless-spinner" }), html("span", { className: "musicless-notice__disc" }, play), this.noticeText));
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
    const spinner = this.host?.querySelector(".ytp-spinner");
    const marked = !!spinner && this.marked?.[0] === this.host && this.marked[1] === "musicless-waiting";
    if (marked && renders(this.host) && !renders(spinner)) this.unseen = spinner;
    const theirs = !stillness.matches && !!spinner && spinner !== this.unseen;
    this.markHost(show ? this.host : null, blocked ? "musicless-blocked" : theirs ? "musicless-waiting" : null);
    if (!show) return;
    if (this.notice.dataset.theirs !== String(theirs)) this.notice.dataset.theirs = String(theirs);
    if (this.noticeText.textContent !== text) this.noticeText.textContent = text;
    const kind = blocked ? "action" : "status";
    if (this.notice.dataset.kind !== kind) {
      this.notice.dataset.kind = kind;
      // The wait is read out by the live region; the play button is a button,
      // named by its text.
      this.notice.tabIndex = blocked ? 0 : -1;
      attr(this.notice, "aria-hidden", blocked ? null : "true");
    }
  }

  markHost(host, mark = null) {
    const [was, wasMark] = this.marked ?? [];
    if (was === host && wasMark === mark) {
      if (mark && !host.classList.contains(mark)) host.classList.add(mark); // the player rewrote its classes
      return;
    }
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
    const id = `musicless-dialog-${++dialogs}`;
    // Its title and reason are written by render(), before it first shows.
    this.recoveryTitle = html("p", { className: "musicless-dialog__title", id: `${id}-title` });
    this.recoveryMessage = html("p", { className: "musicless-dialog__message", id: `${id}-message` });
    this.retryBtn = this.action("retry", () => this.session.retry());
    this.retryBtn.classList.add("musicless-dialog__action--main");
    this.returnBtn = this.action("original", () => this.session.returnToOriginal());
    this.returnBtn.textContent = TEXT.original;
    // The way out first, as a quiet text button; the action that keeps the
    // music off last, where dialogs put their main one, and focused. The
    // dialog itself is focused when its one action is the music (openRecovery).
    const panel = setLanguage(html("div", { className: "musicless-dialog", hidden: true, tabIndex: -1 }, this.recoveryTitle,
      this.recoveryMessage, html("div", { className: "musicless-dialog__actions" }, this.returnBtn, this.retryBtn)));
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("aria-labelledby", this.recoveryTitle.id);
    keepKeys(panel, { all: true });
    // Escape closes it; Tab cycles its actions only while focus is inside.
    this.onKeys = (event) => {
      const escape = event.key === "Escape" && !typing();
      const tab = event.key === "Tab" && this.recovery.contains(document.activeElement);
      if (this.recovery.hidden || !(escape || tab)) return;
      event.preventDefault();
      event.stopPropagation();
      if (escape) return this.dismiss();
      const order = [this.returnBtn, this.retryBtn].filter((action) => !action.hidden);
      const at = order.indexOf(document.activeElement);
      order[at < 0 ? order.length - 1 : (at + 1) % order.length].focus();
    };
    keepPointer(panel, "click");
    // Over the video around it, a clear layer (below YouTube's own controls): a
    // click there closes the dialog, as Escape does; the video stays paused.
    this.scrim = html("div", { className: "musicless-scrim" });
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
    const button = html("button", { type: "button", className: "musicless-dialog__action" });
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
    this.follow(false);
  }

  // A floating dialog follows the video as the page scrolls or resizes.
  follow(on) {
    for (const type of ["scroll", "resize"]) {
      if (on) window.addEventListener(type, this.onReposition, true);
      else window.removeEventListener(type, this.onReposition, true);
    }
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
      this.recovery.classList.remove("musicless-dialog--floating");
      this.recovery.style.left = this.recovery.style.top = "";
      this.follow(false);
      return;
    }
    const layer = document.fullscreenElement ?? document.body;
    if (this.recovery.parentElement !== layer) {
      this.scrim.remove();
      layer.appendChild(this.recovery);
      focused?.focus();
    }
    this.recovery.classList.add("musicless-dialog--floating");
    this.follow(true);
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
    const row = controlRow(host);
    let inRow = !!row;
    try {
      if (row && row.before !== this.el && (this.el.parentElement !== row.row || this.el.nextElementSibling !== row.before)) {
        row.row.insertBefore(this.el, row.before);
      }
    } catch {
      inRow = false; // whatever YouTube changed in its row, the corner still works
    }
    if (inRow) {
      this.el.classList.toggle("ytp-button", row.bar === "ytp");
      this.el.dataset.place = row.bar;
      this.el.style.left = this.el.style.right = "";
    } else {
      if (this.el.parentElement !== host) host.append(this.el);
      this.el.classList.remove("ytp-button");
      this.el.dataset.place = "corner";
      const rtl = getComputedStyle(host).direction === "rtl";
      this.el.style.left = rtl ? "8px" : "";
      this.el.style.right = rtl ? "" : "8px";
    }
    this.el.style.display = !inRow && minimized(host) ? "none" : "";
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
    this.leavePlayer();
    if (this.session.failure && this.recovery.hidden && !this.dismissed) this.openRecovery({ focus: true });
    else this.positionPanel();
  }

  hide() {
    this.leavePlayer();
    this.closeRecovery();
  }

  leavePlayer() {
    this.host = null;
    this.el.style.display = "none";
    this.notice.hidden = true;
    this.markHost(null);
    this.hideTip();
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

// Before the first run, the welcome page turns Musicless on (background.js opens
// or focuses it).
function openWelcome() {
  try {
    chrome.runtime.sendMessage({ type: "open-welcome" }).catch(() => {});
  } catch {
    // The extension was updated or removed under this page.
  }
}
