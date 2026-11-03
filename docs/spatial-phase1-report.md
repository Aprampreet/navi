# NAVI spatial mapping phase 1 — implementation report

Date: 2026-11-04  
Device: Motorola edge 30, Android 14, approximately 6 GB physical RAM

## Implemented vertical slice

- Bundled, offline SegFormer-B0 ADE20K quantized ONNX model (4.2 MB).
- Runs beside YOLO on a dedicated executor; YOLO was not replaced.
- Uses a 384 x 384 dynamic input every approximately three seconds.
- Samples the lower camera image and maps semantic evidence into LEFT, CENTRE,
  and RIGHT.
- Emits only `POTENTIAL_GROUND`, `OBSTRUCTED`, or `UNKNOWN`.
- Treats road, stairs, vegetation, poor visibility, and insufficient confidence
  as `UNKNOWN`.
- YOLO boxes intersecting the lower camera corridor override segmentation and
  mark that image region `OBSTRUCTED`.
- Requires two agreeing frames before publishing a state.
- Deduplicates unchanged scenes and routes optional spoken summaries through
  the existing camera alert queue at low priority.
- Adds a three-region debug overlay and a textual research preview.
- Explicitly states that the output is not a safe or physically clear path.

## Device measurements

Short supervised samples on the installed standalone release produced:

- Segmentation inference: about 0.55–0.72 seconds after warm-up; first pass up
  to about 0.86–0.97 seconds.
- Segmentation cadence: approximately one scan every three seconds.
- Existing YOLO pipeline in the optimized debug benchmark: 1.6 analyzed FPS,
  about 490 ms inference, about 1 ms delivery to JavaScript.
- Standalone release memory during active assistance: about 788 MB total PSS,
  797 MB RSS, and 75 MB swap PSS.
- Android thermal status: 0 (no platform-reported throttling) during the short
  run. Observed instantaneous readings included battery 42 C, skin about 52.9
  C, GPU about 58.8 C, and CPU7 about 66.7 C.

These are short-run measurements, not a long-duration thermal qualification.
Long walks still require extended battery and thermal testing.

## Observed results and false positives

- Existing person detection continued while the corridor model ran.
- The corridor model produced repeated centre obstruction states while people
  were present in the camera view.
- Poor/flat visibility produced `UNKNOWN`, as required.
- One transient office/low-light frame classified all three regions as
  `POTENTIAL_GROUND`. The following frame disagreed, so temporal smoothing
  prevented that false positive from being published or spoken.
- Unchanged `UNKNOWN` scenes stayed quiet after stabilization.

## Still requiring controlled field validation

The following scenes have not yet been completed as a controlled, labelled
physical-device test and must not be claimed as validated:

- Open outdoor sidewalk.
- Road directly beside sidewalk.
- Curbs and drop-offs.
- Stairs under varied viewpoints.
- Strong shadows and glare.
- Partial surface occlusion.
- Deliberate camera motion sequences.
- Extended thermal behavior and battery drain.

No move-left, move-right, numeric-step, collision-prediction, depth, or
safe-path command is implemented.
