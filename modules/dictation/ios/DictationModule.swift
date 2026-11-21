// Expo module "Dictation": on-device dictation (DictationEngine.swift). This
// file sets up the audio session, the permissions and the events.
//
// Events (all carry the run `id` that JS gave to start):
//   speechLevel {id, level}          about every 60 ms while it listens
//   speechText  {id, text}           one final piece of text
//   speechEnd   {id, error?, reason?} the run ended; reason "interrupted"
//                                    when iOS took the audio (a call, Siri)
//   speechInstallProgress {language, progress}
//
// Two engines: on the device (DictationEngine.swift, iOS 26) and Deepgram
// (DeepgramRun.swift, any iOS). One run at a time for both.
import AVFoundation
import ExpoModulesCore
import Speech

internal final class DictationNeedsIOS26Exception: Exception, @unchecked Sendable {
  override var reason: String { "ios-too-old" }
}

internal final class DictationEngineException: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}

public final class DictationModule: Module {
  private let lock = NSLock()
  private var run: AnyObject?
  private var runId: String?
  private var lastLevel = Date.distantPast
  private var interruption: NSObjectProtocol?
  private var deepgram: (run: DeepgramRun, id: String)?
  private var deepgramCanceled = false

  public func definition() -> ModuleDefinition {
    Name("Dictation")

    Events("speechLevel", "speechText", "speechEnd", "speechInstallProgress")

    OnDestroy {
      if #available(iOS 26.0, *) { Task { await self.cancelRun() } }
    }

    Function("isSupported") { () -> Bool in
      Self.supported()
    }

    Function("microphonePermission") { () -> String in
      Self.microphonePermission()
    }

    AsyncFunction("requestMicrophone") { (promise: Promise) in
      Self.requestMicrophone { promise.resolve($0) }
    }

    AsyncFunction("status") { (language: String) async throws -> [String: String] in
      guard #available(iOS 26.0, *) else { throw DictationNeedsIOS26Exception() }
      return await DictationModules.status(language: language).dictionary
    }

    AsyncFunction("install") { (language: String) async throws in
      guard #available(iOS 26.0, *) else { throw DictationNeedsIOS26Exception() }
      do {
        try await DictationModules.install(language: language) { [weak self] progress in
          self?.sendEvent("speechInstallProgress", ["language": language, "progress": progress])
        }
      } catch {
        throw DictationEngineException(Self.code(error))
      }
    }

    AsyncFunction("start") { (id: String, language: String) async throws in
      guard #available(iOS 26.0, *) else { throw DictationNeedsIOS26Exception() }
      try await self.startRun(id: id, language: language, file: nil)
    }

    // An audio file instead of the microphone: only in a debug build, for
    // the E2E flow (issue 07 slice F). A Release build refuses it.
    AsyncFunction("startFile") { (id: String, language: String, path: String) async throws in
      #if DEBUG
        guard #available(iOS 26.0, *) else { throw DictationNeedsIOS26Exception() }
        try await self.startRun(id: id, language: language, file: URL(fileURLWithPath: path))
      #else
        throw DictationEngineException("not-allowed")
      #endif
    }

    // Deepgram (issue 07 slice E): any iOS. `token` is the Mac's short-lived
    // grant. DeepgramRun.swift fixes the host to api.deepgram.com.
    AsyncFunction("startDeepgram") { (id: String, language: String, token: String) async throws in
      try await self.startDeepgram(id: id, language: language, token: token)
    }

    AsyncFunction("stop") { () async in
      await self.stopAny(keep: true, reason: nil)
    }

    AsyncFunction("cancel") { () async in
      await self.stopAny(keep: false, reason: "canceled")
    }
  }

  private static func supported() -> Bool {
    if #available(iOS 26.0, *) { return true }
    return false
  }

  private static func microphonePermission() -> String {
    switch AVAudioSession.sharedInstance().recordPermission {
    case .granted: return "granted"
    case .denied: return "denied"
    default: return "undetermined"
    }
  }

  private static func requestMicrophone(_ done: @escaping (Bool) -> Void) {
    AVAudioSession.sharedInstance().requestRecordPermission { done($0) }
  }

  private static func code(_ error: Error) -> String {
    if let e = error as? DictationEngineError { return e.description }
    if let e = error as? DeepgramError { return e.description }
    return "engine: \((error as NSError).domain) \((error as NSError).code)"
  }

