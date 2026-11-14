// Run: modules/pinned-fetch/tests/run-pin-check-test.sh
// Usage: pinned-session <url> <pin> <expect: ok|mismatch>
// Sends GET <url> with an Authorization header through PinnedSession and
// prints the result. The Node side checks what the server received.
import Foundation

let args = CommandLine.arguments
let url = URL(string: args[1])!
let pin = args[2]
let expect = args[3]

let session = PinnedSession(pin: pin)
var request = URLRequest(url: url)
request.setValue("Bearer secret-token-for-the-test", forHTTPHeaderField: "authorization")
let done = DispatchSemaphore(value: 0)
var status = 0
var body = Data()
var failure: Error?
try session.start(request, callbacks: PinnedRequestCallbacks(
  response: { code, _ in status = code },
  data: { body.append($0) },
  complete: { error in
    failure = error
    done.signal()
  }
))
done.wait()

let refusesHTTP: Bool = {
  do {
    try session.start(URLRequest(url: URL(string: "http://127.0.0.1:1/")!), callbacks: PinnedRequestCallbacks(response: { _, _ in }, data: { _ in }, complete: { _ in }))
    return false
  } catch { return (error as? PinnedFetchFailure) == .notHTTPS }
}()
guard refusesHTTP else {
  print("FAIL: an http URL was not refused")
  exit(1)
}

switch expect {
case "ok":
  guard failure == nil, status == 200 else {
    print("FAIL: expected 200, got \(status) \(String(describing: failure))")
    exit(1)
  }
  print("ok: \(status) \(String(decoding: body, as: UTF8.self))")
default:
  guard (failure as? PinnedFetchFailure) == .pinMismatch else {
    print("FAIL: expected pinMismatch, got \(status) \(String(describing: failure))")
    exit(1)
  }
  print("ok: pin mismatch")
}
