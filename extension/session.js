// One video's music removal. The element's audio is routed through Web Audio
// so its original track can be silenced without touching the page's own
// volume or mute; the captured audio goes to the engine; separated chunks are
// scheduled against the video's clock.
//
// When Musicless cannot remove the music it fails closed: the original track
// stays silent and the video pauses until the user chooses Try again (or
// Reload page) or Play original sound. While a chunk is not ready yet, the video is
// held (paused) rather than played with music.
//
// Until the user turns Musicless on (settings.consented), a session only shows
// "setup": it reads no audio and leaves the video alone.

import { IN_SAFARI, isMuted, refreshSafariAudio, resumeAudio, routeElement } from "./audio.js";
import { chunkIndex, chunkStart, OVERLAP_SAMPLES, RATE } from "./grid.js";
import { createFailure } from "./failures.js";
import { reloadPage } from "./navigation.js";
import { PlaybackIntent } from "./playback-intent.js";
import { StretchedPlayback } from "./stretch.js";

const AHEAD = 6; // chunks kept ready ahead of the playhead
const BEHIND = 2;
const TICK_MS = 250;
const DRIFT_LIMIT = 0.045; // re-anchor at once beyond this
const DRIFT_STEADY = 0.015; // or when every reading of the last 2 s is this far off the same way
const DRIFT_SAMPLES = 8;
const HOLD_LIMIT_MS = 30000;
const UNKNOWN_SOURCE_MS = 2000;
const STALL_MS = 400; // playing, but the clock has not moved for this long
// Paused, ended or muted this long: let the engine go. Shorter on Safari,
// where each tab owns a dedicated model worker (~250-340 MiB).
const SLEEP_MS = IN_SAFARI ? 30 * 1000 : 2 * 60 * 1000;
const HIDDEN_SLEEP_MS = 5 * 1000;
const AUDIO_START_MS = 3000; // after the user's click, the sound starts well within this
const FADE_SECONDS = 0.004; // time constant of the fade when playback stops
const OVERLAP_SECONDS = OVERLAP_SAMPLES / RATE;
// Time-stretched audio (speeds other than 1) is made this far ahead of the
// context's clock: timers run at least once a second even in background tabs.
const STRETCH_AHEAD = 2.5;
const STRETCH_FIRST = 0.75; // made at once when it starts: well past the next tick

// Test diagnostics, only in the test harness's copy of the extension: it marks
// its manifest, which no page can change.
export const DEBUG = (() => {
  try {
    return chrome.runtime.getManifest().musicless_test === true;
  } catch {
    return false;
  }
})();

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

export class Session {
  constructor(video, { capture, engine, settings, onChange = () => {} }) {
    this.video = video;
    this.capture = capture;
    this.engine = engine;
    this.settings = settings;
    this.onChange = onChange;
    this.on = false; // Musicless wanted for the current source
    this.failure = null; // while failed closed: createFailure()'s record (failures.js)
    this.status = "off";
    this.graph = null;
    this.bus = null; // gain node of the current playback run, faded out on stop
    this.chunks = new Map(); // k -> { buffer, validFrom, cut, print }
    this.unchecked = new Set(); // chunks kept from an earlier worker, until the current one checked them
    this.sources = new Map(); // k -> AudioBufferSourceNode, or a StretchedPlayback (stretch.js)
    this.requested = null; // the last request sent to the worker
    this.anchor = null;
    this.sourceUrl = null;
    this.streamId = null; // the captured stream
    this.workerId = null; // the worker's copy of it, while attached
    this.attached = false;
    this.asleep = false; // let the engine go while paused; wakes on play, seek or unmute
    this.unknownSince = null;
    this.idleSince = null;
    this.engineLosses = 0;
    this.holdStarted = 0;
    this.blockedClick = null; // when the user clicked to start the sound, while it has not started
    this.lastClock = -1;
    this.lastClockChange = 0;
    this.lastCtxTime = -1;
    this.frozenCtxTicks = 0;
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
      this.requested = null; // the current chunk is needed from the new position
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
    // A reset element fires no pause event: stop what was scheduled at once.
    on("emptied", () => {
      this.stopAll();
      this.checkSource();
    });
    on("abort", () => this.stopAll());
    on("encrypted", () => this.fail("protected"));
    capture.watch(this);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.checkSource();
  }

