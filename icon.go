package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math"
)

// The tray icon, drawn in code: a chest (the WoWLocker icon) at 32×32.
// macOS gets a black template image (the menu bar tints it for light/dark);
// Windows gets the coloured one wrapped in an .ico.

func chestIcon(template bool, dim bool) []byte {
	const n = 32
	img := image.NewNRGBA(image.Rect(0, 0, n, n))
	wood := color.NRGBA{0x8f, 0x5a, 0x26, 0xff}
	band := color.NRGBA{0xc9, 0xa2, 0x27, 0xff}
	lock := color.NRGBA{0xff, 0xd1, 0x00, 0xff}
	edge := color.NRGBA{0x10, 0x0a, 0x04, 0xff}
	if template {
		wood, band, lock, edge = color.NRGBA{0, 0, 0, 0xff}, color.NRGBA{0, 0, 0, 0xff}, color.NRGBA{0, 0, 0, 0xff}, color.NRGBA{0, 0, 0, 0xff}
	}
	if dim { // not linked: a fainter icon
		for _, c := range []*color.NRGBA{&wood, &band, &lock, &edge} {
			c.A = 0x70
		}
	}
	inLid := func(x, y float64) bool { // a half-ellipse lid over the body
		cx, top, base := 16.0, 7.0, 14.0
		rx, ry := 13.0, base-top
		return y >= top && y < base && (x-cx)*(x-cx)/(rx*rx)+(y-base)*(y-base)/(ry*ry) <= 1
	}
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			fx, fy := float64(x)+0.5, float64(y)+0.5
			body := fx >= 3 && fx <= 29 && fy >= 14 && fy <= 28
			if !body && !inLid(fx, fy) {
				continue
			}
			c := wood
			switch {
			case math.Abs(fy-15) < 1.6: // the metal band where the lid closes
				c = band
				if template && math.Abs(fy-14.5) < 0.9 && (fx < 12.5 || fx > 19.5) {
					continue // the seam: lid and body read apart in one colour
				}
			case fx < 4 || fx > 28 || fy > 27:
				c = edge
			}
			// The lock plate, with a keyhole cut through (transparent in the template).
			if fx >= 12.5 && fx <= 19.5 && fy >= 13 && fy <= 22 {
				c = lock
				if math.Hypot(fx-16, fy-17) < 1.6 || (math.Abs(fx-16) < 0.8 && fy > 17 && fy < 20.5) {
					if template {
						continue
					}
					c = edge
				}
				if template && (fx < 13.5 || fx > 18.5 || fy > 21) {
					continue // a gap around the plate so it reads in one colour
				}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

// pngToICO wraps a PNG in an .ico container (supported since Windows Vista).
func pngToICO(p []byte) []byte {
	var b bytes.Buffer
	_ = binary.Write(&b, binary.LittleEndian, []uint16{0, 1, 1}) // reserved, type icon, 1 image
	b.Write([]byte{32, 32, 0, 0})                                // 32×32, no palette
	_ = binary.Write(&b, binary.LittleEndian, []uint16{1, 32})   // planes, bpp
	_ = binary.Write(&b, binary.LittleEndian, []uint32{uint32(len(p)), 22})
	b.Write(p)
	return b.Bytes()
}
