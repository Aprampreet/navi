# NAVI phase-one segmentation model

NAVI bundles `segformer_b0_ade20k_quantized.onnx` for the supervised
walkable-area research preview.

- Upstream model: NVIDIA SegFormer-B0 fine-tuned on ADE20K
- ONNX conversion: Xenova `segformer-b0-finetuned-ade-512-512`
- File: `onnx/model_quantized.onnx`
- SHA-256: `9a98d6daf3d926869ab8cc4c2ed7374a2bc23b889bb7ca3b0915d15e3c4756bb`
- Reference input: RGB tensor named `pixel_values`, dynamic NCHW, with a 512 x
  512 upstream preprocessor and ImageNet mean/std. NAVI uses 384 x 384 for the
  Motorola edge 30 performance profile.
- Output: 150 ADE20K semantic-class logits named `logits`
- Bundled size: approximately 4.2 MB

The phase-one classifier uses the model's `floor`, `sidewalk`, and `path`
classes as evidence of a *possible pedestrian surface*. It separately tracks
`road`, `stairs`/`stairway`/`step`, and vegetation classes. Road, stairs,
vegetation, low-confidence output, and poor visibility are never treated as
potential ground. YOLO bounding boxes take precedence and mark an intersecting
camera corridor as `OBSTRUCTED`.

This is a monocular image-space research aid. It does not estimate depth,
curbs, drop-offs, collision risk, physical clearance, or a safe route. The UI
must never describe a region as safe or clear and must not issue movement or
step-count commands from this output.

## License restriction

The bundled NVIDIA model license permits only non-commercial research and
evaluation. The ADE20K dataset also limits image use to non-commercial research
and educational purposes. This model is therefore suitable for the current
supervised prototype/demo, not a commercial release. A commercially licensed
replacement and a new validation campaign are required before distribution.

The upstream NVIDIA license is copied into the Android assets as
`SEGFORMER-LICENSE`.
