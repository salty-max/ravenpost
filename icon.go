package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math"
)

// The tray icon, drawn in code: a sealed letter (Ravenpost carries your
// characters' records) at 32×32. macOS gets a black template image (the menu
// bar tints it for light/dark); Windows gets the coloured one wrapped in an .ico.

func envelopeIcon(template bool, dim bool) []byte {
	const n = 32
	img := image.NewNRGBA(image.Rect(0, 0, n, n))
	paper := color.NRGBA{0xf1, 0xe2, 0xbf, 0xff}
	fold := color.NRGBA{0x8a, 0x6a, 0x3c, 0xff}
	seal := color.NRGBA{0xa5, 0x1d, 0x17, 0xff}
	edge := color.NRGBA{0x2a, 0x1d, 0x12, 0xff}
	if template {
		paper, fold, seal, edge = color.NRGBA{0, 0, 0, 0xff}, color.NRGBA{0, 0, 0, 0xff}, color.NRGBA{0, 0, 0, 0xff}, color.NRGBA{0, 0, 0, 0xff}
	}
	if dim { // nothing linked: a fainter icon
		for _, c := range []*color.NRGBA{&paper, &fold, &seal, &edge} {
			c.A = 0x70
		}
	}
	const left, right, top, bottom = 3.0, 29.0, 8.0, 25.0
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			fx, fy := float64(x)+0.5, float64(y)+0.5
			if fx < left || fx > right || fy < top || fy > bottom {
				continue
			}
			c := paper
			if fx < left+1 || fx > right-1 || fy < top+1 || fy > bottom-1 {
				c = edge
			}
			// The flap: a V from the top corners to the middle.
			mid := (left + right) / 2
			flapY := top + (16.0-top)*(1-math.Abs(fx-mid)/(mid-left))
			if math.Abs(fy-flapY) < 0.9 {
				c = fold
				if template {
					continue // the fold, cut through in one colour
				}
			}
			// The wax seal where the flap meets.
			if d := math.Hypot(fx-mid, fy-16.5); d < 3.6 {
				c = seal
				if template && d > 2.6 {
					continue // a ring around the seal so it reads in one colour
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