  // ---- what the button calls -------------------------------------------------

  toggle() {
    if (!this.settings.consented) return; // the button opens the welcome page instead
    if (this.status === "blocked") {
      resumeAudio(); // the click itself lets the page play sound again
      this.blockedClick ??= performance.now();
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
    if (this.failure?.action === "reload") {
      reloadPage(this.video.currentTime);
      return;
    }
    this.failure = null;
    this.startSource();
    this.tick();
  }

  // The user turned Musicless on, or off again (the welcome page, the popup).
  consentChanged() {
    this.failure = null;
    if (this.settings.consented) {
      if (this.on && this.sourceUrl) this.startSource();
    } else {
      this.stopProcessing();
      if (this.graph) this.graph.original.gain.value = 1;
      this.intent.release();
    }
    this.tick();
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
      this.failure = null; // a failure belonged to the previous source
      this.stats.firstAudioMs = null;
      // Player choices belong to one video; each new source uses the default.
      if (url) this.on = this.settings.autoStart;
      if (this.on && url) this.startSource();
      else if (this.graph && !this.on) this.graph.original.gain.value = 1;
    } else if (this.on && !this.failure && !this.streamId && url) {
      this.streamId = this.capture.streamFor(url);
      if (this.streamId) this.unknownSince = null;
    }
    this.tick();
  }

  startSource() {
    this.stopProcessing();
    this.holdStarted = performance.now(); // a hold carried over from before gets a fresh deadline
    this.blockedClick = null;
    this.engineLosses = 0;
    const url = this.sourceUrl;
    this.stats.started = performance.now();
    if (!url || !this.settings.consented) return; // nothing loaded yet, or nothing may be read yet
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
    this.streamId = this.capture.streamFor(url);
    this.unknownSince = this.streamId ? null : performance.now();
  }

  // Stop separating (the stream, scheduled audio and chunks); keeps on/off and routing.
  stopProcessing() {
    this.detach();
    this.stopAll();
    this.chunks.clear();
    this.requested = null;
    this.streamId = null;
    this.unknownSince = null;
    this.idleSince = null;
    this.asleep = false;
  }

  wake() {
    const wasAsleep = this.asleep;
    this.asleep = false;
    this.idleSince = null;
    if (IN_SAFARI && wasAsleep) resumeAudio();
    this.tick();
  }

  // A new worker gets the captured audio again. Chunks kept from before (a
  // sleep, a lost engine) are not played until it has checked that their audio
  // is still the same.
  attach() {
    if (this.attached || !this.streamId) return;
    this.attached = true;
    this.idleSince = null;
    this.requested = null; // forces a fresh request list
    this.unchecked = new Set(this.chunks.keys());
    this.workerId = this.engine.attach(this);
    this.capture.subscribe(this.streamId, this);
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    this.engine.detach(this.workerId);
    this.workerId = null;
    this.capture.unsubscribe(this.streamId);
  }

  // One message per entry: a single cross-process message transferring many
  // buffers (a replay can hold ~170) can hang the page in Chrome.
  onEntries(streamId, entries, replay) {
    if (!this.attached || streamId !== this.streamId) return;
    if (replay?.missed) {
      // Its audio went by before Musicless was turned on: only a reload can read it.
      this.fail("missed");
      return;
    }
    for (const entry of entries) {
      this.engine.post({ type: "entries", streamId: this.workerId, entries: [entry] }, entry.bytes ? [entry.bytes.buffer] : []);
    }
    if (replay) this.engine.post({ type: "replayed", streamId: this.workerId }); // now it can check what it was told the page has
  }

  // The player closed this Media Source. A new one usually follows with a new
  // URL (checkSource); if the element keeps this URL, a stream that reopens
  // under it is attached (it may be there already: one that reopened while
  // this session slept), and without one the session fails closed.
  onCaptureClosed(streamId) {
    if (streamId !== this.streamId) return;
    this.stopProcessing();
    this.streamId = this.capture.streamFor(this.sourceUrl);
    this.unknownSince = this.streamId ? null : performance.now();
    this.tick();
  }

