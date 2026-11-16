// Dictation with Deepgram (issue 07 slice E): the microphone as 16 kHz
// linear16 PCM over a WebSocket to Deepgram, as the desktop does (fork
// components/dictation.tsx and src/core/dictation.ts). No Expo code, so
// tests/run-deepgram-test.sh runs it on macOS against a local server.
//
// Security (docs/TRANSPORT-SECURITY.md, "Deepgram"):
// - The app can open a socket only to wss://api.deepgram.com/v1/listen.
//   The host, the path and the parameters are fixed here; only the
//   language comes from JS, and it must look like a language code.
// - The certificate check is the system's (the default trust handling).
//   A challenge for any other host is refused.
// - The token is a short-lived Deepgram grant (TTL 300 s) that the Mac
//   makes; the Deepgram key never reaches the phone.
import AVFoundation
import Foundation

public enum DeepgramError: Error, CustomStringConvertible {
  case badLanguage
  case refused
  case lost

  /// A code that the JS side maps to a message for the user.
  public var description: String {
    switch self {
    case .badLanguage: return "deepgram-language"
    case .refused: return "deepgram-refused"
    case .lost: return "deepgram-lost"
    }
  }
}

public final class DeepgramRun: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
  public static let host = "api.deepgram.com"
  /// How long stop() waits for Deepgram's last results and close.
  public static let closeTimeout: TimeInterval = 3
  /// Audio kept while the socket opens (16 kHz × 2 bytes × 10 s).
  static let maxQueuedBytes = 320_000

  /// The listen URL: the desktop's parameters, only the language varies.
  public static func listenURL(language: String) throws -> URL {
    guard language.range(of: "^(multi|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$", options: .regularExpression) != nil
    else { throw DeepgramError.badLanguage }
    var parts = URLComponents()
    parts.scheme = "wss"
    parts.host = host
    parts.path = "/v1/listen"
    parts.queryItems = [
      URLQueryItem(name: "model", value: "nova-3"),
      URLQueryItem(name: "encoding", value: "linear16"),
      URLQueryItem(name: "sample_rate", value: "16000"),
      URLQueryItem(name: "channels", value: "1"),
      URLQueryItem(name: "smart_format", value: "true"),
      URLQueryItem(name: "punctuate", value: "true"),
      URLQueryItem(name: "endpointing", value: "300"),
      URLQueryItem(name: "language", value: language),
    ]
    return parts.url!
  }

  /// The final transcript in one Deepgram message, or nil.
  public static func finalText(in message: Data) -> String? {
    guard let object = try? JSONSerialization.jsonObject(with: message) as? [String: Any],
      object["is_final"] as? Bool == true,
      let channel = object["channel"] as? [String: Any],
      let alternatives = channel["alternatives"] as? [[String: Any]],
      let text = alternatives.first?["transcript"] as? String,
      !text.isEmpty
    else { return nil }
    return text
  }

  private let url: URL
  private let token: String
  private let allowedHost: String
  private let callbacks: DictationCallbacks
  private let onEnd: @Sendable (Error?) -> Void
  private let lock = NSLock()
  private var session: URLSession?
  private var task: URLSessionWebSocketTask?
  private var open = false
  private var queued: [Data] = []
  private var queuedBytes = 0
  private var stopping = false
  private var ended = false
  private let microphone = MicrophoneCapture()

  /// The app's way in: only Deepgram's host.
  public convenience init(
    language: String, token: String, callbacks: DictationCallbacks,
    onEnd: @escaping @Sendable (Error?) -> Void
  ) throws {
    try self.init(url: Self.listenURL(language: language), token: token, allowedHost: Self.host,
      callbacks: callbacks, onEnd: onEnd)
  }

  /// Tests only (the same module compiles the test): another URL and host.
  init(url: URL, token: String, allowedHost: String, callbacks: DictationCallbacks,
    onEnd: @escaping @Sendable (Error?) -> Void) {
    self.url = url
    self.token = token
    self.allowedHost = allowedHost
    self.callbacks = callbacks
    self.onEnd = onEnd
  }

  /// Opens the socket. With `microphone` false, the caller sends audio with send(_:) (tests).
  public func start(microphone useMicrophone: Bool = true) async throws {
    let session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)
    let task = session.webSocketTask(with: url, protocols: ["bearer", token])
    lock.withLock {
      self.session = session
      self.task = task
    }
    task.resume()
    receive()
    guard useMicrophone else { return }
    let pcm = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)
    do {
      try await microphone.start(
        target: { _ in pcm },
        level: callbacks.level,
        onBuffer: { [weak self] buffer in
          guard let data = buffer.int16ChannelData?[0] else { return }
          self?.send(Data(bytes: data, count: Int(buffer.frameLength) * 2))
        })
    } catch {
      cancel()
      throw error
    }
  }

  /// Sends audio, or keeps it until the socket is open.
  func send(_ audio: Data) {
    lock.lock()
    if !open {
      queued.append(audio)
      queuedBytes += audio.count
      while queuedBytes > Self.maxQueuedBytes, !queued.isEmpty {
        queuedBytes -= queued.removeFirst().count
      }
      lock.unlock()
      return
    }
    let task = self.task
    lock.unlock()
    task?.send(.data(audio)) { _ in }
  }

  /// Stops the microphone, asks Deepgram for its last results, and waits for the close.
  public func stop() {
    microphone.stop()
    lock.lock()
    stopping = true
    let task = self.task
    lock.unlock()
    task?.send(.string(#"{"type":"CloseStream"}"#)) { _ in }
    DispatchQueue.global().asyncAfter(deadline: .now() + Self.closeTimeout) { [weak self] in
      self?.finish(nil)
    }
  }

  /// Stops at once. Results that are not final are dropped.
  public func cancel() {
    microphone.stop()
    lock.lock()
    stopping = true
    lock.unlock()
    finish(nil)
  }

  private func receive() {
    lock.lock()
    let task = self.task
    lock.unlock()
    task?.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let message):
        switch message {
        case .string(let text):
          if let final = Self.finalText(in: Data(text.utf8)) { self.callbacks.text(final) }
        case .data(let data):
          if let final = Self.finalText(in: data) { self.callbacks.text(final) }
        @unknown default:
          break
        }
        self.receive()
      case .failure:
        self.lock.lock()
        let stopping = self.stopping
        let wasOpen = self.open
        self.lock.unlock()
        // After CloseStream, the close is the normal end.
        self.finish(stopping ? nil : (wasOpen ? DeepgramError.lost : DeepgramError.refused))
      }
    }
  }

  private func finish(_ error: Error?) {
    lock.lock()
    if ended {
      lock.unlock()
      return
    }
    ended = true
    let task = self.task
    let session = self.session
    self.task = nil
    self.session = nil
    queued = []
    lock.unlock()
    microphone.stop()
    task?.cancel(with: .normalClosure, reason: nil)
    session?.invalidateAndCancel()
    onEnd(error)
  }

  // MARK: URLSession delegate

  public func urlSession(
    _ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?
  ) {
    lock.lock()
    open = true
    let pending = queued
    queued = []
    queuedBytes = 0
    lock.unlock()
    for audio in pending { webSocketTask.send(.data(audio)) { _ in } }
  }

  public func urlSession(
    _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
  ) {
    lock.lock()
    let stopping = self.stopping
    lock.unlock()
    finish(stopping || closeCode == .normalClosure ? nil : DeepgramError.lost)
  }

  public func urlSession(
    _ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    // Only Deepgram's host, with the system's certificate check.
    guard challenge.protectionSpace.host == allowedHost else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    completionHandler(.performDefaultHandling, nil)
  }
}
