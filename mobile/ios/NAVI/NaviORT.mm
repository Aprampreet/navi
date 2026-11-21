#import "NaviORT.h"
#include <onnxruntime_cxx_api.h>
#include <memory>
#include <string>
#include <vector>

namespace {
Ort::Env &NaviORTEnvironment() {
  static Ort::Env environment(ORT_LOGGING_LEVEL_WARNING, "NAVI");
  return environment;
}

NSError *NaviORTError(const char *message) {
  NSString *description = message ? [NSString stringWithUTF8String:message] : @"ONNX Runtime failed";
  return [NSError errorWithDomain:@"NAVI.ONNX" code:1
                         userInfo:@{NSLocalizedDescriptionKey: description}];
}
}  // namespace

@implementation NaviORTSession {
  std::unique_ptr<Ort::Session> _session;
  std::string _inputName;
  std::string _outputName;
}

- (nullable instancetype)initWithModelPath:(NSString *)modelPath
                                   threads:(NSInteger)threads
                                     error:(NSError **)error {
  self = [super init];
  if (!self) return nil;
  try {
    Ort::SessionOptions options;
    options.SetIntraOpNumThreads((int)MAX(1, threads));
    options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
    _session = std::make_unique<Ort::Session>(NaviORTEnvironment(),
                                              modelPath.fileSystemRepresentation,
                                              options);
    Ort::AllocatorWithDefaultOptions allocator;
    auto input = _session->GetInputNameAllocated(0, allocator);
    auto output = _session->GetOutputNameAllocated(0, allocator);
    _inputName = input.get();
    _outputName = output.get();
  } catch (const Ort::Exception &exception) {
    if (error) *error = NaviORTError(exception.what());
    return nil;
  } catch (const std::exception &exception) {
    if (error) *error = NaviORTError(exception.what());
    return nil;
  }
  return self;
}

- (nullable NSDictionary<NSString *, id> *)runFloatTensor:(NSData *)data
                                                     shape:(NSArray<NSNumber *> *)shape
                                                     error:(NSError **)error {
  try {
    std::vector<int64_t> dimensions;
    dimensions.reserve(shape.count);
    size_t expectedCount = 1;
    for (NSNumber *number in shape) {
      int64_t value = number.longLongValue;
      if (value <= 0) {
        if (error) *error = NaviORTError("Tensor dimensions must be positive");
        return nil;
      }
      dimensions.push_back(value);
      expectedCount *= (size_t)value;
    }
    if (data.length != expectedCount * sizeof(float)) {
      if (error) *error = NaviORTError("Tensor data length does not match its shape");
      return nil;
    }

    Ort::MemoryInfo memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    auto tensor = Ort::Value::CreateTensor<float>(memory,
                                                   (float *)data.bytes,
                                                   expectedCount,
                                                   dimensions.data(),
                                                   dimensions.size());
    const char *inputNames[] = {_inputName.c_str()};
    const char *outputNames[] = {_outputName.c_str()};
    auto outputs = _session->Run(Ort::RunOptions{nullptr}, inputNames, &tensor, 1,
                                 outputNames, 1);
    auto info = outputs.front().GetTensorTypeAndShapeInfo();
    if (info.GetElementType() != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT) {
      if (error) *error = NaviORTError("NAVI expects a float ONNX output tensor");
      return nil;
    }
    std::vector<int64_t> outputShape = info.GetShape();
    size_t outputCount = info.GetElementCount();
    const float *outputData = outputs.front().GetTensorData<float>();
    NSData *resultData = [NSData dataWithBytes:outputData length:outputCount * sizeof(float)];
    NSMutableArray<NSNumber *> *resultShape = [NSMutableArray arrayWithCapacity:outputShape.size()];
    for (int64_t value : outputShape) [resultShape addObject:@(value)];
    return @{ @"data": resultData, @"shape": resultShape };
  } catch (const Ort::Exception &exception) {
    if (error) *error = NaviORTError(exception.what());
  } catch (const std::exception &exception) {
    if (error) *error = NaviORTError(exception.what());
  }
  return nil;
}

@end
