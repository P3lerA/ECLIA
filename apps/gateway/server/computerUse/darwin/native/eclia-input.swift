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

// MARK: - Mouse helpers

func postMouse(_ type: CGEventType, at point: CGPoint, button: CGMouseButton = .left) {
    guard let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) else { return }
    e.post(tap: .cghidEventTap)
}

func click(x: Double, y: Double, button: CGMouseButton = .left) {
    let p = CGPoint(x: x, y: y)
    let (down, up): (CGEventType, CGEventType) = button == .right
        ? (.rightMouseDown, .rightMouseUp)
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

func drag(x1: Double, y1: Double, x2: Double, y2: Double) {
    let start = CGPoint(x: x1, y: y1)
    let end = CGPoint(x: x2, y: y2)
    postMouse(.leftMouseDown, at: start)
    usleep(50_000)
    // Interpolate a few points for smooth drag.
    let steps = 10
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let ix = x1 + (x2 - x1) * t
        let iy = y1 + (y2 - y1) * t
        postMouse(.leftMouseDragged, at: CGPoint(x: ix, y: iy))
        usleep(10_000)
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
    // Use CGEvent's unicode string capability for reliable text input.
    // Process in chunks (CGEvent supports up to ~20 characters per event for reliability).
    let chars = Array(text.utf16)
    let chunkSize = 16

    for start in stride(from: 0, to: chars.count, by: chunkSize) {
        let end = min(start + chunkSize, chars.count)
        let chunk = Array(chars[start..<end])

        guard let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) else { continue }
        keyDown.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
        keyDown.post(tap: .cghidEventTap)

        guard let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else { continue }
        keyUp.post(tap: .cghidEventTap)

        usleep(20_000) // Small delay between chunks.
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
    let button: CGMouseButton = (args.count >= 5 && args[4].lowercased() == "right") ? .right : .left
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
    guard args.count >= 6,
          let x1 = Double(args[2]),
          let y1 = Double(args[3]),
          let x2 = Double(args[4]),
          let y2 = Double(args[5]) else {
        fputs("eclia-input drag: requires <x1> <y1> <x2> <y2>\n", stderr)
        exit(1)
    }
    drag(x1: x1, y1: y1, x2: x2, y2: y2)

case "type":
    guard args.count >= 3 else {
        fputs("eclia-input type: requires <text>\n", stderr)
        exit(1)
    }
    // Join remaining args to support text with spaces.
    let text = args[2...].joined(separator: " ")
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

default:
    fputs("eclia-input: unknown command '\(command)'\n", stderr)
    printUsage()
    exit(1)
}
