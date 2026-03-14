/**
 * eclia-input — Windows native input injection for ECLIA computer use.
 *
 * Uses Win32 SendInput API for mouse/keyboard, BitBlt for screenshots.
 * Zero runtime dependencies when compiled with Native AOT.
 *
 * Build (Native AOT, single file):
 *   dotnet publish -c Release -r win-x64 /p:PublishAot=true
 *
 * Usage:
 *   eclia-input click <x> <y> [left|right|middle|back|forward]
 *   eclia-input doubleclick <x> <y>
 *   eclia-input move <x> <y>
 *   eclia-input drag <x1> <y1> <x2> <y2> [x3 y3 ...]
 *   eclia-input type <text>       (or: eclia-input type - to read from stdin)
 *   eclia-input keypress <key[+key...]>
 *   eclia-input scroll <x> <y> <dy> [dx]
 *   eclia-input screenshot
 *   eclia-input screensize
 */

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Linq;
using System.Threading;

#region Win32 Interop

static class Win32
{
    // --- SendInput ---
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint type;
        public InputUnion u;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public int mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    public const uint INPUT_MOUSE = 0;
    public const uint INPUT_KEYBOARD = 1;

    // Mouse flags
    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_XDOWN = 0x0080;
    public const uint MOUSEEVENTF_XUP = 0x0100;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_HWHEEL = 0x01000;
    public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

    public const int XBUTTON1 = 1; // back
    public const int XBUTTON2 = 2; // forward

    // Keyboard flags
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int width, int height);

    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr hdcDest, int xDest, int yDest, int width, int height,
        IntPtr hdcSrc, int xSrc, int ySrc, uint dwRop);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hdc);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    // DPI scaling: GetDpiForSystem returns the system DPI (96 = 100%, 192 = 200%).
    [DllImport("user32.dll")]
    public static extern uint GetDpiForSystem();

    public const int SM_CXSCREEN = 0;
    public const int SM_CYSCREEN = 1;
    public const uint SRCCOPY = 0x00CC0020;

    public static int InputSize => Marshal.SizeOf<INPUT>();

    /// <summary>
    /// Get the logical screen size (physical pixels / DPI scale).
    /// Must be called after SetProcessDPIAware().
    /// </summary>
    public static (int w, int h) GetLogicalScreenSize()
    {
        int physW = GetSystemMetrics(SM_CXSCREEN);
        int physH = GetSystemMetrics(SM_CYSCREEN);
        uint dpi = 96;
        try { dpi = GetDpiForSystem(); } catch { /* Win 8.1+ only, fallback to 96 */ }
        if (dpi <= 96) return (physW, physH);
        double scale = dpi / 96.0;
        return ((int)(physW / scale + 0.5), (int)(physH / scale + 0.5));
    }
}

#endregion

#region Input Helpers

static class Mouse
{
    static (int dx, int dy) ToAbsolute(int x, int y)
    {
        // Model returns logical coordinates (matching the resized screenshot).
        // SendInput absolute coords are 0-65535, mapping to the full physical screen.
        // We normalize using logical resolution so model coords map correctly.
        var (logW, logH) = Win32.GetLogicalScreenSize();
        int dx = (int)((x * 65535.0 / (logW - 1)) + 0.5);
        int dy = (int)((y * 65535.0 / (logH - 1)) + 0.5);
        return (dx, dy);
    }

    public static void Move(int x, int y)
    {
        var (dx, dy) = ToAbsolute(x, y);
        var input = new Win32.INPUT
        {
            type = Win32.INPUT_MOUSE,
            u = new Win32.InputUnion
            {
                mi = new Win32.MOUSEINPUT
                {
                    dx = dx, dy = dy,
                    dwFlags = Win32.MOUSEEVENTF_MOVE | Win32.MOUSEEVENTF_ABSOLUTE
                }
            }
        };
        Win32.SendInput(1, new[] { input }, Win32.InputSize);
    }

