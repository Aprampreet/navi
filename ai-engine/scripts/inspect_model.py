"""Check the bundled model's input and output before an Android build."""
from pathlib import Path
import onnxruntime as ort

model = Path(__file__).resolve().parents[2] / "mobile/android/app/src/main/assets/yolo11n.onnx"
session = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
input_info = session.get_inputs()[0]
output_info = session.get_outputs()[0]
assert input_info.shape == [1, 3, 640, 640], input_info.shape
assert output_info.shape[0:2] == [1, 84], output_info.shape
print("Input:", input_info.name, input_info.shape)
print("Output:", output_info.name, output_info.shape)
