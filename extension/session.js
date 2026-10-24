// One video's music removal. The element's audio is routed through Web Audio
// so its original track can be silenced without touching the page's own
// volume or mute; the captured audio goes to the engine; separated chunks are
// scheduled against the video's clock.
//
// When nomusic cannot remove the music it fails closed: the original track
// stays silent and the video pauses until the user chooses Retry or Return to
// original. While a chunk is not ready yet, the video is held (paused) rather
// than played with music.

import { resumeAudio, routeElement } from "./audio.js";
import { CHUNK_SECONDS as CHUNK, chunkIndex, chunkStart, OVERLAP_SAMPLES, RATE } from "./grid.js";
import { PlaybackIntent } from "./playback-intent.js";
import { settings } from "./settings.js";

const AHEAD = 6; // chunks kept ready ahead of the playhead
const BEHIND = 2;
const TICK_MS = 250;
const DRIFT_LIMIT = 0.045;
const HOLD_LIMIT_MS = 30000;
const UNKNOWN_SOURCE_MS = 2000;
const STALL_MS = 400; // playing, but the clock has not moved for this long
const SLEEP_MS = 2 * 60 * 1000; // paused, ended or muted this long: let the engine go
const FADE_SECONDS = 0.004; // time constant of the fade when playback stops
const OVERLAP_SECONDS = OVERLAP_SAMPLES / RATE;

const FAILURES = {
  protected: "This video is copy-protected, so nomusic can't read its audio.",
  codec: "This browser can't decode this video's audio.",
  uncaptured: "nomusic couldn't access this video's audio. Reloading the page usually fixes this.",
  source: "nomusic can't access this player's audio.",
  slow: "Removing the music is taking too long.",
  engine: "nomusic couldn't start.",
  error: "Something went wrong while removing the music.",
  audio: "nomusic couldn't take over this video's sound.",
  updated: "nomusic was updated or turned off. Reload the page to continue.",
};

export function debugEnabled() {
  try {
    return localStorage.getItem("nomusicDebug") === "1";
  } catch {
    return false;
  }
}

// Media attached as an object (a worker's Media Source, a stream) has no URL:
// give each object a stable name so a change is still a new source.
const objectNames = new WeakMap();
let objectCount = 0;
function sourceOf(video) {
  const url = video.currentSrc || video.src;
  if (url || !video.srcObject) return url || "";
  if (!objectNames.has(video.srcObject)) objectNames.set(video.srcObject, `object:${++objectCount}`);
  return objectNames.get(video.srcObject);
}

// Pitch-preserving time-stretch for playback rates other than 1 (SoundTouch
// WSOLA), loaded on first use and shared by every session on the page.
let stretcher = null;
const loadStretcher = () =>
  (stretcher ??= import(chrome.runtime.getURL("stretch.js")).then((module) => new module.StretchClient()));

export class Session {
  constructor(video, { capture, engine, onChange = () => {} }) {
    this.video = video;
    this.capture = capture;
    this.engine = engine;
    this.onChange = onChange;
    this.on = false; // nomusic wanted for the current source
    this.failure = null; // { reason, message } while failed closed
    this.status = "off";
    this.graph = null;
    this.bus = null; // gain node of the current playback run, faded out on stop
    this.chunks = new Map(); // k -> { buffer, validFrom, stretched?, stretching? }
    this.sources = new Map(); // k -> AudioBufferSourceNode
    this.requested = [];
    this.anchor = null;
    this.sourceUrl = null;
    this.streamId = null;
    this.closedUrl = null;
    this.attached = false;
    this.asleep = false; // let the engine go while paused; wakes on play, seek or unmute
    this.unknownSince = null;
    this.idleSince = null;
    this.holdStarted = 0;
    this.lastClock = -1;
    this.lastClockChange = 0;
    this.ticks = 0;
    this.stats = { holds: 0, resyncs: 0, made: 0, timings: [], drift: [], firstAudioMs: null };
    this.events = [];
    this.disposed = false;
    this.intent = new PlaybackIntent(video, () => this.tick());

    this.listeners = [];
    const on = (type, handler) => {
      video.addEventListener(type, handler);
      this.listeners.push([type, handler]);
    };
    on("seeking", () => {
      this.stopAll();
      this.wake();
    });
    on("seeked", () => this.resync());
    on("playing", () => this.resync());
    on("play", () => {
      resumeAudio();
      this.wake();
    });
    on("pause", () => this.stopAll());
    on("ratechange", () => this.resync());
    on("waiting", () => this.stopAll()); // the video is buffering: its clock stops
    on("timeupdate", () => {
      if (video.currentTime !== this.lastClock) this.noteClock();
    });
    on("volumechange", () => {
      this.applyVolume();
      this.wake();
    });
    on("loadstart", () => this.checkSource());
    on("emptied", () => this.checkSource());
    on("encrypted", () => this.fail("protected"));
    capture.watch(this);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.checkSource();
  }

