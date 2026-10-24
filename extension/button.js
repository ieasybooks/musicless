// The nomusic button on each video, and its recovery panel. A view of one
// Session: it shows the session's status and turns nomusic on or off for the
// current video. Adapted from the main nomusic extension's button.

const LABELS = {
  off: ["idle", "nomusic", "Remove the music from this video"],
  starting: ["working", "Starting…", "nomusic is preparing this video's audio"],
  buffering: ["working", "Preparing…", "nomusic is preparing the next part of the audio"],
  on: ["active", "nomusic on", "Music removed. Click to hear the original audio."],
  blocked: ["attention", "Click for sound", "Your browser is waiting for a click before it plays sound"],
  failed: ["error", "Music not removed", "nomusic couldn't remove the music. Choose Retry or Return to original."],
};

export class Button {
  constructor(video, session) {
    this.video = video;
    this.session = session;
    this.retired = false;
    this.dismissed = false;
    this.shownFailure = null;
    this.el = document.createElement("button");
    this.el.className = "nomusic-btn";
    this.el.type = "button";
    this.icon = document.createElement("img");
    this.icon.className = "nomusic-btn__icon";
    this.icon.src = chrome.runtime.getURL("icons/button.png");
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
    this.label.setAttribute("aria-live", "polite");
    this.label.setAttribute("aria-atomic", "true");
    this.dismissBtn = document.createElement("span");
    this.dismissBtn.className = "nomusic-btn__dismiss";
    this.dismissBtn.setAttribute("role", "button");
    this.dismissBtn.setAttribute("aria-label", "Hide the nomusic button on this video");
    this.dismissBtn.title = "Hide this button (nomusic keeps working)";
    this.dismissBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      this.dismiss();
    });
    this.el.append(this.icon, this.label, this.dismissBtn);
    // Keep the player from treating clicks on the button as clicks on the video
    // (play/pause, double-click fullscreen).
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick"]) {
      this.el.addEventListener(type, (event) => event.stopPropagation());
    }
    this.el.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (this.session.failure) this.openRecovery({ focus: true });
      else this.session.toggle();
    });
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
    if (this.el.title !== title) this.el.title = title;
    this.el.dataset.nomusicStatus = session.status;
    this.el.setAttribute("aria-pressed", String(session.on));
    if (session.failure !== this.shownFailure) {
      this.shownFailure = session.failure;
      if (session.failure) {
        this.recoveryMessage.textContent = session.failure.message;
        this.retryBtn.textContent = session.failure.reason === "updated" ? "Reload page" : "Retry";
        this.dismissed = false;
        this.el.style.display = "";
        this.openRecovery();
      } else {
        this.closeRecovery();
      }
    }
  }

  buildRecovery() {
    const panel = document.createElement("div");
    panel.className = "nomusic-menu nomusic-recovery";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "nomusic could not remove the music");
    panel.hidden = true;
    this.recoveryMessage = document.createElement("p");
    this.recoveryMessage.className = "nomusic-recovery__message";
    const explanation = document.createElement("p");
    explanation.className = "nomusic-recovery__message nomusic-recovery__note";
    explanation.textContent = "The original audio stays off until you choose.";
    this.retryBtn = document.createElement("button");
    this.retryBtn.type = "button";
    this.retryBtn.className = "nomusic-menu__item";
    this.retryBtn.textContent = "Retry";
    this.retryBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      this.el.focus();
      this.session.retry();
    });
    this.returnBtn = document.createElement("button");
    this.returnBtn.type = "button";
    this.returnBtn.className = "nomusic-menu__item";
    this.returnBtn.textContent = "Return to original";
    this.returnBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      this.el.focus();
      this.session.returnToOriginal();
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      this.closeRecovery();
      this.el.focus();
    });
    for (const type of ["pointerdown", "mousedown", "mouseup", "dblclick", "click"]) {
      panel.addEventListener(type, (event) => event.stopPropagation());
    }
    panel.append(this.recoveryMessage, explanation, this.retryBtn, this.returnBtn);
    return panel;
  }

  openRecovery({ focus = false } = {}) {
    if (this.retired) return;
    const host = document.fullscreenElement ?? document.body;
    if (this.recovery.parentElement !== host) host.appendChild(this.recovery);
    this.recovery.hidden = false;
    this.positionPanel();
    window.addEventListener("scroll", this.onReposition, true);
    window.addEventListener("resize", this.onReposition, true);
    if (focus) this.retryBtn.focus();
  }

  closeRecovery() {
    this.recovery.hidden = true;
    this.recovery.remove();
    window.removeEventListener("scroll", this.onReposition, true);
    window.removeEventListener("resize", this.onReposition, true);
  }

  positionPanel() {
    if (this.recovery.hidden) return;
    const rect = this.el.getBoundingClientRect();
    const width = this.recovery.offsetWidth;
    const height = this.recovery.offsetHeight;
    const left = Math.max(8, rect.right - width); // right-aligned to the button
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8) top = rect.top - 6 - height; // flip up
    this.recovery.style.left = `${Math.round(left)}px`;
    this.recovery.style.top = `${Math.round(Math.max(8, top))}px`;
  }

  // Hide the button for this video; nomusic itself keeps working. A failure
  // still needs a decision, so it shows the recovery panel instead.
  dismiss() {
    if (this.session.failure) {
      this.openRecovery({ focus: true });
      return;
    }
    this.dismissed = true;
    this.el.style.display = "none";
  }

  // Anchor inside the player, top-right: clear of the controls at the bottom.
  position(host) {
    if (this.retired) return;
    if (this.el.parentElement !== host) host.appendChild(this.el);
    this.el.style.right = "12px";
    this.el.style.top = "12px";
    if (!this.dismissed) this.el.style.display = "";
    this.positionPanel();
  }

  hide() {
    this.el.style.display = "none";
    this.closeRecovery();
  }

  // A new video in the same player brings a dismissed button back.
  reset() {
    this.dismissed = false;
  }

  destroy() {
    if (this.retired) return;
    this.retired = true;
    this.closeRecovery();
    this.el.remove();
  }
}
