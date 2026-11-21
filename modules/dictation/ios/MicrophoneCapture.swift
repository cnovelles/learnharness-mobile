// The microphone for both dictation engines: an AVAudioEngine tap that
// sends a level for the meter and the audio in the format that the engine
// wants. No Expo code. The caller sets up the audio session first (iOS).
import AVFoundation
import Foundation

public final class MicrophoneCapture: @unchecked Sendable {
  private var engine: AVAudioEngine?

  public init() {}

  public var running: Bool { engine != nil }

  /// Starts the tap. `target` gets the microphone's format and gives the
  /// format for `onBuffer` (nil: no format fits).
  public func start(
    target: (AVAudioFormat) async -> AVAudioFormat?,
    level: @escaping @Sendable (Float) -> Void,
    onBuffer: @escaping @Sendable (AVAudioPCMBuffer) -> Void
  ) async throws {
    guard engine == nil else { throw DictationEngineError.alreadyRunning }
    let engine = AVAudioEngine()
    let node = engine.inputNode
    let micFormat = node.outputFormat(forBus: 0)
    guard micFormat.sampleRate > 0 else { throw DictationEngineError.microphone("no input") }
    guard let format = await target(micFormat) else { throw DictationEngineError.noAudioFormat }
    let converter = micFormat == format ? nil : AVAudioConverter(from: micFormat, to: format)

    node.installTap(onBus: 0, bufferSize: 1024, format: micFormat) { buffer, _ in
      level(rms(buffer))
      guard let converter else {
        onBuffer(buffer)
        return
      }
      let ratio = format.sampleRate / micFormat.sampleRate
      let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 16
      guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
      var given = false
      var error: NSError?
      converter.convert(to: out, error: &error) { _, status in
        if given {
          status.pointee = .noDataNow
          return nil
        }
        given = true
        status.pointee = .haveData
        return buffer
      }
      if error == nil, out.frameLength > 0 { onBuffer(out) }
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      node.removeTap(onBus: 0)
      throw DictationEngineError.microphone(error.localizedDescription)
    }
    self.engine = engine
  }

  public func stop() {
    guard let engine else { return }
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    self.engine = nil
  }
}