  // ---- what the button calls -------------------------------------------------

  toggle() {
    this.userChoice = true;
    if (this.status === "blocked") {
      resumeAudio(); // the click itself lets the page play sound again
      return;
    }
    if (this.failure) return;
    if (this.on) this.turnOff();
    else this.turnOn();
  }

  turnOn() {
    resumeAudio();
    this.on = true;
    this.failure = null;
    this.startSource();
    this.tick();
  }

  turnOff() {
    this.on = false;
    this.failure = null;
    this.stopProcessing();
    if (this.graph) this.graph.original.gain.value = 1;
    this.intent.release(); // resumes playback if the user wanted it
    this.update();
  }

  retry() {
    if (this.failure?.reason === "updated") {
      location.reload();
      return;
    }
    this.failure = null;
    this.holdStarted = performance.now();
    this.startSource();
    this.tick();
  }

  returnToOriginal() {
    this.userChoice = true;
    this.turnOff();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    for (const [type, handler] of this.listeners) this.video.removeEventListener(type, handler);
    this.capture.unwatch(this);
    this.stopProcessing();
    if (this.graph) this.graph.original.gain.value = 1;
    this.intent.dispose({ restore: true });
  }

  // ---- sources ----------------------------------------------------------------

  // Follow the element's current Media Source: a new one is a new video or an ad.
  checkSource() {
    if (this.disposed) return;
    const url = sourceOf(this.video);
    if (url !== this.sourceUrl) {
      this.stopProcessing();
      this.sourceUrl = url;
      this.closedUrl = null;
      this.failure = null; // a failure belonged to the previous source
      this.stats.firstAudioMs = null;
      // Each new video starts on if the user wants nomusic on every video, or
      // had it on for the previous one in this player.
      if (url) this.on = settings.autoStart || this.on;
      if (this.on && url) this.startSource();
      else if (this.graph && !this.on) this.graph.original.gain.value = 1;
    } else if (this.on && !this.failure && !this.streamId && url && url !== this.closedUrl) {
      this.streamId = this.capture.streamFor(url);
      if (this.streamId) this.unknownSince = null;
    }
    this.tick();
  }

  startSource() {
    this.stopProcessing();
    const url = this.sourceUrl;
    this.stats.started = performance.now();
    if (!url) return; // nothing loaded yet: wait for the next source
    if (!url.startsWith("blob:")) {
      // A plain file or a media object: nothing was captured, and routing a
      // cross-origin file through Web Audio could silence it for good. Hold it instead.
      this.fail("source");
      return;
    }
    try {
      this.graph = routeElement(this.video);
    } catch (error) {
      this.fail("audio", error.message);
      return;
    }
    this.graph.original.gain.value = 0;
    this.applyVolume();
    if (debugEnabled() && !this.recorder) {
      import(chrome.runtime.getURL("recorder.js")).then(({ Recorder }) => {
        if (!this.recorder) this.recorder = new Recorder(this.graph.ctx, this.graph.element, this.graph.output, this.video);
      });
    }
    this.streamId = this.capture.streamFor(url);
    this.unknownSince = this.streamId ? null : performance.now();
  }

  // Stop separating (the stream, scheduled audio and chunks); keeps on/off and routing.
  stopProcessing() {
    this.detach();
    this.stopAll();
    this.chunks.clear();
    this.requested = [];
    this.streamId = null;
    this.unknownSince = null;
    this.idleSince = null;
    this.asleep = false;
  }

  wake() {
    this.asleep = false;
    this.idleSince = null;
    this.tick();
  }

  attach() {
    if (this.attached || !this.streamId) return;
    this.attached = true;
    this.idleSince = null;
    this.requested = null; // forces a fresh request list
    this.engine.attach(this.streamId, this);
    this.capture.subscribe(this.streamId, this);
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    this.engine.detach(this.streamId);
    this.capture.unsubscribe(this.streamId);
  }

  // One message per entry: a single cross-process message transferring many
  // buffers (a replay can hold ~170) can hang the page in Chrome.
  onEntries(streamId, entries) {
    if (!this.attached || streamId !== this.streamId) return;
    for (const entry of entries) {
      this.engine.post({ type: "entries", streamId, entries: [entry] }, entry.bytes ? [entry.bytes.buffer] : []);
    }
  }

