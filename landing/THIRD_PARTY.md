# Browser audio tool dependencies

The website runs its own music-removal model on the same ONNX Runtime as the
Musicless extension. The Musicless and ONNX Runtime licenses and ONNX Runtime's
third-party notices are included beside this file.

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

The music detector, `assets/engine/detector.onnx`, was trained with
`tools/detector.py` on mixtures of speech from FLEURS (Google, CC BY 4.0,
https://huggingface.co/datasets/google/fleurs), singing from VocalSet (Julia
Wilkins, Prem Seetharaman, Alison Wahl and Bryan Pardo, CC BY 4.0,
https://doi.org/10.5281/zenodo.1442513, through the mirror
https://huggingface.co/datasets/Bill13579/vocalset-mirror) and music from the
FMA small set (the Free Music Archive's tracks under Creative Commons licenses
chosen by their artists, https://github.com/mdeff/fma), and on real
recordings: podcasts of Thmanyah (https://thmanyah.com, from its YouTube
channels, used with Thmanyah's permission; tools/detector-episodes.json lists
them) and Friday sermons from the Sermon Audio and Text (SAT) dataset (CC BY
4.0, https://doi.org/10.17632/fnz5bt24st.1). It contains no audio from any of
them.
