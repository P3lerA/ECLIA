/**
 * eclia-input — macOS native input injection for ECLIA computer use.
 *
 * Uses CoreGraphics CGEvent API directly. Zero runtime dependencies.
 * Every Mac app recognizes CGEvent input — it's the same layer the OS
 * uses for physical keyboard/mouse/trackpad.
 *
 * Build (universal binary):
 *   swiftc eclia-input.swift -o eclia-input-arm64 -target arm64-apple-macosx12.0
 *   swiftc eclia-input.swift -o eclia-input-x86_64 -target x86_64-apple-macosx12.0
 *   lipo -create eclia-input-arm64 eclia-input-x86_64 -output eclia-input
 *
 * Usage:
 *   eclia-input click <x> <y> [left|right]
 *   eclia-input doubleclick <x> <y>
 *   eclia-input move <x> <y>
 *   eclia-input drag <x1> <y1> <x2> <y2>
 *   eclia-input type <text>
 *   eclia-input keypress <key[+key...]>    e.g. "cmd+c", "return", "shift+tab"
 *   eclia-input scroll <x> <y> <dy> [dx]
 */

import CoreGraphics
import Foundation
import ImageIO

// MARK: - Mouse helpers

func postMouse(_ type: CGEventType, at point: CGPoint, button: CGMouseButton = .left) {
    guard let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) else { return }
    e.post(tap: .cghidEventTap)
}

func click(x: Double, y: Double, button: CGMouseButton = .left) {
    let p = CGPoint(x: x, y: y)
    let (down, up): (CGEventType, CGEventType) = button == .right
        ? (.rightMouseDown, .rightMouseUp)
        : button == .center
          ? (.otherMouseDown, .otherMouseUp)
          : (.leftMouseDown, .leftMouseUp)
    postMouse(down, at: p, button: button)
    usleep(50_000) // 50ms hold
    postMouse(up, at: p, button: button)
}

func doubleClick(x: Double, y: Double) {
    let p = CGPoint(x: x, y: y)
    // First click
    guard let d1 = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left) else { return }
    d1.setIntegerValueField(.mouseEventClickState, value: 1)
    d1.post(tap: .cghidEventTap)
    guard let u1 = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left) else { return }
    u1.setIntegerValueField(.mouseEventClickState, value: 1)
    u1.post(tap: .cghidEventTap)
    usleep(30_000)
    // Second click
    guard let d2 = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left) else { return }
    d2.setIntegerValueField(.mouseEventClickState, value: 2)
    d2.post(tap: .cghidEventTap)
    guard let u2 = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left) else { return }
    u2.setIntegerValueField(.mouseEventClickState, value: 2)
    u2.post(tap: .cghidEventTap)
}

func moveMouse(x: Double, y: Double) {
    postMouse(.mouseMoved, at: CGPoint(x: x, y: y))
}

func drag(points: [CGPoint]) {
    guard points.count >= 2 else { return }
    let start = points[0]
    let end = points[points.count - 1]

    postMouse(.leftMouseDown, at: start)
    usleep(50_000)

    // Walk each segment, interpolating between consecutive waypoints.
    for seg in 0..<(points.count - 1) {
        let from = points[seg]
        let to = points[seg + 1]
        let steps = 10
        for i in 1...steps {
            let t = Double(i) / Double(steps)
            let ix = from.x + (to.x - from.x) * t
            let iy = from.y + (to.y - from.y) * t
            postMouse(.leftMouseDragged, at: CGPoint(x: ix, y: iy))
            usleep(10_000)
        }
    }

    postMouse(.leftMouseUp, at: end)
}

func scroll(x: Double, y: Double, dy: Int32, dx: Int32) {
    // Move cursor to scroll position first.
    moveMouse(x: x, y: y)
    usleep(30_000)
    guard let e = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0) else { return }
    e.post(tap: .cghidEventTap)
}

// MARK: - Keyboard helpers