    public static void Click(int x, int y, string button = "left")
    {
        var (dx, dy) = ToAbsolute(x, y);
        uint downFlag, upFlag;
        int mouseData = 0;

        switch (button)
        {
            case "right":
                downFlag = Win32.MOUSEEVENTF_RIGHTDOWN;
                upFlag = Win32.MOUSEEVENTF_RIGHTUP;
                break;
            case "middle":
                downFlag = Win32.MOUSEEVENTF_MIDDLEDOWN;
                upFlag = Win32.MOUSEEVENTF_MIDDLEUP;
                break;
            case "back":
                downFlag = Win32.MOUSEEVENTF_XDOWN;
                upFlag = Win32.MOUSEEVENTF_XUP;
                mouseData = Win32.XBUTTON1;
                break;
            case "forward":
                downFlag = Win32.MOUSEEVENTF_XDOWN;
                upFlag = Win32.MOUSEEVENTF_XUP;
                mouseData = Win32.XBUTTON2;
                break;
            default: // left
                downFlag = Win32.MOUSEEVENTF_LEFTDOWN;
                upFlag = Win32.MOUSEEVENTF_LEFTUP;
                break;
        }

        var inputs = new Win32.INPUT[]
        {
            new Win32.INPUT
            {
                type = Win32.INPUT_MOUSE,
                u = new Win32.InputUnion { mi = new Win32.MOUSEINPUT {
                    dx = dx, dy = dy, mouseData = mouseData,
                    dwFlags = Win32.MOUSEEVENTF_MOVE | Win32.MOUSEEVENTF_ABSOLUTE | downFlag
                }}
            },
            new Win32.INPUT
            {
                type = Win32.INPUT_MOUSE,
                u = new Win32.InputUnion { mi = new Win32.MOUSEINPUT {
                    dx = dx, dy = dy, mouseData = mouseData,
                    dwFlags = Win32.MOUSEEVENTF_MOVE | Win32.MOUSEEVENTF_ABSOLUTE | upFlag
                }}
            }
        };

        Win32.SendInput(1, new[] { inputs[0] }, Win32.InputSize);
        Thread.Sleep(50);
        Win32.SendInput(1, new[] { inputs[1] }, Win32.InputSize);
    }

    public static void DoubleClick(int x, int y)
    {
        Click(x, y, "left");
        Thread.Sleep(30);
        Click(x, y, "left");
    }

    public static void Drag(List<(int x, int y)> points)
    {
        if (points.Count < 2) return;

        // Move to start and press
        var (sx, sy) = ToAbsolute(points[0].x, points[0].y);
        Win32.SendInput(1, new[]
        {
            new Win32.INPUT
            {
                type = Win32.INPUT_MOUSE,
                u = new Win32.InputUnion { mi = new Win32.MOUSEINPUT {
                    dx = sx, dy = sy,
                    dwFlags = Win32.MOUSEEVENTF_MOVE | Win32.MOUSEEVENTF_ABSOLUTE | Win32.MOUSEEVENTF_LEFTDOWN
                }}
            }
        }, Win32.InputSize);
        Thread.Sleep(50);

        // Interpolate each segment
        for (int seg = 0; seg < points.Count - 1; seg++)
        {
            var from = points[seg];
            var to = points[seg + 1];
            int steps = 10;
            for (int i = 1; i <= steps; i++)
            {
                double t = (double)i / steps;
                int ix = (int)(from.x + (to.x - from.x) * t);
                int iy = (int)(from.y + (to.y - from.y) * t);
                var (adx, ady) = ToAbsolute(ix, iy);
                Win32.SendInput(1, new[]
                {
                    new Win32.INPUT
                    {
                        type = Win32.INPUT_MOUSE,
                        u = new Win32.InputUnion { mi = new Win32.MOUSEINPUT {
                            dx = adx, dy = ady,
                            dwFlags = Win32.MOUSEEVENTF_MOVE | Win32.MOUSEEVENTF_ABSOLUTE
                        }}
                    }
                }, Win32.InputSize);
                Thread.Sleep(10);
            }
        }

        // Release at end
        var last = points[points.Count - 1];
        var (ex, ey) = ToAbsolute(last.x, last.y);
        Win32.SendInput(1, new[]
        {
            new Win32.INPUT
            {
                type = Win32.INPUT_MOUSE,
                u = new Win32.InputUnion { mi = new Win32.MOUSEINPUT {
                    dx = ex, dy = ey,
                    dwFlags = Win32.MOUSEEVENTF_MOVE | Win32.MOUSEEVENTF_ABSOLUTE | Win32.MOUSEEVENTF_LEFTUP
                }}
            }
        }, Win32.InputSize);
    }

