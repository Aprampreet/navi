"""Export Ultralytics YOLO11n to the exact tensor format NAVI's Android decoder expects."""
from pathlib import Path
import shutil

from ultralytics import YOLO
import onnx

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "mobile/android/app/src/main/assets/yolo11n.onnx"

model = YOLO("yolo11n.pt")  # Ultralytics COCO pretrained checkpoint
exported = Path(model.export(format="onnx", imgsz=640, opset=12, simplify=True,
                             dynamic=False, nms=False))
graph = onnx.load(exported)
onnx.checker.check_model(graph)
shape = [d.dim_value for d in graph.graph.input[0].type.tensor_type.shape.dim]
output = [d.dim_value for d in graph.graph.output[0].type.tensor_type.shape.dim]
assert shape == [1, 3, 640, 640], shape
assert len(output) == 3 and output[0:2] == [1, 84], output
DEST.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(exported, DEST)
print(f"Bundled {DEST} with input={shape} output={output}")
