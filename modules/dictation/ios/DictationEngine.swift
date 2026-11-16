// On-device dictation with Apple SpeechAnalyzer (iOS 26, macOS 26).
// This file has no Expo code, so tests/run-engine-test.sh runs it on macOS
// with an audio file. DictationModule.swift moves calls and events between JS
// and this file.
//
// The engine uses SpeechTranscriber where the device has it, else
// DictationTranscriber (both on the device, no network). An Intel Mac has
// only DictationTranscriber (issue 07 slice A, 2026-11-16).
import AVFoundation
import Foundation
import OSLog
import Speech

/// Facts for a problem report: the engine, the locale, counts. Never the text.
let dictationLog = Logger(subsystem: "dev.local.learnharnessmobile", category: "dictation")

/// What the device can do for one language.
public struct DictationStatus: Sendable {
  /// "speech", "dictation", or "none" (no on-device engine for the language).
  public let engine: String
  /// The locale that the engine uses, for example "en_US". Empty for "none".
  public let locale: String
  /// "installed", "supported" (a download is necessary), "downloading", or "unsupported".
  public let model: String

  public var dictionary: [String: String] { ["engine": engine, "locale": locale, "model": model] }
}

public struct DictationCallbacks: Sendable {
  /// The loudness of the last audio buffer, as RMS (0...1).
  public let level: @Sendable (Float) -> Void
  /// One final piece of text.
  public let text: @Sendable (String) -> Void
  public init(level: @escaping @Sendable (Float) -> Void, text: @escaping @Sendable (String) -> Void) {
    self.level = level
    self.text = text
  }
}

public enum DictationEngineError: Error, CustomStringConvertible {
  case noEngine
  case modelNotInstalled
  case noAudioFormat
  case alreadyRunning
  case microphone(String)

  /// A code that the JS side maps to a message for the user.
  public var description: String {
    switch self {
    case .noEngine: return "no-engine"
    case .modelNotInstalled: return "model-not-installed"
    case .noAudioFormat: return "no-audio-format"
    case .alreadyRunning: return "already-running"
    case .microphone(let detail): return "microphone: \(detail)"
    }
  }
}

@available(iOS 26.0, macOS 26.0, *)
public enum DictationModules {
  /// The best on-device module for a language, or nil.
  public static func make(language: String) async -> (module: any SpeechModule, engine: String, locale: Locale)? {
    let wanted = Locale(identifier: language)
    if SpeechTranscriber.isAvailable, let locale = await SpeechTranscriber.supportedLocale(equivalentTo: wanted) {
      return (SpeechTranscriber(locale: locale, preset: .transcription), "speech", locale)
    }
    if let locale = await DictationTranscriber.supportedLocale(equivalentTo: wanted) {
      let module = DictationTranscriber(
        locale: locale, contentHints: [], transcriptionOptions: [.punctuation],
        reportingOptions: [], attributeOptions: [])
      return (module, "dictation", locale)
    }
    return nil
  }

  public static func status(language: String) async -> DictationStatus {
    guard let made = await make(language: language) else {
      return DictationStatus(engine: "none", locale: "", model: "unsupported")
    }
    let model: String
    switch await AssetInventory.status(forModules: [made.module]) {
    case .installed: model = "installed"
    case .downloading: model = "downloading"
    case .supported: model = "supported"
    default: model = "unsupported"
    }
    return DictationStatus(engine: made.engine, locale: made.locale.identifier, model: model)
  }

  /// Downloads the model for a language. `progress` gets 0...1.
  public static func install(language: String, progress: @escaping @Sendable (Double) -> Void) async throws {
    guard let made = await make(language: language) else { throw DictationEngineError.noEngine }
    guard let request = try await AssetInventory.assetInstallationRequest(supporting: [made.module]) else {
      progress(1)
      return
    }
    let observation = request.progress.observe(\.fractionCompleted) { p, _ in progress(p.fractionCompleted) }
    defer { observation.invalidate() }
    try await request.downloadAndInstall()
    progress(1)
  }
}

/// The final texts of a module, as one stream.
@available(iOS 26.0, macOS 26.0, *)
private func finals(of module: any SpeechModule) -> AsyncThrowingStream<String, Error> {
  AsyncThrowingStream { continuation in
    let task = Task {
      do {
        if let m = module as? SpeechTranscriber {
          for try await r in m.results where r.isFinal { continuation.yield(String(r.text.characters)) }
        } else if let m = module as? DictationTranscriber {
          for try await r in m.results where r.isFinal { continuation.yield(String(r.text.characters)) }
        }
        continuation.finish()
      } catch {
        continuation.finish(throwing: error)
      }
    }
    continuation.onTermination = { _ in task.cancel() }
  }
}