    public static void Scroll(int x, int y, int dy, int dx)
    {
        Move(x, y);
        Thread.Sleep(30);

        // Vertical scroll (WHEEL_DELTA = 120 per notch)
        if (dy != 0)
        {
            Win32.SendInput(1, new[]
            {
                new Win32.INPUT
                {
                    type = Win32.INPUT_MOUSE,
                    u = new Win32.InputUnion { mi = new Win32.MOUSEINPUT {
                        mouseData = dy * 120, // already negated by caller (OpenAI positive=down → Win32 positive=up)
                        dwFlags = Win32.MOUSEEVENTF_WHEEL
                    }}
                }
            }, Win32.InputSize);
        }

        // Horizontal scroll
        if (dx != 0)
        {
            Win32.SendInput(1, new[]
            {
                new Win32.INPUT
                {
                    type = Win32.INPUT_MOUSE,
                    u = new Win32.InputUnion { mi = new Win32.MOUSEINPUT {
                        mouseData = dx * 120,
                        dwFlags = Win32.MOUSEEVENTF_HWHEEL
                    }}
                }
            }, Win32.InputSize);
        }
    }
}

static class Keyboard
{
    // VK codes for named keys
    static readonly Dictionary<string, ushort> VkMap = new(StringComparer.OrdinalIgnoreCase)
    {
        // Modifiers
        ["cmd"] = 0x5B,       // LWIN
        ["command"] = 0x5B,
        ["meta"] = 0x5B,
        ["super"] = 0x5B,
        ["ctrl"] = 0xA2,      // LCONTROL
        ["control"] = 0xA2,
        ["alt"] = 0xA4,       // LMENU
        ["option"] = 0xA4,
        ["opt"] = 0xA4,
        ["shift"] = 0xA0,     // LSHIFT
        // Letters
        ["a"] = 0x41, ["b"] = 0x42, ["c"] = 0x43, ["d"] = 0x44, ["e"] = 0x45,
        ["f"] = 0x46, ["g"] = 0x47, ["h"] = 0x48, ["i"] = 0x49, ["j"] = 0x4A,
        ["k"] = 0x4B, ["l"] = 0x4C, ["m"] = 0x4D, ["n"] = 0x4E, ["o"] = 0x4F,
        ["p"] = 0x50, ["q"] = 0x51, ["r"] = 0x52, ["s"] = 0x53, ["t"] = 0x54,
        ["u"] = 0x55, ["v"] = 0x56, ["w"] = 0x57, ["x"] = 0x58, ["y"] = 0x59,
        ["z"] = 0x5A,
        // Numbers
        ["0"] = 0x30, ["1"] = 0x31, ["2"] = 0x32, ["3"] = 0x33, ["4"] = 0x34,
        ["5"] = 0x35, ["6"] = 0x36, ["7"] = 0x37, ["8"] = 0x38, ["9"] = 0x39,
        // Special
        ["return"] = 0x0D, ["enter"] = 0x0D, ["tab"] = 0x09, ["space"] = 0x20,
        ["backspace"] = 0x08, ["delete"] = 0x08, ["fwd-delete"] = 0x2E, ["forwarddelete"] = 0x2E,
        ["escape"] = 0x1B, ["esc"] = 0x1B,
        // Arrows
        ["up"] = 0x26, ["down"] = 0x28, ["left"] = 0x25, ["right"] = 0x27,
        ["arrow-up"] = 0x26, ["arrow-down"] = 0x28, ["arrow-left"] = 0x25, ["arrow-right"] = 0x27,
        // Navigation
        ["home"] = 0x24, ["end"] = 0x23, ["pageup"] = 0x21, ["pagedown"] = 0x22,
        ["page-up"] = 0x21, ["page-down"] = 0x22,
        // Function keys
        ["f1"] = 0x70, ["f2"] = 0x71, ["f3"] = 0x72, ["f4"] = 0x73, ["f5"] = 0x74,
        ["f6"] = 0x75, ["f7"] = 0x76, ["f8"] = 0x77, ["f9"] = 0x78, ["f10"] = 0x79,
        ["f11"] = 0x7A, ["f12"] = 0x7B,
        // Punctuation
        ["-"] = 0xBD, ["="] = 0xBB, ["["] = 0xDB, ["]"] = 0xDD, ["\\"] = 0xDC,
        [";"] = 0xBA, ["'"] = 0xDE, [","] = 0xBC, ["."] = 0xBE, ["/"] = 0xBF,
        ["`"] = 0xC0, ["minus"] = 0xBD, ["equal"] = 0xBB,
    };

