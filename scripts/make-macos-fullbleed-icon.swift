import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 3 else {
  fputs("usage: make-macos-fullbleed-icon.swift <input.png> <output.png>\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard
  let source = CGImageSourceCreateWithURL(inputURL as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
  fputs("failed to decode input image\n", stderr)
  exit(1)
}

let width = image.width
let height = image.height
let pixelCount = width * height
var pixels = [UInt8](repeating: 0, count: pixelCount * 4)
let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue
  | CGImageAlphaInfo.premultipliedLast.rawValue

guard let context = CGContext(
  data: &pixels,
  width: width,
  height: height,
  bitsPerComponent: 8,
  bytesPerRow: width * 4,
  space: CGColorSpaceCreateDeviceRGB(),
  bitmapInfo: bitmapInfo
) else {
  fputs("failed to create bitmap context\n", stderr)
  exit(1)
}

context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

// Multi-source flood fill: every transparent pixel inherits the color of its
// nearest fully opaque edge pixel. This removes a pre-baked icon mask without
// changing the visible artwork and gives macOS an opaque, full-bleed canvas.
var fillR = [UInt8](repeating: 0, count: pixelCount)
var fillG = [UInt8](repeating: 0, count: pixelCount)
var fillB = [UInt8](repeating: 0, count: pixelCount)
var visited = [Bool](repeating: false, count: pixelCount)
var queue = [Int]()
queue.reserveCapacity(pixelCount)

for index in 0..<pixelCount {
  let offset = index * 4
  if pixels[offset + 3] == 255 {
    fillR[index] = pixels[offset]
    fillG[index] = pixels[offset + 1]
    fillB[index] = pixels[offset + 2]
    visited[index] = true
    queue.append(index)
  }
}

guard !queue.isEmpty else {
  fputs("input image has no opaque pixels\n", stderr)
  exit(1)
}

let neighbors = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]
var head = 0
while head < queue.count {
  let index = queue[head]
  head += 1
  let x = index % width
  let y = index / width

  for (dx, dy) in neighbors {
    let nextX = x + dx
    let nextY = y + dy
    guard nextX >= 0, nextX < width, nextY >= 0, nextY < height else { continue }
    let next = nextY * width + nextX
    guard !visited[next] else { continue }
    visited[next] = true
    fillR[next] = fillR[index]
    fillG[next] = fillG[index]
    fillB[next] = fillB[index]
    queue.append(next)
  }
}

for index in 0..<pixelCount {
  let offset = index * 4
  let alpha = Int(pixels[offset + 3])
  if alpha < 255 {
    let inverseAlpha = 255 - alpha
    pixels[offset] = UInt8(min(255, Int(pixels[offset]) + Int(fillR[index]) * inverseAlpha / 255))
    pixels[offset + 1] = UInt8(min(255, Int(pixels[offset + 1]) + Int(fillG[index]) * inverseAlpha / 255))
    pixels[offset + 2] = UInt8(min(255, Int(pixels[offset + 2]) + Int(fillB[index]) * inverseAlpha / 255))
    pixels[offset + 3] = 255
  }
}

guard
  let outputImage = context.makeImage(),
  let destination = CGImageDestinationCreateWithURL(
    outputURL as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
  )
else {
  fputs("failed to create output image\n", stderr)
  exit(1)
}

CGImageDestinationAddImage(destination, outputImage, nil)
guard CGImageDestinationFinalize(destination) else {
  fputs("failed to write output image\n", stderr)
  exit(1)
}

print("created \(outputURL.path) (\(width)x\(height), opaque)")