  // The player detached this Media Source; a new source follows if it plays on.
  onCaptureClosed(streamId) {
    if (streamId !== this.streamId) return;
    this.detach();
    this.streamId = null;
    this.closedUrl = this.sourceUrl;
  }

  onEngine(message) {
    if (message.type === "chunk") {
      if (message.streamId === this.streamId && this.attached) this.addChunk(message);
    } else if (message.type === "unsupported") {
      this.fail(message.reason === "protected" ? "protected" : "codec", message.message);
    } else if (message.type === "error") {
      this.fail(message.fatal ? "engine" : "error", message.message);
    } else if (message.type === "stats") {
      this.workerStats = message;
    }
  }

  onEngineLost() {
    this.attached = false;
  }

  fail(reason, detail) {
    if (!this.on || this.failure || this.disposed) return;
    this.failure = { reason, message: FAILURES[reason] ?? FAILURES.error, detail: detail ?? null };
    this.stopProcessing();
    if (this.graph) this.graph.original.gain.value = 0;
    this.intent.hold(); // keep the music from playing until the user decides
    this.trace({ e: "fail", reason, detail });
    this.update();
  }

  // ---- playback ---------------------------------------------------------------

  addChunk(message) {
    const ctx = this.graph.ctx;
    const buffer = ctx.createBuffer(2, message.left.length, RATE);
    buffer.copyToChannel(message.left, 0);
    buffer.copyToChannel(message.right, 1);
    this.chunks.set(message.k, { buffer, validFrom: message.validFrom });
    this.stats.made++;
    this.stats.timings.push({ k: message.k, ...message.timing });
    if (this.stats.timings.length > 40) this.stats.timings.shift();
    if (this.anchor) this.schedule(message.k);
    this.tick();
  }

  applyVolume() {
    if (this.graph) this.graph.output.gain.value = this.video.muted ? 0 : this.video.volume;
  }

  trace(event) {
    if (!debugEnabled()) return;
    this.events.push({ ctx: +(this.graph?.ctx.currentTime ?? 0).toFixed(3), media: +this.video.currentTime.toFixed(3), ...event });
    if (this.events.length > 120) this.events.shift();
  }

  // Stop everything scheduled, with a few milliseconds of fade instead of a click.
  stopAll() {
    if (this.sources.size) {
      this.trace({ e: "stop", n: this.sources.size });
      const now = this.graph.ctx.currentTime;
      const bus = this.bus;
      bus.gain.setTargetAtTime(0, now, FADE_SECONDS);
      for (const source of this.sources.values()) {
        try {
          source.stop(now + 8 * FADE_SECONDS);
        } catch {
          // already stopped
        }
      }
      setTimeout(() => bus.disconnect(), 200);
      this.bus = null;
    }
    this.sources.clear();
    this.anchor = null;
  }

  // The playhead last moved now: a resumed video is not still "stalled".
  noteClock() {
    this.lastClock = this.video.currentTime;
    this.lastClockChange = performance.now();
  }

  resync() {
    this.stopAll();
    const video = this.video;
    if (!this.on || this.failure || !this.attached || video.paused || video.seeking || video.readyState < 3) return;
    this.noteClock();
    this.stats.resyncs++;
    this.trace({ e: "resync", rate: video.playbackRate });
    this.anchor = { ctx: this.graph.ctx.currentTime, media: video.currentTime, rate: video.playbackRate };
    const k = chunkIndex(video.currentTime);
    // Inside a crossfade the previous chunk's tail is still audible.
    for (let i = chunkIndex(Math.max(0, video.currentTime - OVERLAP_SECONDS)); i <= k + 2; i++) this.schedule(i);
  }