    static readonly HashSet<string> ModifierNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "cmd", "command", "meta", "super", "ctrl", "control", "alt", "option", "opt", "shift"
    };

    public static void Keypress(string combo)
    {
        var parts = combo.ToLowerInvariant().Split('+');
        var modifiers = new List<ushort>();
        ushort? keyVk = null;

        foreach (var part in parts)
        {
            if (!VkMap.TryGetValue(part, out ushort vk))
            {
                Console.Error.WriteLine($"eclia-input: unknown key '{part}'");
                return;
            }
            if (ModifierNames.Contains(part))
            {
                modifiers.Add(vk);
            }
            else
            {
                if (keyVk != null)
                {
                    Console.Error.WriteLine($"eclia-input: multiple non-modifier keys in combo '{combo}'");
                    return;
                }
                keyVk = vk;
            }
        }

        // Press modifiers
        foreach (var mod in modifiers)
        {
            SendKey(mod, down: true);
            Thread.Sleep(20);
        }

        // Press + release main key
        if (keyVk != null)
        {
            SendKey(keyVk.Value, down: true);
            Thread.Sleep(50);
            SendKey(keyVk.Value, down: false);
        }
        else if (modifiers.Count == 0)
        {
            Console.Error.WriteLine("eclia-input: empty key combo");
            return;
        }
        else
        {
            Thread.Sleep(50);
        }

        // Release modifiers in reverse
        modifiers.Reverse();
        foreach (var mod in modifiers)
        {
            SendKey(mod, down: false);
            Thread.Sleep(20);
        }
    }

    static void SendKey(ushort vk, bool down)
    {
        var input = new Win32.INPUT
        {
            type = Win32.INPUT_KEYBOARD,
            u = new Win32.InputUnion
            {
                ki = new Win32.KEYBDINPUT
                {
                    wVk = vk,
                    dwFlags = down ? 0 : Win32.KEYEVENTF_KEYUP
                }
            }
        };
        Win32.SendInput(1, new[] { input }, Win32.InputSize);
    }

    public static void TypeText(string text)
    {
        // Use UNICODE SendInput — one char at a time for rich editor compatibility.
        foreach (char ch in text)
        {
            var down = new Win32.INPUT
            {
                type = Win32.INPUT_KEYBOARD,
                u = new Win32.InputUnion
                {
                    ki = new Win32.KEYBDINPUT
                    {
                        wVk = 0,
                        wScan = ch,
                        dwFlags = Win32.KEYEVENTF_UNICODE
                    }
                }
            };
            var up = new Win32.INPUT
            {
                type = Win32.INPUT_KEYBOARD,
                u = new Win32.InputUnion
                {
                    ki = new Win32.KEYBDINPUT
                    {
                        wVk = 0,
                        wScan = ch,
                        dwFlags = Win32.KEYEVENTF_UNICODE | Win32.KEYEVENTF_KEYUP
                    }
                }
            };
            Win32.SendInput(1, new[] { down }, Win32.InputSize);
            Win32.SendInput(1, new[] { up }, Win32.InputSize);
            Thread.Sleep(8); // 8ms per char, same as macOS
        }
    }
}

