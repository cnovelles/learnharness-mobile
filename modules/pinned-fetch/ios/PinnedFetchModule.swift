// Expo module "PinnedFetch": a streaming fetch with certificate pinning.
// The pin check and the URLSession are in PinCheck.swift and
// PinnedSession.swift (tested on macOS without Expo). This file only moves
// requests and events between JS and those classes.
//
// Events (all carry the request `id`):
//   pinnedFetchResponse {id, status, headers: [[name, value]]}
//   pinnedFetchData     {id, data: base64}
//   pinnedFetchEnd      {id, error?: "pin-mismatch" | "not-https" | message}
import ExpoModulesCore

internal final class PinnedFetchNotHTTPSException: Exception, @unchecked Sendable {
  override var reason: String { "Only https URLs are allowed." }
}

public final class PinnedFetchModule: Module {
  private let lock = NSLock()
  // One session per pin: connections are never shared between pins.
  private var sessions: [String: PinnedSession] = [:]
  private var tasks: [String: URLSessionDataTask] = [:]

  public func definition() -> ModuleDefinition {
    Name("PinnedFetch")

    Events("pinnedFetchResponse", "pinnedFetchData", "pinnedFetchEnd")

    OnDestroy {
      self.lock.lock()
      let all = Array(self.sessions.values)
      self.sessions.removeAll()
      self.tasks.removeAll()
      self.lock.unlock()
      all.forEach { $0.invalidate() }
    }

    AsyncFunction("start") { (id: String, url: String, method: String, headers: [String: String], body: String?, pin: String) throws in
      guard let target = URL(string: url), target.scheme?.lowercased() == "https" else {
        throw PinnedFetchNotHTTPSException()
      }
      var request = URLRequest(url: target)
      request.httpMethod = method
      for (name, value) in headers {
        request.setValue(value, forHTTPHeaderField: name)
      }
      if let body {
        request.httpBody = Data(body.utf8)
      }
      let session = self.session(for: pin)
      let task = try session.start(request, callbacks: PinnedRequestCallbacks(
        response: { [weak self] status, headers in
          self?.sendEvent("pinnedFetchResponse", ["id": id, "status": status, "headers": headers])
        },
        data: { [weak self] chunk in
          self?.sendEvent("pinnedFetchData", ["id": id, "data": chunk.base64EncodedString()])
        },
        complete: { [weak self] error in
          guard let self else { return }
          self.lock.lock()
          self.tasks.removeValue(forKey: id)
          self.lock.unlock()
          var event: [String: Any] = ["id": id]
          if let error {
            switch error {
            case PinnedFetchFailure.pinMismatch: event["error"] = "pin-mismatch"
            case PinnedFetchFailure.notHTTPS: event["error"] = "not-https"
            default:
              let ns = error as NSError
              event["error"] = ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled ? "cancelled" : ns.localizedDescription
            }
          }
          self.sendEvent("pinnedFetchEnd", event)
        }
      ))
      self.lock.lock()
      self.tasks[id] = task
      self.lock.unlock()
    }

    Function("cancel") { (id: String) in
      self.lock.lock()
      let task = self.tasks.removeValue(forKey: id)
      self.lock.unlock()
      task?.cancel()
    }
  }

  private func session(for pin: String) -> PinnedSession {
    lock.lock()
    defer { lock.unlock() }
    if let existing = sessions[pin] { return existing }
    let created = PinnedSession(pin: pin)
    sessions[pin] = created
    return created
  }
}