/// RMS of a float or int16 buffer (0...1).
func rms(_ buffer: AVAudioPCMBuffer) -> Float {
  let frames = Int(buffer.frameLength)
  guard frames > 0 else { return 0 }
  var sum: Float = 0
  if let data = buffer.floatChannelData?[0] {
    for i in 0..<frames { sum += data[i] * data[i] }
  } else if let data = buffer.int16ChannelData?[0] {
    for i in 0..<frames {
      let v = Float(data[i]) / Float(Int16.max)
      sum += v * v
    }
  } else {
    return 0
  }
  return (sum / Float(frames)).squareRoot()
}

/// One dictation run: from the microphone or from an audio file.
@available(iOS 26.0, macOS 26.0, *)
public final class DictationRun: @unchecked Sendable {
  private let callbacks: DictationCallbacks
  private var analyzer: SpeechAnalyzer?
  private var reader: Task<Void, Error>?
  private var audio: AVAudioEngine?
  private var input: AsyncStream<AnalyzerInput>.Continuation?
  private var modules: [any SpeechModule] = []

  public init(callbacks: DictationCallbacks) {
    self.callbacks = callbacks
  }

  private func prepare(language: String) async throws -> SpeechAnalyzer {
    guard let made = await DictationModules.make(language: language) else { throw DictationEngineError.noEngine }
    guard await AssetInventory.status(forModules: [made.module]) == .installed else {
      throw DictationEngineError.modelNotInstalled
    }
    dictationLog.info("prepare engine=\(made.engine, privacy: .public) locale=\(made.locale.identifier, privacy: .public)")
    let analyzer = SpeechAnalyzer(modules: [made.module])
    modules = [made.module]
    let stream = finals(of: made.module)
    let text = callbacks.text
    reader = Task {
      var count = 0
      do {
        for try await piece in stream {
          count += 1
          text(piece)
        }
        dictationLog.info("results ended finals=\(count, privacy: .public)")
      } catch {
        dictationLog.error("results failed finals=\(count, privacy: .public) error=\(String(describing: error), privacy: .public)")
        throw error
      }
    }
    self.analyzer = analyzer
    return analyzer
  }

  /// Transcribes a whole audio file, then ends. For tests and the E2E flow.
  public func runFile(_ url: URL, language: String) async throws {
    let analyzer = try await prepare(language: language)
    let file = try AVAudioFile(forReading: url)
    dictationLog.info("file frames=\(file.length, privacy: .public) rate=\(file.processingFormat.sampleRate, privacy: .public)")
    // A level for the meter, from the file's first buffer (the file has no live audio).
    if let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4096) {
      try? file.read(into: buffer)
      callbacks.level(rms(buffer))
      file.framePosition = 0
    }
    if let end = try await analyzer.analyzeSequence(from: file) {
      dictationLog.info("file analyzed end=\(end.seconds, privacy: .public)")
      try await analyzer.finalizeAndFinish(through: end)
    } else {
      dictationLog.info("file analyzed with no end")
      await analyzer.cancelAndFinishNow()
    }
    try await reader?.value
  }

  /// Starts to listen to the microphone. The caller sets up the audio session first (iOS).
  public func startMicrophone(language: String) async throws {
    guard audio == nil else { throw DictationEngineError.alreadyRunning }
    let analyzer = try await prepare(language: language)
    let engine = AVAudioEngine()
    let node = engine.inputNode
    let micFormat = node.outputFormat(forBus: 0)
    guard micFormat.sampleRate > 0 else { throw DictationEngineError.microphone("no input") }
    guard let target = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules, considering: micFormat)
    else { throw DictationEngineError.noAudioFormat }
    let converter = micFormat == target ? nil : AVAudioConverter(from: micFormat, to: target)

    var continuation: AsyncStream<AnalyzerInput>.Continuation!
    let stream = AsyncStream<AnalyzerInput> { continuation = $0 }
    input = continuation
    let level = callbacks.level
    let feed = continuation!
    node.installTap(onBus: 0, bufferSize: 1024, format: micFormat) { buffer, _ in
      level(rms(buffer))
      if let converter {
        let ratio = target.sampleRate / micFormat.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 16
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
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
        if error == nil, out.frameLength > 0 { feed.yield(AnalyzerInput(buffer: out)) }
      } else {
        feed.yield(AnalyzerInput(buffer: buffer))
      }
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      node.removeTap(onBus: 0)
      throw DictationEngineError.microphone(error.localizedDescription)
    }
    audio = engine
    try await analyzer.start(inputSequence: stream)
  }

  /// Stops the microphone, waits for the last final texts, then returns.
  public func stop() async throws {
    stopMicrophone()
    if let analyzer {
      try await analyzer.finalizeAndFinishThroughEndOfInput()
    }
    try await reader?.value
    analyzer = nil
  }

  /// Stops at once and drops the text that is not final yet.
  public func cancel() async {
    stopMicrophone()
    await analyzer?.cancelAndFinishNow()
    reader?.cancel()
    analyzer = nil
  }

  private func stopMicrophone() {
    if let engine = audio {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
    }
    audio = nil
    input?.finish()
    input = nil
  }
}