#endregion

#region Screenshot

static class Screenshot
{
    public static void Capture(int maxLongEdge = 0)
    {
        // Physical pixel resolution (DPI-aware).
        int physW = Win32.GetSystemMetrics(Win32.SM_CXSCREEN);
        int physH = Win32.GetSystemMetrics(Win32.SM_CYSCREEN);

        // Capture at physical resolution via BitBlt.
        IntPtr hdcScreen = Win32.GetDC(IntPtr.Zero);
        IntPtr hdcMem = Win32.CreateCompatibleDC(hdcScreen);
        IntPtr hBitmap = Win32.CreateCompatibleBitmap(hdcScreen, physW, physH);
        IntPtr hOld = Win32.SelectObject(hdcMem, hBitmap);

        Win32.BitBlt(hdcMem, 0, 0, physW, physH, hdcScreen, 0, 0, Win32.SRCCOPY);

        Win32.SelectObject(hdcMem, hOld);

        using var physBmp = Image.FromHbitmap(hBitmap);
        Win32.DeleteObject(hBitmap);
        Win32.DeleteDC(hdcMem);
        Win32.ReleaseDC(IntPtr.Zero, hdcScreen);

        // Target resolution: start from logical, then cap to maxLongEdge if set.
        var (logW, logH) = Win32.GetLogicalScreenSize();
        int outW = logW, outH = logH;
        if (maxLongEdge > 0 && Math.Max(outW, outH) > maxLongEdge)
        {
            double scale = (double)maxLongEdge / Math.Max(outW, outH);
            outW = (int)(outW * scale + 0.5);
            outH = (int)(outH * scale + 0.5);
        }

        Bitmap outBmp;
        if (outW == physW && outH == physH)
        {
            outBmp = new Bitmap(physBmp);
        }
        else
        {
            outBmp = new Bitmap(outW, outH);
            using var g = Graphics.FromImage(outBmp);
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.DrawImage(physBmp, 0, 0, outW, outH);
        }

        // JPEG encode in memory.
        using var ms = new MemoryStream();
        var jpegEncoder = ImageCodecInfo.GetImageEncoders()
            .First(e => e.FormatID == ImageFormat.Jpeg.Guid);
        var encoderParams = new EncoderParameters(1);
        encoderParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 80L);
        outBmp.Save(ms, jpegEncoder, encoderParams);
        outBmp.Dispose();

        string base64 = Convert.ToBase64String(ms.ToArray());

        // Output: "outW outH logicalW logicalH\nbase64\n"
        using var stdout = Console.OpenStandardOutput();
        var header = Encoding.UTF8.GetBytes($"{outW} {outH} {logW} {logH}\n");
        stdout.Write(header, 0, header.Length);
        var body = Encoding.UTF8.GetBytes(base64);
        stdout.Write(body, 0, body.Length);
        stdout.Write(new byte[] { (byte)'\n' }, 0, 1);
    }
}

#endregion

// --- Main ---

