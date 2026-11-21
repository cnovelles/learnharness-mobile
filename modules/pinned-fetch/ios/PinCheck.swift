// The pin check, without Expo, so it compiles and runs in a plain macOS test
// (modules/pinned-fetch/tests/pin-check).
import CryptoKit
import Foundation
import Security

enum PinCheck {
  /// DER prefix of a P-256 SubjectPublicKeyInfo:
  /// SEQUENCE { SEQUENCE { id-ecPublicKey, prime256v1 }, BIT STRING (65 bytes) }.
  /// The gateway key is always P-256 (electron/phone-access-tls.cjs).
  private static let p256SPKIPrefix: [UInt8] = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
  ]

  /// "sha256/" + base64 SHA-256 of the certificate's SPKI, or nil when the
  /// key is not an uncompressed P-256 key.
  static func spkiPin(of certificate: SecCertificate) -> String? {
    guard let key = SecCertificateCopyKey(certificate),
          let attributes = SecKeyCopyAttributes(key) as? [CFString: Any],
          (attributes[kSecAttrKeyType] as? String) == (kSecAttrKeyTypeECSECPrimeRandom as String),
          (attributes[kSecAttrKeySizeInBits] as? Int) == 256,
          let point = SecKeyCopyExternalRepresentation(key, nil) as Data?,
          point.count == 65, point.first == 0x04
    else { return nil }
    let spki = Data(p256SPKIPrefix) + point
    return "sha256/" + Data(SHA256.hash(data: spki)).base64EncodedString()
  }

  /// True only when the leaf certificate of `trust` has the pinned key.
  /// No CA and no host name check: the pin is the trust decision.
  static func matches(trust: SecTrust, pin: String) -> Bool {
    guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
          let leaf = chain.first,
          let actual = spkiPin(of: leaf)
    else { return false }
    // Constant time is not needed: the pin is public (it is in the QR code).
    return actual == pin
  }
}