  schedule(k) {
    const chunk = this.chunks.get(k);
    if (!chunk || this.sources.has(k) || !this.anchor) return;
    // Only chunks around the playhead; later ones are scheduled as playback nears them.
    const time = this.video.currentTime;
    if (k < chunkIndex(Math.max(0, time - OVERLAP_SECONDS)) || k > chunkIndex(time) + 2) return;
    const { rate } = this.anchor;
    // Like the page's own audio, keep the voice's pitch when sped up or slowed down.
    let buffer = chunk.buffer;
    let sourceRate = rate;
    let interim = false;
    if (rate !== 1 && this.video.preservesPitch !== false) {
      if (chunk.stretched?.rate === rate) {
        buffer = chunk.stretched.buffer;
        sourceRate = 1;
      } else {
        // Until the pitch-preserving version is ready, play this one sped up
        // (briefly higher pitched) rather than leave a gap.
        this.stretch(k, rate);
        interim = true;
      }
    }
    const ctx = this.graph.ctx;
    const now = ctx.currentTime + 0.01;
    let when = this.anchor.ctx + (chunkStart(k) - this.anchor.media) / rate;
    let offset = 0;
    if (when < now) {
      offset = (now - when) * sourceRate;
      when = now;
    }
    if (offset >= buffer.duration) return;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.connect(this.graph.output);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = sourceRate;
    source.connect(this.bus);
    source.start(when, offset);
    this.trace({ e: "start", k, in: +(when - ctx.currentTime).toFixed(3), offset: +offset.toFixed(3), dur: +buffer.duration.toFixed(3), sourceRate, valid: chunk.validFrom });
    source.interim = interim;
    this.sources.set(k, source);
    source.onended = () => {
      if (this.sources.get(k) === source) this.sources.delete(k);
    };
    if (this.stats.firstAudioMs === null) this.stats.firstAudioMs = performance.now() - this.stats.started;
  }

  stretch(k, rate) {
    const chunk = this.chunks.get(k);
    if (!chunk || chunk.stretching === rate) return;
    chunk.stretching = rate;
    const channels = [chunk.buffer.getChannelData(0), chunk.buffer.getChannelData(1)];
    loadStretcher()
      .then((client) => client.stretch(channels, rate, chunk.buffer.sampleRate))
      .then(({ channels: out }) => {
        if (this.chunks.get(k) !== chunk || chunk.stretching !== rate) return;
        const buffer = this.graph.ctx.createBuffer(2, out[0].length, chunk.buffer.sampleRate);
        buffer.copyToChannel(out[0], 0);
        buffer.copyToChannel(out[1] ?? out[0], 1);
        chunk.stretched = { rate, buffer };
        chunk.stretching = null;
        if (this.anchor?.rate !== rate) return;
        // Swap a sped-up stand-in for the stretched version from the same point.
        const standIn = this.sources.get(k);
        if (standIn?.interim) {
          try {
            standIn.stop();
          } catch {
            // already ended
          }
          standIn.disconnect();
          this.sources.delete(k);
        }
        this.schedule(k);
      })
      .catch((error) => {
        chunk.stretching = null;
        this.fail("error", `speed change failed: ${error.message}`);
      });
  }

  playable(k, time) {
    const chunk = this.chunks.get(k);
    return !!chunk && chunk.validFrom <= time + 0.05;
  }

  hold() {
    if (!this.intent.held) {
      this.holdStarted = performance.now();
      this.stats.holds++;
      this.trace({ e: "hold" });
    }
    this.intent.hold();
  }

  bufferedAhead() {
    const time = this.video.currentTime;
    let k = chunkIndex(time);
    if (!this.playable(k, time)) return 0;
    while (this.chunks.has(k + 1)) k++;
    return chunkStart(k + 1) - time;
  }