class Program
{
    static void PrintUsage()
    {
        Console.Error.Write(@"Usage:
  eclia-input click <x> <y> [left|right|middle|back|forward]
  eclia-input doubleclick <x> <y>
  eclia-input move <x> <y>
  eclia-input drag <x1> <y1> <x2> <y2> [x3 y3 ...]
  eclia-input type <text>
  eclia-input keypress <key[+key...]>
  eclia-input scroll <x> <y> <dy> [dx]
  eclia-input screenshot
  eclia-input screensize
");
    }

    static int Main(string[] args)
    {
        // DPI awareness — ensures GetSystemMetrics returns real pixels, not scaled.
        Win32.SetProcessDPIAware();

        if (args.Length < 1)
        {
            PrintUsage();
            return 1;
        }

        string command = args[0].ToLowerInvariant();

        switch (command)
        {
            case "click":
            {
                if (args.Length < 3 || !int.TryParse(args[1], out int x) || !int.TryParse(args[2], out int y))
                {
                    Console.Error.WriteLine("eclia-input click: requires <x> <y> [button]");
                    return 1;
                }
                string button = args.Length >= 4 ? args[3].ToLowerInvariant() : "left";
                Mouse.Click(x, y, button);
                break;
            }

            case "doubleclick":
            {
                if (args.Length < 3 || !int.TryParse(args[1], out int x) || !int.TryParse(args[2], out int y))
                {
                    Console.Error.WriteLine("eclia-input doubleclick: requires <x> <y>");
                    return 1;
                }
                Mouse.DoubleClick(x, y);
                break;
            }

            case "move":
            {
                if (args.Length < 3 || !int.TryParse(args[1], out int x) || !int.TryParse(args[2], out int y))
                {
                    Console.Error.WriteLine("eclia-input move: requires <x> <y>");
                    return 1;
                }
                Mouse.Move(x, y);
                break;
            }

            case "drag":
            {
                if (args.Length < 5 || (args.Length - 1) % 2 != 0)
                {
                    Console.Error.WriteLine("eclia-input drag: requires <x1> <y1> <x2> <y2> [x3 y3 ...]");
                    return 1;
                }
                var points = new List<(int x, int y)>();
                for (int i = 1; i < args.Length; i += 2)
                {
                    if (!int.TryParse(args[i], out int px) || !int.TryParse(args[i + 1], out int py))
                    {
                        Console.Error.WriteLine($"eclia-input drag: invalid coordinate at position {i}");
                        return 1;
                    }
                    points.Add((px, py));
                }
                Mouse.Drag(points);
                break;
            }

            case "type":
            {
                string text;
                if (args.Length >= 2 && args[1] == "-")
                {
                    // Read from stdin
                    text = Console.In.ReadToEnd();
                }
                else if (args.Length >= 2)
                {
                    text = string.Join(" ", args, 1, args.Length - 1);
                }
                else
                {
                    Console.Error.WriteLine("eclia-input type: requires <text> or - for stdin");
                    return 1;
                }
                Keyboard.TypeText(text);
                break;
            }

            case "keypress":
            case "key":
            {
                if (args.Length < 2)
                {
                    Console.Error.WriteLine("eclia-input keypress: requires <key[+key...]>");
                    return 1;
                }
                Keyboard.Keypress(args[1]);
                break;
            }

            case "scroll":
            {
                if (args.Length < 4 || !int.TryParse(args[1], out int x) || !int.TryParse(args[2], out int y)
                    || !int.TryParse(args[3], out int dy))
                {
                    Console.Error.WriteLine("eclia-input scroll: requires <x> <y> <dy> [dx]");
                    return 1;
                }
                int dx = args.Length >= 5 && int.TryParse(args[4], out int d) ? d : 0;
                Mouse.Scroll(x, y, dy, dx);
                break;
            }

            case "screenshot":
            {
                int maxDim = args.Length >= 2 && int.TryParse(args[1], out int md) ? md : 0;
                Screenshot.Capture(maxDim);
                break;
            }

            case "screensize":
            {
                var (w, h) = Win32.GetLogicalScreenSize();
                Console.WriteLine($"{w} {h}");
                break;
            }

            default:
                Console.Error.WriteLine($"eclia-input: unknown command '{command}'");
                PrintUsage();
                return 1;
        }

        return 0;
    }
}
