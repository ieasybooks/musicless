"""Build the extension's single Spleeter model file.

Merges sherpa-onnx's two Spleeter 2-stem networks (vocals and accompaniment,
MIT-licensed weights from Deezer) into one graph that outputs the vocal soft
mask directly, and stores the weights as fp16 with casts back to fp32 at load,
which halves the download without changing the fp32 arithmetic.

Usage: build_model.py <dir containing vocals.onnx and accompaniment.onnx> <out.onnx>
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import compose, helper, numpy_helper

EPS = 1e-10


def prefixed(path: Path, prefix: str) -> onnx.GraphProto:
    model = onnx.load(path)
    return compose.add_prefix(model, prefix).graph


def main() -> None:
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    vocals = prefixed(src / "vocals.onnx", "v_")
    accomp = prefixed(src / "accompaniment.onnx", "a_")
    x = helper.make_tensor_value_info("x", onnx.TensorProto.FLOAT, [2, "num_splits", 512, 1024])

    nodes = []
    for graph in (vocals, accomp):
        for node in graph.node:
            node.input[:] = ["x" if name == graph.input[0].name else name for name in node.input]
            nodes.append(node)

    # mask = (v^2 + eps/2) / (v^2 + a^2 + eps): Spleeter's Wiener-style ratio mask.
    v, a = vocals.output[0].name, accomp.output[0].name
    nodes += [
        helper.make_node("Mul", [v, v], ["v2"]),
        helper.make_node("Mul", [a, a], ["a2"]),
        helper.make_node("Add", ["v2", "half_eps"], ["num"]),
        helper.make_node("Add", ["v2", "a2"], ["sum"]),
        helper.make_node("Add", ["sum", "eps"], ["den"]),
        helper.make_node("Div", ["num", "den"], ["mask"]),
    ]
    initializers = list(vocals.initializer) + list(accomp.initializer) + [
        numpy_helper.from_array(np.array(EPS / 2, np.float32), "half_eps"),
        numpy_helper.from_array(np.array(EPS, np.float32), "eps"),
    ]

    # fp16 storage for every weight tensor, cast back to fp32 when the session loads.
    casts = []
    for init in initializers:
        if init.data_type == onnx.TensorProto.FLOAT and len(init.dims) > 1:
            name = init.name
            init.CopyFrom(numpy_helper.from_array(numpy_helper.to_array(init).astype(np.float16), f"{name}_fp16"))
            casts.append(helper.make_node("Cast", [f"{name}_fp16"], [name], to=onnx.TensorProto.FLOAT))

    mask = helper.make_tensor_value_info("mask", onnx.TensorProto.FLOAT, [2, "num_splits", 512, 1024])
    graph = helper.make_graph(casts + nodes, "spleeter_2stems_mask", [x], [mask], initializers)
    model = helper.make_model(graph, opset_imports=list(onnx.load(src / "vocals.onnx").opset_import))
    model.ir_version = 8
    onnx.checker.check_model(model)
    out.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, out)
    print(f"wrote {out} ({out.stat().st_size / 2**20:.1f} MiB)")


if __name__ == "__main__":
    main()
