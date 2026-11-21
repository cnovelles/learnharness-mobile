// Test of DeepgramRun.swift on macOS against deepgram-server.cjs. Prints
// "OK" or a line that starts with "FAIL".
import Foundation

let port = CommandLine.arguments[1]
let desktopURL = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : ""

final class Box: @unchecked Sendable {
  let lock = NSLock()
  var texts: [String] = []
  var end: String?? = .none
  func add(_ t: String) { lock.lock(); texts.append(t); lock.unlock() }
  func finish(_ e: Error?) { lock.lock(); end = .some(e.map { "\($0)" }); lock.unlock() }
  var done: Bool { lock.lock(); defer { lock.unlock() }; return end != nil }
}

func run(path: String, token: String, bytes: Int) async -> Box {
  let box = Box()
  let run = DeepgramRun(
    url: URL(string: "ws://127.0.0.1:\(port)\(path)")!, token: token, allowedHost: "127.0.0.1",
    callbacks: DictationCallbacks(level: { _ in }, text: { box.add($0) }), onEnd: { box.finish($0) })
  try? await run.start(microphone: false)
  // Sent before the socket is open: the run keeps it and sends it on open.
  for _ in 0..<(bytes / 1600) { run.send(Data(count: 1600)) }
  try? await Task.sleep(nanoseconds: 500_000_000)
  if !box.done { run.stop() }
  for _ in 0..<50 where !box.done { try? await Task.sleep(nanoseconds: 100_000_000) }
  return box
}

func check() async -> String {
  // The URL: Deepgram's host only, the desktop's parameters, a checked language.
  guard let url = try? DeepgramRun.listenURL(language: "en") else { return "FAIL no URL for en" }
  if url.host != "api.deepgram.com" || url.scheme != "wss" { return "FAIL wrong host: \(url)" }
  if !desktopURL.isEmpty, url.absoluteString != desktopURL {
    return "FAIL the URL is not the desktop's:\n  phone   \(url)\n  desktop \(desktopURL)"
  }
  for bad in ["en&model=x", "../x", "", "EN", "en us"] where (try? DeepgramRun.listenURL(language: bad)) != nil {
    return "FAIL language \"\(bad)\" was accepted"
  }
  if (try? DeepgramRun.listenURL(language: "multi")) == nil { return "FAIL multi refused" }
  if (try? DeepgramRun.listenURL(language: "pt-BR")) == nil { return "FAIL pt-BR refused" }

  // A normal run: all audio arrives, one final text, a clean end.
  let ok = await run(path: "/v1/listen", token: "test-token", bytes: 16000)
  if ok.texts != ["heard 16000 bytes"] { return "FAIL texts: \(ok.texts)" }
  if case .some(.some(let e)) = ok.end { return "FAIL normal run ended with \(e)" }

  // A bad token: the server refuses the socket.
  let refused = await run(path: "/v1/listen", token: "wrong", bytes: 1600)
  if !refused.texts.isEmpty { return "FAIL a refused run gave text" }
  guard case .some(.some(let refusedCode)) = refused.end, refusedCode == "deepgram-refused" || refusedCode == "deepgram-lost"
  else { return "FAIL refused run end: \(String(describing: refused.end))" }

  // The connection drops in the middle.
  let lost = await run(path: "/drop", token: "test-token", bytes: 16000)
  guard case .some(.some(let lostCode)) = lost.end, lostCode == "deepgram-lost" else {
    return "FAIL dropped run end: \(String(describing: lost.end))"
  }
  return "OK"
}

let done = DispatchSemaphore(value: 0)
Task {
  let result = await check()
  print(result)
  done.signal()
  exit(result.hasPrefix("OK") ? 0 : 1)
}
done.wait()