  onEngine(message) {
    if (message.type === "chunk") {
      if (this.attached) this.addChunk(message);
    } else if (message.type === "checked") {
      for (const k of message.chunks) this.unchecked.delete(k);
      this.tick();
    } else if (message.type === "changed") {
      // Their audio changed (the player switched audio tracks, say): they are
      // made again, and the video holds rather than play the old voice meanwhile.
      for (const k of message.chunks) this.chunks.delete(k);
      if (message.chunks.some((k) => this.sources.has(k))) this.stopAll(); // not a moment more of the old audio
      this.requested = null;
      this.tick();
    } else if (message.type === "unsupported") {
      this.fail(message.reason === "protected" ? "protected" : "codec", message.message);
    } else if (message.type === "error") {
      this.fail("error", message.message);
    } else if (message.type === "stats") {
      this.workerStats = message;
    }
  }

  // The engine's worker is gone (its frame was removed, it crashed, or the
  // model failed): attach to a new one once, then fail closed.
  onEngineLost() {
    if (!this.attached) return;
    this.attached = false;
    this.workerId = null;
    this.capture.unsubscribe(this.streamId); // subscribing again replays the audio to the new worker
    if (++this.engineLosses > 1) this.fail("engine");
    else this.tick();
  }

  fail(reason, detail) {
    if (!this.on || !this.settings.consented || this.failure || this.disposed) return;
    this.failure = createFailure(reason, detail);
    this.stopProcessing();
    if (this.graph) this.graph.original.gain.value = 0;
    this.intent.hold(); // keep the music from playing until the user decides
    this.trace({ e: "fail", reason, detail });
    this.update();
  }

  // ---- playback ---------------------------------------------------------------

  addChunk(message) {
    const ctx = this.graph.ctx;
    const buffer = typeof AudioBuffer === "function"
      ? new AudioBuffer({ numberOfChannels: 2, length: message.left.length, sampleRate: RATE })
      : ctx.createBuffer(2, message.left.length, RATE);
    buffer.copyToChannel(message.left, 0);
    buffer.copyToChannel(message.right, 1);
    this.chunks.set(message.k, { buffer, validFrom: message.validFrom, cut: message.cut, print: message.print });
    this.unchecked.delete(message.k);
    this.stats.made++;
    if (DEBUG) {
      this.stats.timings.push({ k: message.k, ...message.timing });
      if (this.stats.timings.length > 40) this.stats.timings.shift();
    }
    if (this.sources.has(message.k)) this.resync(); // a new version of what is playing
    else if (this.anchor) this.schedule(message.k);
    this.tick();
  }

  applyVolume() {
    if (this.graph) this.graph.output.gain.value = isMuted(this.video) ? 0 : this.video.volume;
  }

  trace(event) {
    if (!DEBUG) return;
    this.events.push({ ctx: +(this.graph?.ctx.currentTime ?? 0).toFixed(3), media: +this.video.currentTime.toFixed(3), ...event });
    if (this.events.length > 120) this.events.shift();
  }