  tick() {
    if (this.disposed) return;
    if (this.on && !this.failure && !chrome.runtime?.id) this.fail("updated");
    if (!this.on || this.failure) {
      if (!this.on && this.intent.held) this.intent.release();
      this.update();
      return;
    }
    const video = this.video;
    if (!this.streamId) {
      // No source at all (between videos): nothing can play, so nothing to hold.
      if (!this.sourceUrl && this.intent.held) this.intent.release();
      if (this.unknownSince && performance.now() - this.unknownSince > UNKNOWN_SOURCE_MS) this.fail("uncaptured");
      this.update();
      return;
    }

    // Work only while the video can be heard; a paused one is prepared ahead of play.
    const audible = !video.muted && video.volume > 0;
    if (!this.attached) {
      if (!audible || video.ended || this.asleep) {
        if (this.intent.held) this.intent.release();
        this.update();
        return;
      }
      this.attach();
    } else if (video.paused || video.ended || !audible) {
      this.idleSince ??= performance.now();
      if (performance.now() - this.idleSince > SLEEP_MS && !this.intent.held) {
        this.detach();
        this.asleep = true;
        this.update();
        return;
      }
    } else {
      this.idleSince = null;
    }

    if (debugEnabled() && ++this.ticks % 8 === 0) this.engine.post({ type: "stats", streamId: this.streamId });
    const time = video.currentTime;
    const k = chunkIndex(time);
    const last = Number.isFinite(video.duration) ? chunkIndex(Math.max(0, video.duration - 0.001)) : Infinity;

    // A chunk made after a seek may start late; going back before that needs a redo.
    const forget = [];
    if (this.chunks.has(k) && !this.playable(k, time)) {
      this.chunks.delete(k);
      forget.push(k);
    }
    // Ask for the current chunk first (from the playhead), then the ones ahead.
    const want = [];
    for (let i = k; i <= Math.min(k + AHEAD, last); i++) {
      if (!this.chunks.has(i)) want.push({ k: i, from: i === k ? Math.max(0, time - 0.25) : chunkStart(i) });
    }
    for (const i of this.chunks.keys()) {
      if (i < k - BEHIND || i > k + AHEAD + 1) {
        this.chunks.delete(i);
        forget.push(i);
      }
    }
    const playing = this.intent.wantsPlay && !video.ended;
    const key = want.map((w) => w.k).join();
    if (forget.length || key !== this.requested?.key || playing !== this.requested.playing || Math.abs(time - this.requested.time) > 30) {
      this.requested = { key, playing, time };
      this.engine.post({ type: "want", streamId: this.streamId, chunks: want, forget, duration: video.duration, playing, position: time });
    }

    // Hold the video rather than play music while the audio it needs is missing.
    const needed = this.playable(k, time) && (k >= last || time < chunkStart(k + 1) - 0.5 || this.chunks.has(k + 1));
    if (needed || !playing || !audible) {
      if (this.intent.held) this.intent.release();
    } else if (video.readyState >= 3 || this.intent.held) {
      // A video still buffering is left to the site until it could play.
      this.hold();
    }
    if (this.intent.held && performance.now() - this.holdStarted > HOLD_LIMIT_MS) {
      this.fail("slow");
      return;
    }

    // A video can stall without pausing (network, or the site's own buffering):
    // its clock stops, so our audio must stop too until it moves again.
    const now = performance.now();
    if (video.currentTime !== this.lastClock) this.noteClock();
    const stalled = !video.paused && (video.readyState < 3 || now - this.lastClockChange > STALL_MS);
    if (stalled) {
      if (this.sources.size) this.trace({ e: "stall" });
      this.stopAll();
    } else if (!video.paused && !video.seeking) {
      if (!this.anchor) this.resync();
      else {
        for (let i = k; i <= k + 2; i++) this.schedule(i);
        const expected = this.anchor.media + (this.graph.ctx.currentTime - this.anchor.ctx) * this.anchor.rate;
        const drift = video.currentTime - expected;
        this.stats.drift.push(Math.round(drift * 1000));
        if (this.stats.drift.length > 80) this.stats.drift.shift();
        this.driftStrikes = Math.abs(drift) > DRIFT_LIMIT ? (this.driftStrikes ?? 0) + 1 : 0;
        if (this.driftStrikes >= 2) {
          this.driftStrikes = 0;
          this.resync();
        }
      }
    }
    this.update();
  }

  // ---- state for the button ---------------------------------------------------

  computeStatus() {
    if (!this.on) return "off";
    if (this.failure) return "failed";
    const ctx = this.graph?.ctx;
    if (ctx && ctx.state !== "running" && !this.video.paused && !this.video.muted) return "blocked";
    if (this.intent.held) return this.stats.made ? "buffering" : "starting";
    return "on";
  }

  update() {
    const status = this.computeStatus();
    if (status !== this.status) {
      this.status = status;
      this.trace({ e: "status", status });
    }
    this.onChange(this);
  }

  snapshot() {
    return {
      status: this.status,
      on: this.on,
      failure: this.failure,
      streamId: this.streamId,
      attached: this.attached,
      currentTime: this.video.currentTime,
      ahead: this.bufferedAhead(),
      chunks: [...this.chunks.keys()].sort((a, b) => a - b),
      holding: this.intent.held,
      wantsPlay: this.intent.wantsPlay,
      context: this.graph?.ctx.state ?? null,
      originalGain: this.graph?.original.gain.value ?? null,
      outputGain: this.graph?.output.gain.value ?? null,
      model: this.engine.model,
      ...this.stats,
      timings: this.stats.timings.slice(-20),
      worker: this.workerStats ?? null,
      scheduled: [...this.sources.keys()],
      events: this.events.slice(-60),
      stretched: [...this.chunks].filter(([, c]) => c.stretched || c.stretching).map(([k, c]) => `${k}:${c.stretched?.rate ?? "-"}/${c.stretching ?? "-"}`),
    };
  }
}
