// Keeps the user's play/pause choice separate from Musicless pausing the video
// while it waits for separated audio. Native events cover the player's
// controls; intent.js (page world) also reports a page's pause() call when the
// video was already paused by us.

export class PlaybackIntent {
  constructor(video, onChange = () => {}) {
    this.video = video;
    this.onChange = onChange;
    this.wantsPlay = !video.paused && !video.ended;
    this.held = false;
    this.disposed = false;
    this._onIntent = (event) => {
      if (typeof event.detail?.playing === "boolean") this._record(event.detail.playing);
    };
    this._onPlay = () => {
      // Events are queued: a play event can arrive after we paused again.
      if (!video.paused) this._record(true);
    };
    this._onPause = () => {
      if (video.paused && !this.held) this._record(false);
    };
    video.addEventListener("musicless:playback-intent", this._onIntent);
    video.addEventListener("play", this._onPlay);
    video.addEventListener("pause", this._onPause);
    video.dataset.musiclessPlaybackTrack = "1";
  }

  _record(playing) {
    if (this.disposed) return;
    const changed = this.wantsPlay !== playing;
    this.wantsPlay = playing;
    if (this.held && !this.video.paused) this._command("pause");
    if (changed) this.onChange(playing);
  }

  _command(method) {
    // Marks the call as ours, so intent.js does not report it as the user's.
    this.video.dataset.musiclessPlaybackInternal = "1";
    try {
      this.video[method]()?.catch?.(() => {});
    } catch {
      // A detached or errored element: nothing to control.
    } finally {
      delete this.video.dataset.musiclessPlaybackInternal;
    }
  }

  hold() {
    if (this.disposed) return;
    this.held = true;
    this.video.dataset.musiclessPlaybackTrack = "1"; // in case the page removed it: intent.js needs it
    if (!this.video.paused) this._command("pause");
  }

  release() {
    if (this.disposed || !this.held) return;
    this.held = false;
    if (this.wantsPlay && this.video.paused) this._command("play");
  }

  dispose({ restore = false } = {}) {
    if (this.disposed) return;
    this.disposed = true;
    this.video.removeEventListener("musicless:playback-intent", this._onIntent);
    this.video.removeEventListener("play", this._onPlay);
    this.video.removeEventListener("pause", this._onPause);
    delete this.video.dataset.musiclessPlaybackTrack;
    const resume = restore && this.held && this.wantsPlay;
    this.held = false;
    if (resume && this.video.paused) this._command("play");
  }
}
