// Renders the VegaLink app icon (512x512 PNG) to assets/image/vegalink_icon.png.
// Usage: swift tools/icon/make_icon.swift <output.png>
import AppKit
import CoreGraphics

let size = 512
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "vegalink_icon.png"
let cs = CGColorSpaceCreateDeviceRGB()
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                    space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
// Flip to a top-left origin so coordinates read like a design spec.
ctx.translateBy(x: 0, y: CGFloat(size))
ctx.scaleBy(x: 1, y: -1)

func rgb(_ r: Int, _ g: Int, _ b: Int, _ a: CGFloat = 1) -> CGColor {
  CGColor(red: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: a)
}

// Background: full-bleed diagonal gradient (the launcher applies its own rounding).
let bg = CGGradient(colorsSpace: cs, colors: [rgb(37, 99, 235), rgb(76, 29, 149)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(bg, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 512, y: 512), options: [])

let white = rgb(255, 255, 255)
let ink = rgb(55, 48, 163)

// Streaming arcs above the controller.
ctx.setStrokeColor(white)
ctx.setLineCap(.round)
let arcCenter = CGPoint(x: 256, y: 250)
for (i, r) in [CGFloat(60), 100, 140].enumerated() {
  ctx.setLineWidth(22)
  ctx.setAlpha(1.0 - CGFloat(i) * 0.25)
  ctx.addArc(center: arcCenter, radius: r, startAngle: .pi * 1.25, endAngle: .pi * 1.75, clockwise: false)
  ctx.strokePath()
}
ctx.setAlpha(1)

// Controller body: a wide rounded bar plus two rounded grips.
ctx.setFillColor(white)
ctx.addPath(CGPath(roundedRect: CGRect(x: 96, y: 262, width: 320, height: 132), cornerWidth: 66, cornerHeight: 66, transform: nil))
ctx.fillPath()
for gx in [CGFloat(96), 336] {
  ctx.addPath(CGPath(roundedRect: CGRect(x: gx, y: 300, width: 80, height: 130), cornerWidth: 40, cornerHeight: 40, transform: nil))
  ctx.fillPath()
}

// D-pad.
ctx.setFillColor(ink)
ctx.addPath(CGPath(roundedRect: CGRect(x: 150, y: 314, width: 64, height: 22), cornerWidth: 6, cornerHeight: 6, transform: nil))
ctx.addPath(CGPath(roundedRect: CGRect(x: 171, y: 293, width: 22, height: 64), cornerWidth: 6, cornerHeight: 6, transform: nil))
ctx.fillPath()

// Face buttons.
for (bx, by) in [(340.0, 302.0), (340.0, 348.0), (317.0, 325.0), (363.0, 325.0)] {
  ctx.fillEllipse(in: CGRect(x: bx - 12, y: by - 12, width: 24, height: 24))
}

let image = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: image)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