/// Map human-readable key names to CGKeyCode values.
let keyCodeMap: [String: CGKeyCode] = [
    // Letters (lowercase)
    "a": 0x00, "b": 0x0B, "c": 0x08, "d": 0x02, "e": 0x0E, "f": 0x03,
    "g": 0x05, "h": 0x04, "i": 0x22, "j": 0x26, "k": 0x28, "l": 0x25,
    "m": 0x2E, "n": 0x2D, "o": 0x1F, "p": 0x23, "q": 0x0C, "r": 0x0F,
    "s": 0x01, "t": 0x11, "u": 0x20, "v": 0x09, "w": 0x0D, "x": 0x07,
    "y": 0x10, "z": 0x06,
    // Numbers
    "0": 0x1D, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15,
    "5": 0x17, "6": 0x16, "7": 0x1A, "8": 0x1C, "9": 0x19,
    // Special
    "return": 0x24, "enter": 0x24, "tab": 0x30, "space": 0x31,
    "backspace": 0x33, "delete": 0x33, "fwd-delete": 0x75, "forwarddelete": 0x75,
    "escape": 0x35, "esc": 0x35,
    // Arrows
    "up": 0x7E, "down": 0x7D, "left": 0x7B, "right": 0x7C,
    "arrow-up": 0x7E, "arrow-down": 0x7D, "arrow-left": 0x7B, "arrow-right": 0x7C,
    // Navigation
    "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
    "page-up": 0x74, "page-down": 0x79,
    // Function keys
    "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76, "f5": 0x60,
    "f6": 0x61, "f7": 0x62, "f8": 0x64, "f9": 0x65, "f10": 0x6D,
    "f11": 0x67, "f12": 0x6F,
    // Punctuation / symbols
    "-": 0x1B, "=": 0x18, "[": 0x21, "]": 0x1E, "\\": 0x2A,
    ";": 0x29, "'": 0x27, ",": 0x2B, ".": 0x2F, "/": 0x2C, "`": 0x32,
    "minus": 0x1B, "equal": 0x18,
]

/// Modifier key name → CGEventFlags
let modifierMap: [String: CGEventFlags] = [
    "cmd": .maskCommand, "command": .maskCommand, "meta": .maskCommand, "super": .maskCommand,
    "ctrl": .maskControl, "control": .maskControl,
    "alt": .maskAlternate, "option": .maskAlternate, "opt": .maskAlternate,
    "shift": .maskShift,
]

func keypress(combo: String) {
    // Parse "cmd+shift+c" style combos and emit real modifier key events.
    let parts = combo.lowercased().split(separator: "+").map(String.init)
    var modifiers: [(name: String, flag: CGEventFlags, keyCode: CGKeyCode)] = []
    var seenModifiers = Set<String>()
    var keyCode: CGKeyCode?

    for part in parts {
        if let modFlag = modifierMap[part] {
            guard let modKeyCode = modifierKeyCode(part) else {
                fputs("eclia-input: unknown modifier '\(part)'\n", stderr)
                return
            }
            if !seenModifiers.contains(part) {
                modifiers.append((name: part, flag: modFlag, keyCode: modKeyCode))
                seenModifiers.insert(part)
            }
        } else if let kc = keyCodeMap[part] {
            if keyCode != nil {
                fputs("eclia-input: multiple non-modifier keys in combo '\(combo)'\n", stderr)
                return
            }
            keyCode = kc
        } else {
            fputs("eclia-input: unknown key '\(part)'\n", stderr)
            return
        }
    }

    var activeFlags = CGEventFlags()

    for modifier in modifiers {
        activeFlags.insert(modifier.flag)
        postKey(modifier.keyCode, flags: activeFlags, down: true)
        usleep(20_000)
    }

    if let kc = keyCode {
        postKey(kc, flags: activeFlags, down: true)
        usleep(50_000)
        postKey(kc, flags: activeFlags, down: false)
    } else if modifiers.isEmpty {
        fputs("eclia-input: empty key combo\n", stderr)
        return
    } else {
        // Allow a brief pure-modifier press for cases like holding Shift temporarily.
        usleep(50_000)
    }

    for modifier in modifiers.reversed() {
        activeFlags.remove(modifier.flag)
        postKey(modifier.keyCode, flags: activeFlags, down: false)
        usleep(20_000)
    }
}

func modifierKeyCode(_ name: String) -> CGKeyCode? {
    switch name {
    case "cmd", "command", "meta", "super": return 0x37
    case "shift": return 0x38
    case "alt", "option", "opt": return 0x3A
    case "ctrl", "control": return 0x3B
    default: return nil
    }
}

func postKey(_ keyCode: CGKeyCode, flags: CGEventFlags, down: Bool) {
    guard let e = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: down) else { return }
    e.flags = flags
    e.post(tap: .cghidEventTap)
}

func typeText(_ text: String) {
    // Send one character per CGEvent key-down/key-up pair.
    // Rich editors (MathQuill/Desmos, Google Docs, etc.) only read the first
    // character from each event, so chunking breaks them. Single-char mode
    // is ~8ms per character — fast enough for the short strings models type.
    let chars = Array(text.utf16)

    for ch in chars {
        var buf: [UniChar] = [ch]
        guard let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) else { continue }
        keyDown.keyboardSetUnicodeString(stringLength: 1, unicodeString: &buf)
        keyDown.post(tap: .cghidEventTap)

        guard let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else { continue }
        keyUp.post(tap: .cghidEventTap)

        usleep(8_000) // 8ms per char — ~120 chars/sec, reliable for rich editors.
    }
}

