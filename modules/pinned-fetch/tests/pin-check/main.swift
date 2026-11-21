// Run: modules/pinned-fetch/tests/run-pin-check-test.sh (main.swift: top-level code)
// Reads a PEM certificate and its Node pin, and checks that PinCheck gives
// the same pin, and refuses a different one.
import Foundation
import Security

let args = CommandLine.arguments
let pem = try! String(contentsOfFile: args[1], encoding: .utf8)
let expected = args[2]
let base64 = pem.split(separator: "\n").filter { !$0.hasPrefix("-----") }.joined()
let certificate = SecCertificateCreateWithData(nil, Data(base64Encoded: base64)! as CFData)!
let actual = PinCheck.spkiPin(of: certificate)
guard actual == expected else {
  print("FAIL: expected \(expected), got \(actual ?? "nil")")
  exit(1)
}
var trust: SecTrust?
SecTrustCreateWithCertificates(certificate, SecPolicyCreateSSL(true, nil), &trust)
guard PinCheck.matches(trust: trust!, pin: expected), !PinCheck.matches(trust: trust!, pin: "sha256/" + String(repeating: "A", count: 43) + "=") else {
  print("FAIL: matches() is wrong")
  exit(1)
}
print("ok: \(expected)")
