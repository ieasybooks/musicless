# Browser audio tool dependencies

The website uses the same Spleeter weights, signal processing and ONNX Runtime
as the Musicless extension. Their MIT licenses and ONNX Runtime third-party
notices are included beside this file.

- Mediabunny 1.66.2, MPL-2.0: https://github.com/Vanilagy/mediabunny/tree/v1.66.2
- @mediabunny/mp3-encoder 1.66.2, MPL-2.0, with LAME (LGPL):
  https://github.com/Vanilagy/mediabunny/tree/v1.66.2/packages/mp3-encoder
- @mediabunny/aac-encoder 1.66.2, MPL-2.0, with FFmpeg (LGPL):
  https://github.com/Vanilagy/mediabunny/tree/v1.66.2/packages/aac-encoder

MP3 encoding uses the [LAME MP3 Encoder](https://lame.sourceforge.io/).
The encoder README files included here identify the exact upstream codec
revisions and include the commands needed to rebuild or replace their WASM.

Unmodified dependency sources and codec build instructions are available at
those links and in the versioned npm source packages. License texts for
Mediabunny, both encoder extensions, LAME and FFmpeg are included here.
Encoders are loaded only when needed after the user starts processing.