// MARK: - Main

func printUsage() {
    fputs("""
    Usage:
      eclia-input click <x> <y> [left|right]
      eclia-input doubleclick <x> <y>
      eclia-input move <x> <y>
      eclia-input drag <x1> <y1> <x2> <y2>
      eclia-input type <text>
      eclia-input keypress <key[+key...]>
      eclia-input scroll <x> <y> <dy> [dx]
    
    """, stderr)
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    printUsage()
    exit(1)
}

let command = args[1].lowercased()

switch command {
case "click":
    guard args.count >= 4,
          let x = Double(args[2]),
          let y = Double(args[3]) else {
        fputs("eclia-input click: requires <x> <y> [left|right]\n", stderr)
        exit(1)
    }
    let btnArg = args.count >= 5 ? args[4].lowercased() : "left"
    let button: CGMouseButton
    switch btnArg {
    case "right":   button = .right
    case "middle":  button = .center
    case "back":    button = CGMouseButton(rawValue: 3)!
    case "forward": button = CGMouseButton(rawValue: 4)!
    default:        button = .left
    }
    click(x: x, y: y, button: button)

case "doubleclick":
    guard args.count >= 4,
          let x = Double(args[2]),
          let y = Double(args[3]) else {
        fputs("eclia-input doubleclick: requires <x> <y>\n", stderr)
        exit(1)
    }
    doubleClick(x: x, y: y)

case "move":
    guard args.count >= 4,
          let x = Double(args[2]),
          let y = Double(args[3]) else {
        fputs("eclia-input move: requires <x> <y>\n", stderr)
        exit(1)
    }
    moveMouse(x: x, y: y)

case "drag":
    // Accept variable-length pairs: drag x1 y1 x2 y2 [x3 y3 ...]
    let coordArgs = args.dropFirst(2) // skip "eclia-input" and "drag"
    guard coordArgs.count >= 4, coordArgs.count % 2 == 0 else {
        fputs("eclia-input drag: requires <x1> <y1> <x2> <y2> [x3 y3 ...]\n", stderr)
        exit(1)
    }
    var points: [CGPoint] = []
    let coordArray = Array(coordArgs)
    for i in stride(from: 0, to: coordArray.count, by: 2) {
        guard let px = Double(coordArray[i]), let py = Double(coordArray[i + 1]) else {
            fputs("eclia-input drag: invalid coordinate at position \(i)\n", stderr)
            exit(1)
        }
        points.append(CGPoint(x: px, y: py))
    }
    drag(points: points)

case "type":
    let text: String
    if args.count >= 3 && args[2] == "-" {
        // Read text from stdin (preserves newlines, no arg-length limit).
        text = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
    } else if args.count >= 3 {
        // Join remaining args to support text with spaces.
        text = args[2...].joined(separator: " ")
    } else {
        fputs("eclia-input type: requires <text> or - for stdin\n", stderr)
        exit(1)
    }
    typeText(text)

case "keypress", "key":
    guard args.count >= 3 else {
        fputs("eclia-input keypress: requires <key[+key...]>\n", stderr)
        exit(1)
    }
    keypress(combo: args[2])

case "scroll":
    guard args.count >= 5,
          let x = Double(args[2]),
          let y = Double(args[3]),
          let dy = Int32(args[4]) else {
        fputs("eclia-input scroll: requires <x> <y> <dy> [dx]\n", stderr)
        exit(1)
    }
    let dx: Int32 = args.count >= 6 ? (Int32(args[5]) ?? 0) : 0
    scroll(x: x, y: y, dy: dy, dx: dx)

case "screenshot":
    // Capture main display, encode as JPEG, output header + base64 to stdout.
    // Header format: "outW outH logicalW logicalH\n" (4 values when downscaled, 2 when not).
    // Optional arg: maxLongEdge — cap the long edge of the output image.
    // Primary: CGWindowListCreateImage (zero disk IO, needs screen-recording permission).
    // Fallback: screencapture CLI (system-privileged, always works, uses temp file).

    let maxLongEdge: Int = args.count >= 3 ? (Int(args[2]) ?? 0) : 0

    func encodeJPEG(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(
            data as CFMutableData,
            "public.jpeg" as CFString,
            1,
            nil
        ) else { return nil }
        CGImageDestinationAddImage(dest, image, [
            kCGImageDestinationLossyCompressionQuality: 0.8
        ] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return data as Data
    }

    func resizeImage(_ image: CGImage, toWidth w: Int, height h: Int) -> CGImage? {
        guard let ctx = CGContext(
            data: nil,
            width: w,
            height: h,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage()
    }

    /// Downscale image if its long edge exceeds maxLongEdge.
    /// Returns (finalImage, logicalW, logicalH) where logical = pre-downscale dimensions.
    func downscaleIfNeeded(_ image: CGImage) -> (CGImage, Int, Int) {
        let logW = image.width
        let logH = image.height
        guard maxLongEdge > 0 && max(logW, logH) > maxLongEdge else {
            return (image, logW, logH)
        }
        let scale = Double(maxLongEdge) / Double(max(logW, logH))
        let outW = Int((Double(logW) * scale).rounded())
        let outH = Int((Double(logH) * scale).rounded())
        if let resized = resizeImage(image, toWidth: outW, height: outH) {
            return (resized, logW, logH)
        }
        fputs("eclia-input screenshot: downscale failed, using original\n", stderr)
        return (image, logW, logH)
    }

    func outputScreenshot(_ image: CGImage, logicalW: Int, logicalH: Int) {
        guard let jpeg = encodeJPEG(image) else {
            fputs("eclia-input screenshot: JPEG encode failed\n", stderr)
            exit(1)
        }
        let base64 = jpeg.base64EncodedString()
        let header: String
        if image.width == logicalW && image.height == logicalH {
            header = "\(image.width) \(image.height)"
        } else {
            header = "\(image.width) \(image.height) \(logicalW) \(logicalH)"
        }
        FileHandle.standardOutput.write(Data("\(header)\n".utf8))
        FileHandle.standardOutput.write(Data(base64.utf8))
        FileHandle.standardOutput.write(Data("\n".utf8))
    }

    // Try CGWindowListCreateImage first (fast, zero disk IO).
    if let image = CGWindowListCreateImage(
        CGRect.null,
        .optionOnScreenOnly,
        kCGNullWindowID,
        [.nominalResolution]
    ) {
        let (final, logW, logH) = downscaleIfNeeded(image)
        outputScreenshot(final, logicalW: logW, logicalH: logH)
    } else {
        // Fallback: screencapture CLI → temp file → CGImage → JPEG → base64.
        fputs("eclia-input screenshot: CGWindowList unavailable, falling back to screencapture\n", stderr)
        let tmpPath = NSTemporaryDirectory() + "eclia_cap_\(ProcessInfo.processInfo.processIdentifier).png"
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        proc.arguments = ["-x", "-C", tmpPath]
        do {
            try proc.run()
            proc.waitUntilExit()
        } catch {
            fputs("eclia-input screenshot: screencapture failed: \(error)\n", stderr)
            exit(1)
        }
        guard proc.terminationStatus == 0 else {
            fputs("eclia-input screenshot: screencapture exited with \(proc.terminationStatus)\n", stderr)
            exit(1)
        }
        defer { try? FileManager.default.removeItem(atPath: tmpPath) }

        guard let dataProvider = CGDataProvider(filename: tmpPath),
              let fullImage = CGImage(
                  pngDataProviderSource: dataProvider,
                  decode: nil,
                  shouldInterpolate: true,
                  intent: .defaultIntent
              ) else {
            fputs("eclia-input screenshot: failed to read captured PNG\n", stderr)
            exit(1)
        }

        // Resize to logical resolution first (screencapture gives physical/Retina pixels).
        // CGDisplayBounds returns points (logical), not physical pixels.
        let mainId = CGMainDisplayID()
        let bounds = CGDisplayBounds(mainId)
        let logW = Int(bounds.width)
        let logH = Int(bounds.height)

        let logicalImage: CGImage
        if fullImage.width == logW && fullImage.height == logH {
            logicalImage = fullImage
        } else {
            guard let resized = resizeImage(fullImage, toWidth: logW, height: logH) else {
                fputs("eclia-input screenshot: resize to logical failed\n", stderr)
                exit(1)
            }
            logicalImage = resized
        }

        // Then downscale if maxLongEdge is set.
        let (final, finalLogW, finalLogH) = downscaleIfNeeded(logicalImage)
        outputScreenshot(final, logicalW: finalLogW, logicalH: finalLogH)
    }

case "screensize":
    // Print the main display's logical resolution (points) as "width height\n".
    // CGDisplayBounds returns points, not physical pixels.
    let mainId = CGMainDisplayID()
    let bounds = CGDisplayBounds(mainId)
    print("\(Int(bounds.width)) \(Int(bounds.height))")

default:
    fputs("eclia-input: unknown command '\(command)'\n", stderr)
    printUsage()
    exit(1)
}
