// Prints the text macOS Vision recognizes in each PNG given (Korean + English), one block per file:
//   == <path>
//   <line>...
// Used by run-tests-macos.sh to see what Orca's window shows (dialogs, rendered previews) without
// any accessibility or screen-recording permission. Build: swiftc -O ocr.swift -o ocr
import Foundation
import Vision
import AppKit

for path in CommandLine.arguments.dropFirst() {
  print("== \(path)")
  guard let img = NSImage(contentsOfFile: path),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("!! cannot read image"); continue
  }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.recognitionLanguages = ["ko-KR", "en-US"]
  req.usesLanguageCorrection = false
  do {
    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
  } catch {
    print("!! \(error)"); continue
  }
  for obs in req.results ?? [] {
    if let top = obs.topCandidates(1).first { print(top.string) }
  }
}
