// Test of DictationEngine.swift on macOS: status, then a run on an audio
// file. Prints "OK" or a line that starts with "FAIL".
import Foundation

let file = URL(fileURLWithPath: CommandLine.arguments[1])

func check() async -> String {
  guard #available(macOS 26.0, *) else { return "FAIL macOS 26 is necessary" }
  let none = await DictationModules.status(language: "xx-invalid")
  if none.engine != "none" { return "FAIL an unknown language has an engine: \(none.dictionary)" }
  let status = await DictationModules.status(language: "en-US")
  if status.engine == "none" { return "FAIL no engine for en-US" }
  if status.model != "installed" {
    do { try await DictationModules.install(language: "en-US") { _ in } } catch { return "FAIL install: \(error)" }
  }
  let box = Box()
  let run = DictationRun(callbacks: DictationCallbacks(level: { box.add(level: $0) }, text: { box.add(text: $0) }))
  do { try await run.runFile(file, language: "en-US") } catch { return "FAIL run: \(error)" }
  let text = box.text.lowercased()
  for word in ["moon", "earth", "bulges"] where !text.contains(word) {
    return "FAIL the text has no \"\(word)\": \(box.text)"
  }
  if box.levels.isEmpty || box.levels.allSatisfy({ $0 == 0 }) { return "FAIL no level" }
  return "OK engine=\(status.engine) text=\(box.text)"
}

final class Box: @unchecked Sendable {
  private let lock = NSLock()
  private(set) var text = ""
  private(set) var levels: [Float] = []
  func add(text piece: String) { lock.lock(); text += piece; lock.unlock() }
  func add(level: Float) { lock.lock(); levels.append(level); lock.unlock() }
}

let done = DispatchSemaphore(value: 0)
Task {
  let result = await check()
  print(result)
  done.signal()
  exit(result.hasPrefix("OK") ? 0 : 1)
}
done.wait()
