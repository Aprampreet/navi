#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Small Objective-C boundary around ONNX Runtime's C++ API. Swift owns all
/// image preprocessing and interpretation; this object only executes tensors.
@interface NaviORTSession : NSObject

- (nullable instancetype)initWithModelPath:(NSString *)modelPath
                                   threads:(NSInteger)threads
                                     error:(NSError **)error;

- (nullable NSDictionary<NSString *, id> *)runFloatTensor:(NSData *)data
                                                     shape:(NSArray<NSNumber *> *)shape
                                                     error:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
