// The nomusic button on each video, and its recovery panel. A view of one
// Session: it shows the session's status and turns nomusic on or off for the
// current video.

import { setLanguage, t } from "./i18n.js";

// Everything below is resolved while the extension is certainly alive (see
// i18n.js): the "updated" failure shows after it is gone.
const ICON = chrome.runtime.getURL("icons/button.png");
// status -> [data-state, visible label (also the accessible name), tooltip]
const LABELS = {
  setup: ["idle", t("button_setup"), t("button_setup_title")],
  off: ["idle", t("button_off"), t("button_off_title")],
  starting: ["working", t("button_starting"), t("button_starting_title")],
  buffering: ["working", t("button_buffering"), t("button_buffering_title")],
  on: ["active", t("button_on"), t("button_on_title")],
  blocked: ["attention", t("button_blocked"), t("button_blocked_title")],
  failed: ["error", t("button_failed"), t("button_failed_title")],
};
const PANEL = { note: t("panel_note"), retry: t("panel_retry"), reload: t("panel_reload"), original: t("panel_original") };

// Only the user's own clicks operate nomusic, never ones the page dispatches.
const trusted = (handler) => (event) => {
  event.stopPropagation();
  event.preventDefault();
  if (event.isTrusted) handler(event);
};
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
let panels = 0;

