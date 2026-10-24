// nomusic offline: a pill on each video toggles music removal. Audio comes from
// capture.js (the player's own Media Source appends), separation runs in an
// extension worker inside a hidden iframe, and the vocals are scheduled with
// Web Audio against the video's clock while the original track is silenced.

(() => {
  const NS = "nomusic-offline";
  const CHUNK = 524288 / 44100; // seconds per separated chunk (dsp.js CHUNK_SECONDS)
  const AHEAD = 6; // chunks to keep ready ahead of the playhead
  const BEHIND = 2;
  const TICK_MS = 250;
  const DRIFT_LIMIT = 0.045;
  const HOLD_LIMIT_MS = 30000;
  const UNKNOWN_SOURCE_MS = 2000;
  const STALL_MS = 400; // playing but the clock has not moved for this long
  const debug = () => {
    try { return localStorage.getItem("nomusicDebug") === "1"; } catch { return false; }
  };

  const streamsByUrl = new Map();
  const sessions = new Map(); // video -> Session

  // Pitch-preserving time-stretch for playback rates other than 1 (SoundTouch
  // WSOLA, shared with the main extension), loaded on first use.
  let stretcher = null;
  const loadStretcher = () =>
    (stretcher ??= import(chrome.runtime.getURL("stretch.js")).then((module) => new module.StretchClient()));

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.[NS] === "capture") {
      if (data.type === "stream") {
        if (data.url) streamsByUrl.set(data.url, data.streamId);
        for (const session of sessions.values()) session.checkSource();
      } else if (data.type === "replay" || data.type === "event") {
        const entries = data.type === "replay" ? data.entries : [data.entry];
        for (const session of sessions.values()) session.onEntries(data.streamId, entries);
      }
    } else if (data?.[NS] === "debug" && debug()) {
      handleDebug(data);
    }
  });
  const control = (message) => window.postMessage({ [NS]: "control", ...message }, "*");
  control({ type: "hello" });

  function createEngine(onMessage) {
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("separator.html");
    iframe.style.display = "none";
    iframe.setAttribute("aria-hidden", "true");
    const channel = new MessageChannel();
    channel.port1.onmessage = onMessage;
    iframe.addEventListener("load", () => {
      iframe.contentWindow.postMessage({ type: "nomusic-port" }, new URL(iframe.src).origin, [channel.port2]);
    }, { once: true });
    document.documentElement.appendChild(iframe);
    return {
      post: (message, transfer) => channel.port1.postMessage(message, transfer ?? []),
      destroy() {
        channel.port1.close();
        iframe.remove();
      },
    };
  }

  class Session {
    constructor(video) {
      this.video = video;
      this.enabled = false;
      this.ctx = null;
      this.chunks = new Map(); // k -> { buffer: AudioBuffer, validFrom: media seconds }
      this.sources = new Map(); // k -> AudioBufferSourceNode
      this.requested = [];
      this.anchor = null;
      this.holding = false;
      this.status = "off";
      this.error = null;
      this.stats = { holds: 0, resyncs: 0, chunks: 0, timings: [], drift: [], firstAudioMs: null, modelSeconds: null };
      this.events = [];
      this.pill = this.makePill();
      this.listeners = [];
      this.tick = this.tick.bind(this);
    }

    makePill() {
      const pill = document.createElement("button");
      pill.className = "nomusic-offline-pill";
      pill.textContent = "nomusic";
      for (const type of ["pointerdown", "mousedown", "mouseup", "dblclick"]) {
        pill.addEventListener(type, (event) => event.stopPropagation());
      }
      pill.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
        this.enabled ? this.disable() : this.enable();
      });
      return pill;
    }

    place() {
      const rect = this.video.getBoundingClientRect();
      const host = document.fullscreenElement ?? document.documentElement;
      if (this.pill.parentElement !== host) host.appendChild(this.pill);
      const visible = rect.width >= 200 && rect.height >= 100 && this.video.isConnected;
      this.pill.style.display = visible ? "" : "none";
      this.pill.dataset.area = String(Math.round(rect.width * rect.height));
      this.pill.style.left = `${Math.max(0, rect.left + 10)}px`;
      this.pill.style.top = `${Math.max(0, rect.top + 10)}px`;
    }

    setStatus(status, detail) {
      this.status = status;
      const ahead = this.bufferedAhead();
      const labels = {
        off: "nomusic",
        loading: "nomusic · starting…",
        preparing: "nomusic · preparing…",
        on: `nomusic · on${ahead > 0 ? ` · ${Math.floor(ahead)}s ready` : ""}`,
        original: `nomusic · original audio${this.originalReason ? ` (${this.originalReason})` : ""}`,
        error: `nomusic · ${detail ?? this.error}`,
      };
      this.pill.textContent = labels[status];
      this.pill.dataset.status = status;
      this.pill.dataset.state = JSON.stringify(this.snapshot());
    }

    snapshot() {
      return {
        status: this.status,
        error: this.error,
        streamId: this.streamId ?? null,
        currentTime: this.video.currentTime,
        ahead: this.bufferedAhead(),
        chunks: [...this.chunks.keys()].sort((a, b) => a - b),
        holding: this.holding,
        originalGain: this.originalGain?.gain.value ?? null,
        outputGain: this.outputGain?.gain.value ?? null,
        ...this.stats,
        timings: this.stats.timings.slice(-20),
        worker: debug() ? this.workerStats ?? null : undefined,
        scheduled: [...this.sources.keys()],
        events: debug() ? this.events.slice(-60) : undefined,
        stretched: [...this.chunks].filter(([, c]) => c.stretched || c.stretching).map(([k, c]) => `${k}:${c.stretched?.rate ?? "-"}/${c.stretching ?? "-"}`),
      };
    }

    bufferedAhead() {
      let k = Math.floor(this.video.currentTime / CHUNK);
      if (!this.playable(k, this.video.currentTime)) return 0;
      while (this.chunks.has(k + 1)) k++;
      return (k + 1) * CHUNK - this.video.currentTime;
    }

    // ---- lifecycle ----------------------------------------------------------

    enable() {
      this.enabled = true;
      this.error = null;
      this.enabledAt = performance.now();
      this.stats.firstAudioMs = null;
      try {
        this.setupAudio();
      } catch (error) {
        this.fail(`audio setup failed: ${error.message}`);
        return;
      }
      this.engine = createEngine((event) => this.onWorker(event.data));
      const on = (type, handler) => {
        this.video.addEventListener(type, handler);
        this.listeners.push([type, handler]);
      };
      on("seeking", () => this.stopAll());
      on("seeked", () => this.resync());
      on("playing", () => this.resync());
      on("pause", () => {
        this.stopAll();
        // The pause event arrives asynchronously; only our own hold is expected.
        if (this.holdPausePending) this.holdPausePending = false;
        else this.holding = false;
      });
      on("ratechange", () => this.resync());
      on("waiting", () => this.stopAll()); // the video is buffering: its clock stops
      on("timeupdate", () => {
        if (this.video.currentTime !== this.lastClock) this.noteClock();
      });
      on("volumechange", () => this.applyVolume());
      on("loadstart", () => this.checkSource());
      on("emptied", () => this.checkSource());
      this.timer = setInterval(this.tick, TICK_MS);
      this.applyVolume();
      this.originalGain.gain.value = 0;
      this.setStatus("loading");
      this.streamId = null;
      this.sourceUrl = null; // forces checkSource to resolve the current source
      this.checkSource();
      control({ type: "hello" });
    }

    disable() {
      this.enabled = false;
      clearInterval(this.timer);
      for (const [type, handler] of this.listeners) this.video.removeEventListener(type, handler);
      this.listeners = [];
      this.stopAll();
      if (this.streamId) control({ type: "unsubscribe", streamId: this.streamId });
      this.streamId = null;
      this.sourceUrl = null;
      this.gaveUpUrl = null;
      this.unknownSince = null;
      this.engine?.destroy();
      this.engine = null;
      this.chunks.clear();
      this.requested = [];
      if (this.originalGain) this.originalGain.gain.value = 1;
      if (this.holding) {
        this.holding = false;
        this.video.play().catch(() => {});
      }
      this.setStatus("off");
    }

    destroy() {
      if (this.enabled) this.disable();
      this.pill.remove();
    }

    fail(message) {
      this.error = message;
      this.setStatus("error", message);
    }

    setupAudio() {
      if (this.ctx) {
        this.ctx.resume();
        return;
      }
      this.ctx = new AudioContext({ latencyHint: "playback" });
      // Routing the element through Web Audio lets us silence its track
      // without touching the page's own volume or mute controls.
      this.elementSource = this.ctx.createMediaElementSource(this.video);
      this.originalGain = this.ctx.createGain();
      this.outputGain = this.ctx.createGain();
      this.elementSource.connect(this.originalGain).connect(this.ctx.destination);
      this.outputGain.connect(this.ctx.destination);
      if (debug()) this.recorder = new Recorder(this.ctx, this.elementSource, this.outputGain, this.video);
    }

    applyVolume() {
      if (this.outputGain) this.outputGain.gain.value = this.video.muted ? 0 : this.video.volume;
    }

    // Follow the element's current Media Source; a new one means a new video or an ad.
    checkSource() {
      if (!this.enabled) return;
      const url = this.video.currentSrc || this.video.src;
      if (!url) {
        // Between sources (e.g. an ad handing over to the video): nothing plays.
        this.stopAll();
        return;
      }
      if (url === this.gaveUpUrl) return;
      if (url === this.sourceUrl && (this.streamId || !streamsByUrl.has(url))) return;
      const streamId = streamsByUrl.get(url) ?? null;
      if (this.streamId) control({ type: "unsubscribe", streamId: this.streamId });
      this.stopAll();
      this.chunks.clear();
      this.requested = [];
      this.sourceUrl = url;
      this.streamId = streamId;
      if (streamId) {
        this.unknownSince = null;
        this.originalGain.gain.value = 0;
        this.engine.post({ type: "stream", streamId });
        control({ type: "subscribe", streamId });
        this.setStatus("preparing");
      } else if (url.startsWith("blob:")) {
        // A Media Source we have not heard about yet: keep the original silent
        // briefly in case the capture message is still on its way.
        this.unknownSince = performance.now();
        this.originalGain.gain.value = 0;
        this.setStatus("preparing");
      } else {
        this.useOriginal();
      }
    }

    // A plain file or an uncaptured stream: play the page's own audio.
    useOriginal(reason) {
      this.unknownSince = null;
      this.originalGain.gain.value = 1;
      this.originalReason = reason ?? null;
      this.setStatus("original");
    }

    onEntries(streamId, entries) {
      if (!this.enabled || streamId !== this.streamId) return;
      const transfer = entries.filter((entry) => entry.bytes).map((entry) => entry.bytes.buffer);
      this.engine.post({ type: "entries", streamId, entries }, transfer);
    }

    onWorker(message) {
      if (!this.enabled) return;
      if (message.type === "model") {
        this.stats.modelSeconds = message.seconds;
      } else if (message.type === "error") {
        this.fail(message.message);
      } else if (message.type === "unsupported") {
        // Nothing to separate with here: give the original back at once.
        this.stopAll();
        this.release();
        this.gaveUpUrl = this.sourceUrl;
        if (this.streamId) control({ type: "unsubscribe", streamId: this.streamId });
        this.streamId = null;
        this.useOriginal(message.message);
      } else if (message.type === "stats") {
        this.workerStats = message;
      } else if (message.type === "chunk" && message.streamId === this.streamId) {
        const buffer = this.ctx.createBuffer(2, message.left.length, 44100);
        buffer.copyToChannel(message.left, 0);
        buffer.copyToChannel(message.right, 1);
        this.chunks.set(message.k, { buffer, validFrom: message.validFrom });
        this.stats.chunks++;
        this.stats.timings.push({ k: message.k, ...message.timing });
        if (this.anchor) this.schedule(message.k);
        this.tick();
      }
    }

    // ---- playback -----------------------------------------------------------

    trace(event) {
      if (!debug()) return;
      this.events.push({ ctx: +this.ctx.currentTime.toFixed(3), media: +this.video.currentTime.toFixed(3), ...event });
      if (this.events.length > 120) this.events.shift();
    }

    stopAll() {
      if (this.sources.size) this.trace({ e: "stop", n: this.sources.size });
      for (const source of this.sources.values()) {
        try { source.stop(); } catch { /* already stopped */ }
        source.disconnect();
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
      if (!this.enabled || !this.streamId || this.video.paused || this.video.seeking || this.video.readyState < 3) return;
      this.noteClock();
      this.stats.resyncs++;
      this.trace({ e: "resync", rate: this.video.playbackRate });
      this.anchor = { ctx: this.ctx.currentTime, media: this.video.currentTime, rate: this.video.playbackRate };
      const k = Math.floor(this.video.currentTime / CHUNK);
      for (let i = k; i <= k + 2; i++) this.schedule(i);
    }

    schedule(k) {
      const chunk = this.chunks.get(k);
      if (!chunk || this.sources.has(k) || !this.anchor) return;
      // Only the current chunk and the next two; later ones are scheduled as playback nears them.
      const current = Math.floor(this.video.currentTime / CHUNK);
      if (k < current || k > current + 2) return;
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
      const now = this.ctx.currentTime + 0.01;
      let when = this.anchor.ctx + (k * CHUNK - this.anchor.media) / rate;
      let offset = 0;
      if (when < now) {
        offset = (now - when) * sourceRate;
        when = now;
      }
      if (offset >= buffer.duration) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = sourceRate;
      source.connect(this.outputGain);
      source.start(when, offset);
      this.trace({ e: "start", k, in: +(when - this.ctx.currentTime).toFixed(3), offset: +offset.toFixed(3), dur: +buffer.duration.toFixed(3), sourceRate, valid: chunk.validFrom });
      source.interim = interim;
      this.sources.set(k, source);
      source.onended = () => {
        if (this.sources.get(k) === source) this.sources.delete(k);
      };
      if (this.stats.firstAudioMs === null) this.stats.firstAudioMs = performance.now() - this.enabledAt;
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
          const buffer = this.ctx.createBuffer(2, out[0].length, chunk.buffer.sampleRate);
          buffer.copyToChannel(out[0], 0);
          buffer.copyToChannel(out[1] ?? out[0], 1);
          chunk.stretched = { rate, buffer };
          chunk.stretching = null;
          if (this.anchor?.rate !== rate) return;
          // Swap a sped-up stand-in for the stretched version from the same point.
          const standIn = this.sources.get(k);
          if (standIn?.interim) {
            try { standIn.stop(); } catch { /* already ended */ }
            standIn.disconnect();
            this.sources.delete(k);
          }
          this.schedule(k);
        })
        .catch((error) => {
          chunk.stretching = null;
          this.fail(`speed change failed: ${error.message}`);
        });
    }

    playable(k, time) {
      const chunk = this.chunks.get(k);
      return !!chunk && chunk.validFrom <= time + 0.05;
    }

    hold() {
      if (this.holding) return;
      this.holding = true;
      this.holdStarted = performance.now();
      this.stats.holds++;
      this.holdPausePending = !this.video.paused;
      this.video.pause();
    }

    release() {
      if (!this.holding) return;
      this.holding = false;
      this.holdPausePending = false;
      this.video.play().catch(() => {});
    }

    tick() {
      if (!this.enabled) return;
      this.place();
      if (!this.streamId) {
        if (this.unknownSince && performance.now() - this.unknownSince > UNKNOWN_SOURCE_MS) this.useOriginal();
        return;
      }
      const video = this.video;
      if (debug() && (this.ticks = (this.ticks ?? 0) + 1) % 8 === 0) this.engine.post({ type: "stats" });
      const k = Math.floor(video.currentTime / CHUNK);
      const last = Number.isFinite(video.duration) ? Math.max(0, Math.ceil(video.duration / CHUNK) - 1) : Infinity;

      // A chunk made after a seek may start late; going back before that needs a redo.
      const forget = [];
      if (this.chunks.has(k) && !this.playable(k, video.currentTime)) {
        this.chunks.delete(k);
        forget.push(k);
      }
      // Ask the worker for the current chunk first (from the playhead), then the ones ahead.
      const want = [];
      for (let i = k; i <= Math.min(k + AHEAD, last); i++) {
        if (!this.chunks.has(i)) want.push({ k: i, from: i === k ? Math.max(0, video.currentTime - 0.25) : i * CHUNK });
      }
      for (const i of this.chunks.keys()) {
        if (i < k - BEHIND || i > k + AHEAD + 1) {
          this.chunks.delete(i);
          forget.push(i);
        }
      }
      if (forget.length || JSON.stringify(want.map((w) => w.k)) !== JSON.stringify(this.requested.map((w) => w.k))) {
        this.requested = want;
        this.engine.post({ type: "want", streamId: this.streamId, chunks: want, forget, duration: video.duration });
      }

      // Pause the video rather than play music while the next chunk is missing.
      const needed = this.playable(k, video.currentTime) &&
        (k >= last || video.currentTime < (k + 1) * CHUNK - 0.5 || this.chunks.has(k + 1));
      // Only hold a video that could play; one still buffering is left to the site.
      if (!needed && !video.paused && !video.ended && video.readyState >= 3) this.hold();
      else if (needed && this.holding) this.release();
      if (this.holding && performance.now() - this.holdStarted > HOLD_LIMIT_MS) {
        // Audio stopped arriving (or cannot be read): give the user the original back.
        this.fail("no audio to separate; playing the original");
        this.originalGain.gain.value = 1;
        this.release();
        this.gaveUpUrl = this.sourceUrl;
        this.streamId = null;
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
          const expected = this.anchor.media + (this.ctx.currentTime - this.anchor.ctx) * this.anchor.rate;
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
      if (this.error) this.setStatus("error");
      else this.setStatus(this.holding || !this.playable(k, video.currentTime) ? "preparing" : "on");
    }
  }

  // ---- debug recording (localStorage.nomusicDebug = "1") -------------------
  // Taps the original element audio and our output on the same clock so tests
  // can measure sync and leakage from what actually played.

  class Recorder {
    constructor(ctx, original, output, video) {
      this.rate = ctx.sampleRate;
      this.ctx = ctx;
      this.video = video;
      this.media = []; // [clock time, media time] pairs for mapping output back to the video
      this.limit = this.rate * 180;
      this.tracks = { original: [], output: [] };
      this.lengths = { original: 0, output: 0 };
      this.times = [];
      const sink = ctx.createGain();
      sink.gain.value = 0;
      sink.connect(ctx.destination);
      for (const [name, node] of [["original", original], ["output", output]]) {
        const tap = ctx.createScriptProcessor(4096, 2, 1);
        tap.onaudioprocess = (event) => {
          const input = event.inputBuffer;
          const left = input.getChannelData(0);
          const right = input.numberOfChannels > 1 ? input.getChannelData(1) : left;
          const mono = new Float32Array(left.length);
          for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (left[i] + right[i]);
          const track = this.tracks[name];
          track.push({ time: event.playbackTime, data: mono });
          if (name === "output") {
            // The media time this block will be heard at, if playback continues as now.
            // A ScriptProcessor hands over its input two buffers after it was rendered.
            const rendered = event.playbackTime - (2 * tap.bufferSize) / this.rate;
            const ahead = (rendered - this.ctx.currentTime) * this.video.playbackRate;
            this.media.push([event.playbackTime, this.video.paused ? null : this.video.currentTime + ahead]);
            if (this.media.length > 4000) this.media.shift();
          }
          this.lengths[name] += mono.length;
          while (this.lengths[name] > this.limit) this.lengths[name] -= track.shift().data.length;
        };
        node.connect(tap);
        tap.connect(sink);
      }
    }

    // Both tracks over the same clock span, as Int16 base64 for transport.
    dump(seconds) {
      const end = Math.min(...["original", "output"].map((name) => {
        const track = this.tracks[name];
        const last = track[track.length - 1];
        return last ? last.time + last.data.length / this.rate : 0;
      }));
      const start = end - seconds;
      const out = {};
      for (const name of ["original", "output"]) {
        const samples = new Int16Array(Math.round(seconds * this.rate));
        for (const block of this.tracks[name]) {
          const at = Math.round((block.time - start) * this.rate);
          for (let i = 0; i < block.data.length; i++) {
            const j = at + i;
            if (j >= 0 && j < samples.length) samples[j] = Math.max(-32768, Math.min(32767, block.data[i] * 32767));
          }
        }
        let binary = "";
        const bytes = new Uint8Array(samples.buffer);
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        out[name] = btoa(binary);
      }
      const media = this.media.filter(([time]) => time >= start && time <= end).map(([time, m]) => [time - start, m]);
      return { rate: this.rate, start, seconds, media, ...out };
    }
  }

  function handleDebug(data) {
    const session = [...sessions.values()].find((candidate) => candidate.enabled) ?? [...sessions.values()][0];
    let reply;
    if (data.type === "dump") reply = session?.recorder?.dump(data.seconds ?? 20) ?? null;
    else if (data.type === "state") reply = session ? session.snapshot() : null;
    window.postMessage({ [NS]: "debug-reply", id: data.id, reply }, "*");
  }

  // ---- discovery -----------------------------------------------------------

  const style = document.createElement("style");
  style.textContent = `
    .nomusic-offline-pill {
      position: fixed; z-index: 2147483647; padding: 6px 12px; border: 0; border-radius: 999px;
      background: rgba(20, 20, 20, 0.82); color: #fff; font: 600 13px/1.2 system-ui, sans-serif;
      cursor: pointer; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    }
    .nomusic-offline-pill[data-status="on"] { background: rgba(22, 120, 70, 0.9); }
    .nomusic-offline-pill[data-status="error"] { background: rgba(160, 30, 30, 0.9); }
  `;

  function discover() {
    if (!style.isConnected && document.documentElement) document.documentElement.appendChild(style);
    for (const video of document.querySelectorAll("video")) {
      if (!sessions.has(video)) {
        const rect = video.getBoundingClientRect();
        if (rect.width < 200 || rect.height < 100) continue;
        sessions.set(video, new Session(video));
      }
    }
    for (const [video, session] of sessions) {
      if (!video.isConnected && !session.enabled) {
        session.destroy();
        sessions.delete(video);
      } else if (!session.enabled) {
        session.place();
      }
    }
  }
  setInterval(discover, 1000);
  document.addEventListener("fullscreenchange", () => {
    for (const session of sessions.values()) session.place();
  });
})();