  // Stop everything scheduled, with a few milliseconds of fade instead of a click.
  stopAll() {
    if (this.sources.size) {
      this.trace({ e: "stop", n: this.sources.size });
      const bus = this.bus;
      const busCtx = bus?.context ?? this.graph.ctx;
      try {
        const now = busCtx.currentTime;
        bus.gain.setTargetAtTime(0, now, FADE_SECONDS);
        for (const source of this.sources.values()) {
          try {
            source.stop(now + 8 * FADE_SECONDS);
          } catch {
            // already stopped
          }
        }
        setTimeout(() => {
          try {
            bus.disconnect();
          } catch {
            // already disconnected or closed
          }
        }, 200);
      } catch {
        // The previous AudioContext was closed during Safari audio recovery.
      }
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
    if (DEBUG) this.stats.resyncs++;
    this.recentDrift = [];
    this.trace({ e: "resync", rate: video.playbackRate });
    this.anchor = { ctx: this.graph.ctx.currentTime, media: video.currentTime, rate: video.playbackRate };
    const k = chunkIndex(video.currentTime);
    // Inside a crossfade the previous chunk's tail is still audible.
    for (let i = chunkIndex(Math.max(0, video.currentTime - OVERLAP_SECONDS)); i <= k + 2; i++) this.schedule(i);
  }

  schedule(k) {
    const chunk = this.chunks.get(k);
    if (!chunk || this.unchecked.has(k) || this.sources.has(k) || !this.anchor) return;
    // Only chunks around the playhead; later ones are scheduled as playback nears them.
    const time = this.video.currentTime;
    if (k < chunkIndex(Math.max(0, time - OVERLAP_SECONDS)) || k > chunkIndex(time) + 2) return;
    const { rate } = this.anchor;
    // Like the page's own audio, keep the voice's pitch when sped up or slowed down.
    const stretched = rate !== 1 && this.video.preservesPitch !== false;
    const ctx = this.graph.ctx;
    if (this.bus && this.bus.context !== ctx) {
      this.bus = null;
      this.sources.clear();
    }
    const now = ctx.currentTime + 0.01;
    // Before validFrom the chunk holds no captured audio: it starts there.
    const lead = Math.max(0, chunk.validFrom - chunkStart(k)) / rate;
    let when = this.anchor.ctx + (chunkStart(k) - this.anchor.media) / rate + lead;
    let offset = lead * rate; // seconds into the chunk
    if (when < now) {
      offset += (now - when) * rate;
      when = now;
    }
    if (offset >= chunk.buffer.duration) return;
    if (stretched && when > now + STRETCH_AHEAD) return; // made when playback nears it (tick)
    if (!this.bus) {
      // Each playback run fades in, so re-anchoring crossfades instead of cutting.
      this.bus = ctx.createGain();
      this.bus.gain.setValueAtTime(0, when);
      this.bus.gain.linearRampToValueAtTime(1, when + 0.01);
      this.bus.connect(this.graph.output);
    }
    let source;
    if (stretched) {
      // Made from where playback is, a slice at a time: the first slices now.
      try {
        source = new StretchedPlayback(chunk.buffer, offset, rate, when, this.bus);
        source.fill(now + STRETCH_FIRST);
      } catch (error) {
        this.fail("error", `speed change failed: ${error.message}`);
        return;
      }
    } else {
      source = ctx.createBufferSource();
      source.buffer = chunk.buffer;
      source.playbackRate.value = rate;
      source.connect(this.bus);
      source.start(when, offset);
    }
    this.trace({ e: "start", k, in: +(when - ctx.currentTime).toFixed(3), offset: +offset.toFixed(3), dur: +chunk.buffer.duration.toFixed(3), rate, stretched, valid: chunk.validFrom });
    this.sources.set(k, source);
    source.onended = () => {
      if (this.sources.get(k) === source) this.sources.delete(k);
    };
    if (DEBUG && this.stats.firstAudioMs === null) this.stats.firstAudioMs = performance.now() - this.stats.started;
  }

  // Make time-stretched audio up to STRETCH_AHEAD past the context's clock.
  fillStretched() {
    try {
      for (const source of this.sources.values()) source.fill?.(this.graph.ctx.currentTime + STRETCH_AHEAD);
    } catch (error) {
      this.fail("error", `speed change failed: ${error.message}`);
    }
  }

  unschedule(k) {
    const source = this.sources.get(k);
    if (!source) return;
    try {
      source.stop();
    } catch {
      // already ended
    }
    source.disconnect();
    this.sources.delete(k);
  }

  // Whether chunk k has audio from `time` on (one made after a seek starts late).
  covers(k, time) {
    const chunk = this.chunks.get(k);
    return !!chunk && chunk.validFrom <= time + 0.05;
  }

  playable(k, time) {
    return this.covers(k, time) && !this.unchecked.has(k);
  }

  hold() {
    if (!this.intent.held) {
      this.holdStarted = performance.now();
      if (DEBUG) this.stats.holds++;
      this.trace({ e: "hold" });
    }
    this.intent.hold();
  }

  bufferedAhead() {
    const time = this.video.currentTime;
    let k = chunkIndex(time);
    if (!this.playable(k, time)) return 0;
    while (this.playable(k + 1, chunkStart(k + 1))) k++;
    return chunkStart(k + 1) - time;
  }

  tick() {
    if (this.disposed) return;
    if (this.on && this.settings.consented && !this.failure && !chrome.runtime?.id) this.fail("updated");
    if (!this.on || !this.settings.consented || this.failure) {
      if ((!this.on || !this.settings.consented) && this.intent.held) this.intent.release();
      this.update();
      return;
    }
    const video = this.video;
    // Work only while the video can be heard; a paused one is prepared ahead of play.
    const audible = !isMuted(video) && video.volume > 0;
    if (!this.streamId) {
      // No source at all (between videos): nothing can play, so nothing to hold.
      // A source whose audio is not (or no longer) captured is held meanwhile.
      if (!this.sourceUrl) {
        if (this.intent.held) this.intent.release();
      } else if (this.intent.wantsPlay && !video.ended && audible && (video.readyState >= 3 || this.intent.held)) {
        this.hold();
      }
      if (this.unknownSince && performance.now() - this.unknownSince > UNKNOWN_SOURCE_MS) this.fail("uncaptured");
      this.update();
      return;
    }

    if (!this.attached) {
      if (!audible || video.ended || this.asleep) {
        if (this.intent.held) this.intent.release();
        this.update();
        return;
      }
      this.attach();
    } else if (video.paused || video.ended || !audible) {
      this.idleSince ??= performance.now();
      const hidden = typeof document !== "undefined" && document.hidden;
      const limit = IN_SAFARI && hidden ? HIDDEN_SLEEP_MS : SLEEP_MS;
      if (performance.now() - this.idleSince > limit && !this.intent.held) {
        this.detach();
        this.asleep = true;
        this.update();
        return;
      }
    } else {
      this.idleSince = null;
    }

    if (DEBUG && ++this.ticks % 8 === 0) this.engine.post({ type: "stats", streamId: this.workerId });
    const time = video.currentTime;
    const k = chunkIndex(time);
    const last = Number.isFinite(video.duration) ? chunkIndex(Math.max(0, video.duration - 0.001)) : Infinity;

    // A chunk made after a seek may start late (from where that playhead was):
    // going back before that, or coming to it from an earlier chunk, needs a redo.
    const forget = [];
    for (const i of this.chunks.keys()) {
      if (i < k - BEHIND || i > k + AHEAD + 1 || (i >= k && !this.covers(i, i === k ? time : chunkStart(i)))) {
        this.chunks.delete(i);
        forget.push(i);
        this.unschedule(i); // not heard yet: it starts later than now
      }
    }
    // Ask for the current chunk first (from the playhead), then the ones ahead.
    const want = [];
    for (let i = k; i <= Math.min(k + AHEAD, last); i++) {
      if (!this.chunks.has(i)) want.push({ k: i, from: i === k ? Math.max(0, time - 0.25) : chunkStart(i) });
    }
    const playing = this.intent.wantsPlay && !video.ended;
    const key = want.map((w) => w.k).join();
    const asked = this.requested;
    if (!asked || forget.length || key !== asked.key || playing !== asked.playing || !Object.is(video.duration, asked.duration) ||
        Math.abs(time - asked.time) > 30) {
      this.requested = { key, playing, time, duration: video.duration };
      const have = [...this.chunks].map(([i, { cut, print }]) => ({ k: i, cut, print }));
      this.engine.post({ type: "want", streamId: this.workerId, chunks: want, forget, have, duration: video.duration, playing, position: time });
    }

    // Hold the video rather than play music while the audio it needs is missing,
    // or while the browser keeps the audio from playing (until a click).
    // A held video waits for a few seconds of audio, not to be held again at once.
    const blocked = this.graph.ctx.state !== "running";
    // Still no sound after the user's click (an audio device that stays gone,
    // a browser that refuses): fail closed, so the panel offers a way out.
    if (!blocked) this.blockedClick = null;
    else if (this.blockedClick !== null && performance.now() - this.blockedClick > AUDIO_START_MS) {
      this.fail("audio", "the sound did not start after a click");
      return;
    }
    const lead = this.intent.held ? 3 : 0.5;
    const needed = !blocked && this.playable(k, time) &&
      (k >= last || time < chunkStart(k + 1) - lead || this.playable(k + 1, chunkStart(k + 1)));
    if (needed || !playing || !audible) {
      if (this.intent.held) this.intent.release();
    } else if (video.readyState >= 3 || this.intent.held || blocked) {
      // A video still buffering is left to the site until it could play.
      this.hold();
    }
    if (blocked) this.holdStarted = performance.now(); // waiting for the user, not for Musicless
    if (this.intent.held && performance.now() - this.holdStarted > HOLD_LIMIT_MS) {
      this.fail("slow");
      return;
    }

    // A video can stall without pausing (network, or the site's own buffering):
    // its clock stops, so our audio must stop too until it moves again. And
    // whatever events did or did not fire, a paused or empty video gets no audio.
    const now = performance.now();
    if (video.currentTime !== this.lastClock) this.noteClock();
    if (this.sources.size && (video.paused || video.readyState < 2)) this.stopAll();
    const stalled = !video.paused && (video.readyState < 3 || now - this.lastClockChange > STALL_MS);
    if (stalled) {
      if (this.sources.size) this.trace({ e: "stall" });
      this.stopAll();
    } else if (!video.paused && !video.seeking) {
      if (this.bus && this.bus.context !== this.graph.ctx) this.resync();
      if (!this.anchor) this.resync();
      else {
        // In iOS Safari, an AudioContext whose hardware unit was detached in a
        // background tab can report state === "running" while its clock stays
        // frozen. Refresh the context once playback advances past two ticks.
        if (IN_SAFARI && this.sources.size && this.graph.ctx.state === "running") {
          const ctxTime = this.graph.ctx.currentTime;
          if (this.lastCtxTime === ctxTime && video.currentTime - this.anchor.media > 0.25) {
            if (++this.frozenCtxTicks >= 2) {
              this.frozenCtxTicks = 0;
              this.lastCtxTime = -1;
              refreshSafariAudio();
              this.resync();
              this.update();
              return;
            }
          } else {
            this.lastCtxTime = ctxTime;
            this.frozenCtxTicks = 0;
          }
        }
        // The drift first: the page holds video.currentTime still within a
        // task while the audio clock moves on, so time spent making audio
        // before reading both would look like drift.
        const expected = this.anchor.media + (this.graph.ctx.currentTime - this.anchor.ctx) * this.anchor.rate;
        const drift = video.currentTime - expected;
        if (DEBUG) {
          this.stats.drift.push(Math.round(drift * 1000));
          if (this.stats.drift.length > 80) this.stats.drift.shift();
        }
        this.driftStrikes = Math.abs(drift) > DRIFT_LIMIT ? (this.driftStrikes ?? 0) + 1 : 0;
        // A steady small offset (e.g. an anchor taken just before the audio
        // device restarted) is corrected too; single jitter spikes are not.
        this.recentDrift = [...(this.recentDrift ?? []), drift].slice(-DRIFT_SAMPLES);
        const steady = this.recentDrift.length === DRIFT_SAMPLES &&
          (this.recentDrift.every((d) => d > DRIFT_STEADY) || this.recentDrift.every((d) => d < -DRIFT_STEADY)) &&
          !(performance.now() - (this.steadyAt ?? -Infinity) < 20000); // not again if it did not help
        if (this.driftStrikes >= 2 || steady) {
          this.driftStrikes = 0;
          if (steady) this.steadyAt = performance.now();
          this.trace({ e: "drift", ms: Math.round(drift * 1000), steady });
          this.resync();
        } else {
          for (let i = k; i <= k + 2; i++) this.schedule(i);
          this.fillStretched();
        }
      }
    }
    this.update();
  }

  // ---- state for the button ---------------------------------------------------

  computeStatus() {
    if (!this.settings.consented) return "setup";
    if (!this.on) return "off";
    if (this.failure) return "failed";
    const ctx = this.graph?.ctx;
    const { ended, volume } = this.video;
    const muted = isMuted(this.video);
    if (ctx && ctx.state !== "running" && this.intent.wantsPlay && !ended && !muted && volume > 0) return "blocked";
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
      stretched: [...this.sources].filter(([, source]) => source.fill).map(([k, source]) => `${k}:${source.rate}`),
    };
  }
}