export class Button {
  constructor(video, session) {
    this.video = video;
    this.session = session;
    this.retired = false;
    this.shownFailure = null;
    this.announced = null;
    this.rtl = false; // the player's direction, which the corner follows
    this.el = setLanguage(document.createElement("button"));
    this.el.className = "nomusic-btn";
    this.el.type = "button";
    this.icon = document.createElement("img");
    this.icon.className = "nomusic-btn__icon";
    this.icon.src = ICON;
    this.icon.alt = "";
    // Lock the icon's box with inline !important: some sites force-size every
    // <img> with high-specificity !important rules that would otherwise blow
    // the wordmark up across the video.
    for (const [key, value] of Object.entries({
      width: "28px", height: "14px", "max-width": "28px", "max-height": "14px", "min-width": "0", "min-height": "0",
    })) {
      this.icon.style.setProperty(key, value, "important");
    }
    this.label = document.createElement("span");
    this.label.className = "nomusic-btn__label";
    this.el.append(this.icon, this.label);
    // Status changes for screen readers: a live region beside the button (one
    // inside a button is unreliable), written only when the status changes.
    this.live = setLanguage(document.createElement("span"));
    this.live.className = "nomusic-sr-only";
    this.live.setAttribute("role", "status");
    // Keep the player from treating clicks on the button as clicks on the video
    // (play/pause, double-click fullscreen).
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick"]) {
      this.el.addEventListener(type, (event) => event.stopPropagation());
    }
    keepKeys(this.el);
    this.el.addEventListener("click", trusted(() => {
      if (this.session.status === "setup") openWelcome();
      else if (this.session.failure) this.openRecovery({ focus: true });
      else this.session.toggle();
    }));
    this.recovery = this.buildRecovery();
    this.onReposition = () => this.positionPanel();
    this.render();
  }

  render() {
    if (this.retired) return;
    const session = this.session;
    const [state, label, title] = LABELS[session.status] ?? LABELS.off;
    if (this.el.dataset.state !== state) this.el.dataset.state = state;
    if (this.label.textContent !== label) this.label.textContent = label;
    if (this.el.title !== title) this.el.title = title; // the label is the name; the title describes it
    this.el.dataset.nomusicStatus = session.status;
    if (session.status !== this.announced) {
      this.announced = session.status;
      this.live.textContent = label;
    }
    if (session.failure !== this.shownFailure) {
      this.shownFailure = session.failure;
      if (session.failure) {
        this.recoveryMessage.textContent = session.failure.message;
        this.retryBtn.textContent = session.retryReloads ? PANEL.reload : PANEL.retry;
        this.openRecovery({ focus: true });
      } else {
        this.closeRecovery();
      }
    }
  }

  buildRecovery() {
    const id = `nomusic-recovery-${++panels}`;
    const panel = setLanguage(document.createElement("div"));
    panel.className = "nomusic-menu nomusic-recovery";
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("aria-labelledby", `${id}-message`);
    panel.setAttribute("aria-describedby", `${id}-note`);
    panel.hidden = true;
    this.recoveryMessage = document.createElement("p");
    this.recoveryMessage.className = "nomusic-recovery__message";
    this.recoveryMessage.id = `${id}-message`;
    const note = document.createElement("p");
    note.className = "nomusic-recovery__message nomusic-recovery__note";
    note.id = `${id}-note`;
    note.textContent = PANEL.note;
    this.retryBtn = this.action("retry", () => this.session.retry());
    this.returnBtn = this.action("original", () => this.session.returnToOriginal());
    this.returnBtn.textContent = PANEL.original;
    keepKeys(panel, { all: true });
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.closeRecovery();
      this.el.focus();
    });
    for (const type of ["pointerdown", "mousedown", "mouseup", "dblclick", "click"]) {
      panel.addEventListener(type, (event) => event.stopPropagation());
    }
    panel.append(this.recoveryMessage, note, this.retryBtn, this.returnBtn);
    return panel;
  }

  action(name, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nomusic-menu__item";
    button.dataset.action = name;
    button.addEventListener("click", trusted(() => {
      this.el.focus();
      handler();
    }));
    return button;
  }

  // Focus moves into the panel unless the user is typing somewhere.
  openRecovery({ focus = false } = {}) {
    if (this.retired) return;
    this.recovery.hidden = false;
    this.positionPanel();
    window.addEventListener("scroll", this.onReposition, true);
    window.addEventListener("resize", this.onReposition, true);
    if (focus && !typing()) this.retryBtn.focus();
  }

  closeRecovery() {
    this.recovery.hidden = true;
    this.recovery.remove();
    window.removeEventListener("scroll", this.onReposition, true);
    window.removeEventListener("resize", this.onReposition, true);
  }

  // The panel lives on document.body, or on the fullscreen element while there
  // is one, under the button and aligned with its outer edge. Without a button
  // (a player too small for one) it sits in the video's own top corner.
  positionPanel() {
    if (this.recovery.hidden) return;
    const host = document.fullscreenElement ?? document.body;
    if (this.recovery.parentElement !== host) {
      // Moving the panel blurs whatever is focused inside it: focus it again.
      const focused = this.recovery.contains(document.activeElement) ? document.activeElement : null;
      host.appendChild(this.recovery);
      focused?.focus();
    }
    const pill = this.el.isConnected && this.el.style.display !== "none";
    const rect = (pill ? this.el : this.video).getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = this.recovery;
    let top = pill ? rect.bottom + 6 : rect.top + 8;
    if (top + height > window.innerHeight - 8) top = pill ? rect.top - 6 - height : window.innerHeight - 8 - height;
    const inset = pill ? 0 : 8;
    const left = this.rtl ? rect.left + inset : rect.right - inset - width;
    this.recovery.style.left = `${Math.round(Math.min(Math.max(8, left), window.innerWidth - 8 - width))}px`;
    this.recovery.style.top = `${Math.round(Math.max(8, top))}px`;
  }

  // Anchor in the player's top corner on the inline-end side of the player's
  // own direction (an Arabic player puts it top-left, where its readers look
  // first). content.css keeps it clear of YouTube's own top buttons.
  position(host) {
    if (this.retired) return;
    if (this.el.parentElement !== host) host.append(this.el, this.live);
    this.rtl = getComputedStyle(host).direction === "rtl";
    this.el.style.left = this.rtl ? "12px" : "";
    this.el.style.right = this.rtl ? "" : "12px";
    this.el.style.display = "";
    // The player got its box back while a failure waits: show the panel again.
    if (this.session.failure && this.recovery.hidden) this.openRecovery();
    else this.positionPanel();
  }

  // No player big enough for the button, but the video shows and a failure
  // needs a decision: the panel alone, over the video.
  float() {
    if (this.retired) return;
    this.el.style.display = "none";
    this.rtl = getComputedStyle(this.video).direction === "rtl";
    if (this.session.failure && this.recovery.hidden) this.openRecovery({ focus: true });
    else this.positionPanel();
  }

  hide() {
    this.el.style.display = "none";
    this.closeRecovery();
  }

  destroy() {
    if (this.retired) return;
    this.retired = true;
    this.closeRecovery();
    this.el.remove();
    this.live.remove();
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