  private func busy() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return run != nil || deepgram != nil
  }

  private func startDeepgram(id: String, language: String, token: String) async throws {
    if busy() { throw DictationEngineException("already-running") }
    let callbacks = DictationCallbacks(
      level: { [weak self] level in self?.level(id: id, level: level) },
      text: { [weak self] text in self?.sendEvent("speechText", ["id": id, "text": text]) })
    let newRun: DeepgramRun
    do {
      newRun = try DeepgramRun(language: language, token: token, callbacks: callbacks) { [weak self] error in
        guard let self else { return }
        let canceled = self.lock.withLock { () -> Bool in
          let canceled = self.deepgramCanceled
          if self.deepgram?.id == id { self.deepgram = nil }
          self.deepgramCanceled = false
          return canceled
        }
        self.deactivateSession()
        var body: [String: Any] = ["id": id]
        if canceled { body["reason"] = "canceled" } else if let error { body["error"] = Self.code(error) }
        self.sendEvent("speechEnd", body)
      }
    } catch {
      throw DictationEngineException(Self.code(error))
    }
    lock.withLock {
      deepgram = (newRun, id)
      deepgramCanceled = false
    }
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
      try session.setActive(true)
      watchInterruptions()
      try await newRun.start()
    } catch {
      lock.withLock { deepgram = nil }
      deactivateSession()
      throw DictationEngineException(Self.code(error))
    }
  }

  /// Stops the run that is on, of either engine.
  private func stopAny(keep: Bool, reason: String?) async {
    let active = lock.withLock { () -> DeepgramRun? in
      guard let deepgram else { return nil }
      if !keep { deepgramCanceled = true }
      return deepgram.run
    }
    if let active {
      // The end comes through the run's onEnd.
      if keep { active.stop() } else { active.cancel() }
      return
    }
    if #available(iOS 26.0, *) { await stopRun(keep: keep, reason: reason) }
  }

  @available(iOS 26.0, *)
  private func current() -> (DictationRun, String)? {
    lock.lock()
    defer { lock.unlock() }
    guard let run = run as? DictationRun, let runId else { return nil }
    return (run, runId)
  }

  @available(iOS 26.0, *)
  private func startRun(id: String, language: String, file: URL?) async throws {
    if busy() { throw DictationEngineException("already-running") }
    let callbacks = DictationCallbacks(
      level: { [weak self] level in self?.level(id: id, level: level) },
      text: { [weak self] text in self?.sendEvent("speechText", ["id": id, "text": text]) })
    let newRun = DictationRun(callbacks: callbacks)
    lock.lock()
    run = newRun
    runId = id
    lock.unlock()

    if let file {
      // The file run ends by itself.
      Task {
        var failure: String?
        do { try await newRun.runFile(file, language: language) } catch { failure = Self.code(error) }
        self.finish(id: id, error: failure, reason: nil)
      }
      return
    }

    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
      try session.setActive(true)
      watchInterruptions()
      try await newRun.startMicrophone(language: language)
    } catch {
      await newRun.cancel()
      clear(id: id)
      deactivateSession()
      throw DictationEngineException(Self.code(error))
    }
  }

  private func level(id: String, level: Float) {
    let now = Date()
    lock.lock()
    let send = now.timeIntervalSince(lastLevel) >= 0.06
    if send { lastLevel = now }
    lock.unlock()
    if send { sendEvent("speechLevel", ["id": id, "level": level]) }
  }

  @available(iOS 26.0, *)
  private func stopRun(keep: Bool, reason: String?) async {
    guard let (run, id) = current() else { return }
    var failure: String?
    if keep {
      do { try await run.stop() } catch { failure = Self.code(error) }
    } else {
      await run.cancel()
    }
    finish(id: id, error: failure, reason: reason)
  }

  @available(iOS 26.0, *)
  private func cancelRun() async {
    await stopAny(keep: false, reason: "canceled")
  }

  private func clear(id: String) {
    lock.lock()
    if runId == id {
      run = nil
      runId = nil
    }
    lock.unlock()
  }

  private func finish(id: String, error: String?, reason: String?) {
    clear(id: id)
    deactivateSession()
    var body: [String: Any] = ["id": id]
    if let error { body["error"] = error }
    if let reason { body["reason"] = reason }
    sendEvent("speechEnd", body)
  }

  private func watchInterruptions() {
    guard interruption == nil else { return }
    interruption = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification, object: nil, queue: nil
    ) { [weak self] note in
      guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        AVAudioSession.InterruptionType(rawValue: raw) == .began
      else { return }
      Task { await self?.stopAny(keep: true, reason: "interrupted") }
    }
  }

  private func deactivateSession() {
    if let interruption {
      NotificationCenter.default.removeObserver(interruption)
      self.interruption = nil
    }
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }
}
