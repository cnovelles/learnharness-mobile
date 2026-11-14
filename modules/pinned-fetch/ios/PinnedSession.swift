// A URLSession that sends a request only to a server whose leaf certificate
// has the pinned public key. Without Expo, so a plain macOS test can run it
// against a real HTTPS server (modules/pinned-fetch/tests/pinned-session).
//
// Why it is safe to send the token through it:
//  - URLSession sends the HTTP request only after the TLS handshake, and the
//    handshake waits for the server-trust challenge below. A wrong pin
//    cancels the challenge, so no byte of the request leaves the phone.
//  - One PinnedSession has one pin, and URLSession does not share
//    connections between sessions. So a connection that passed pin A is
//    never reused for a request that expects pin B.
//  - Redirects are refused: the 3xx answer goes to the caller, and the
//    request (with its token) is not sent to another address.
import Foundation

enum PinnedFetchFailure: Error, Equatable {
  /// The server certificate does not have the pinned key. Nothing was sent.
  case pinMismatch
  /// Only https URLs are allowed.
  case notHTTPS
}

struct PinnedRequestCallbacks {
  var response: (_ status: Int, _ headers: [[String]]) -> Void
  var data: (_ chunk: Data) -> Void
  /// `nil` when the body ended normally.
  var complete: (_ error: Error?) -> Void
}

final class PinnedSession: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  let pin: String
  private let lock = NSLock()
  private var callbacks: [Int: PinnedRequestCallbacks] = [:]
  private var mismatched: Set<Int> = []
  private var session: URLSession!

  init(pin: String) {
    self.pin = pin
    super.init()
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCredentialStorage = nil
    // Event and turn streams stay open and can be quiet for a long time.
    // The JS side ends them (abort) and has its own timeouts.
    configuration.timeoutIntervalForRequest = 24 * 60 * 60
    configuration.waitsForConnectivity = false
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
  }

  @discardableResult
  func start(_ request: URLRequest, callbacks: PinnedRequestCallbacks) throws -> URLSessionDataTask {
    guard request.url?.scheme?.lowercased() == "https" else { throw PinnedFetchFailure.notHTTPS }
    var request = request
    request.httpShouldHandleCookies = false
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    let task = session.dataTask(with: request)
    lock.lock()
    self.callbacks[task.taskIdentifier] = callbacks
    lock.unlock()
    task.resume()
    return task
  }

  func invalidate() {
    session.invalidateAndCancel()
  }

  private func callbacks(for task: URLSessionTask) -> PinnedRequestCallbacks? {
    lock.lock()
    defer { lock.unlock() }
    return callbacks[task.taskIdentifier]
  }

  // Task-level only (no session-level handler), so each challenge belongs
  // to a known task.
  func urlSession(
    _ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let trust = challenge.protectionSpace.serverTrust
    else {
      // No client certificates, no HTTP auth.
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    if PinCheck.matches(trust: trust, pin: pin) {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      lock.lock()
      mismatched.insert(task.taskIdentifier)
      lock.unlock()
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    let http = response as? HTTPURLResponse
    var headers: [[String]] = []
    for (name, value) in http?.allHeaderFields ?? [:] {
      headers.append([String(describing: name), String(describing: value)])
    }
    callbacks(for: dataTask)?.response(http?.statusCode ?? 0, headers)
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    callbacks(for: dataTask)?.data(data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    lock.lock()
    let entry = callbacks.removeValue(forKey: task.taskIdentifier)
    let wasMismatch = mismatched.remove(task.taskIdentifier) != nil
    lock.unlock()
    entry?.complete(wasMismatch ? PinnedFetchFailure.pinMismatch : error)
  }
}
