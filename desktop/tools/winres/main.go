// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Command winres writes the Windows resources the desktop program is linked
// with, as a `COFF` object Go links from the package's folder:
//
//	go run ./tools/winres -icon ../web/public/icon-512.png -o cmd/once-dark-studio-desktop/rsrc_windows_amd64.syso
//
// The resources are the program's icon, scaled from one square PNG to the
// sizes Explorer and the taskbar ask for, and a manifest that declares
// per-monitor DPI awareness and the version 6 common controls, so the
// program's message boxes are drawn sharp and in the current style. Each
// icon image is stored as PNG, which Windows reads since Vista.
//
// With `-tray DIR` it writes the tray adapter's icons instead, from the
// whole figure on a transparent square that `tools/brand/tray.mjs`
// renders, one for a dark taskbar and one for a light one:
//
//	go run ./tools/winres -tray internal/adapters/tray/icon -tray-night ../docs/brand/tray-night.png -tray-day ../docs/brand/tray-day.png
//
// It writes `tray-night.ico` and `tray-day.ico` for the notification area,
// and `tray.png`, the night one, for a Linux tray. A test fails when the
// committed icons differ from what the sources give.
package main

import (
	"bytes"
	"encoding/binary"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sort"
)

// Resource types and the language every resource is filed under.
const (
	rtIcon      = 3
	rtGroupIcon = 14
	rtManifest  = 24
	langEnUS    = 0x0409
)

// sizes are the icon's sides in pixels.
var sizes = []int{16, 20, 24, 32, 40, 48, 64, 256}

// traySizes are the tray icon's sides in pixels, from 100% to 400% display
// scale; trayPNG is the side of the Linux tray's image, which the host
// scales.
var traySizes = []int{16, 20, 24, 32, 40, 48, 64}

const trayPNG = 64

const manifest = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>
`

func main() {
	icon := flag.String("icon", "", "a square PNG, 256 pixels a side or more")
	out := flag.String("o", "", "the .syso file to write")
	tray := flag.String("tray", "", "the folder to write the tray's icons into")
	night := flag.String("tray-night", "", "the tray's square PNG for a dark taskbar")
	day := flag.String("tray-day", "", "the tray's square PNG for a light taskbar")
	flag.Parse()
	withObject := *icon != "" && *out != ""
	withTray := *tray != "" && *night != "" && *day != ""
	if !withObject && !withTray || flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "usage: winres -icon <square.png> -o <rsrc_windows_amd64.syso>")
		fmt.Fprintln(os.Stderr, "       winres -tray <folder> -tray-night <square.png> -tray-day <square.png>")
		os.Exit(2)
	}
	var err error
	if withObject {
		err = writeObject(*icon, *out)
	}
	if err == nil && withTray {
		err = writeTray(*tray, *night, *day)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "winres:", err)
		os.Exit(1)
	}
}

func writeObject(iconPath, out string) error {
	src, err := decode(iconPath)
	if err != nil {
		return err
	}
	res, err := resources(src)
	if err != nil {
		return err
	}
	return os.WriteFile(out, object(res), 0o644)
}

func writeTray(dir, nightPath, dayPath string) error {
	files, err := trayFiles(nightPath, dayPath)
	if err != nil {
		return err
	}
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// trayFiles answers the tray's icon files by name, from its two sources.
func trayFiles(nightPath, dayPath string) (map[string][]byte, error) {
	night, err := decode(nightPath)
	if err != nil {
		return nil, err
	}
	day, err := decode(dayPath)
	if err != nil {
		return nil, err
	}
	nightICO, pic, err := trayIcons(night)
	if err != nil {
		return nil, err
	}
	dayICO, _, err := trayIcons(day)
	if err != nil {
		return nil, err
	}
	return map[string][]byte{"tray-night.ico": nightICO, "tray-day.ico": dayICO, "tray.png": pic}, nil
}

func decode(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	src, err := png.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	b := src.Bounds()
	if b.Dx() != b.Dy() || b.Dx() < 256 {
		return nil, fmt.Errorf("%s is %dx%d; it must be square and 256 pixels a side or more", path, b.Dx(), b.Dy())
	}
	return src, nil
}

// trayIcons answers the tray's `.ico`, one PNG image per tray size, and
// its PNG.
func trayIcons(src image.Image) ([]byte, []byte, error) {
	var images [][]byte
	for _, n := range traySizes {
		var img bytes.Buffer
		if err := png.Encode(&img, scale(src, n)); err != nil {
			return nil, nil, err
		}
		images = append(images, img.Bytes())
	}
	le := binary.LittleEndian
	var ico bytes.Buffer
	_ = binary.Write(&ico, le, [3]uint16{0, 1, uint16(len(images))})
	at := 6 + 16*len(images)
	for i, n := range traySizes {
		_ = binary.Write(&ico, le, struct {
			Width, Height, Colors, Reserved uint8
			Planes, BitCount                uint16
			Bytes, At                       uint32
		}{uint8(n), uint8(n), 0, 0, 1, 32, uint32(len(images[i])), uint32(at)})
		at += len(images[i])
	}
	for _, img := range images {
		ico.Write(img)
	}
	var pic bytes.Buffer
	if err := png.Encode(&pic, scale(src, trayPNG)); err != nil {
		return nil, nil, err
	}
	return ico.Bytes(), pic.Bytes(), nil
}

type resource struct {
	typ, id uint16
	data    []byte
}

// resources answers one icon image per size, the icon group naming them,
// and the manifest.
func resources(src image.Image) ([]resource, error) {
	b := src.Bounds()
	if b.Dx() != b.Dy() || b.Dx() < 256 {
		return nil, fmt.Errorf("the icon is %dx%d; it must be square and 256 pixels a side or more", b.Dx(), b.Dy())
	}
	var res []resource
	group := new(bytes.Buffer)
	le := binary.LittleEndian
	_ = binary.Write(group, le, [3]uint16{0, 1, uint16(len(sizes))})
	for i, n := range sizes {
		var img bytes.Buffer
		if err := png.Encode(&img, scale(src, n)); err != nil {
			return nil, err
		}
		id := uint16(i + 1)
		res = append(res, resource{rtIcon, id, img.Bytes()})
		// A side of 256 is written as 0.
		side := uint8(n % 256)
		_ = binary.Write(group, le, struct {
			Width, Height, Colors, Reserved uint8
			Planes, BitCount                uint16
			Bytes                           uint32
			ID                              uint16
		}{side, side, 0, 0, 1, 32, uint32(img.Len()), id})
	}
	res = append(res, resource{rtGroupIcon, 1, group.Bytes()}, resource{rtManifest, 1, []byte(manifest)})
	return res, nil
}

// scale answers src scaled to n by n, each pixel the average of the source
// pixels it covers.
func scale(src image.Image, n int) *image.NRGBA {
	b := src.Bounds()
	step := float64(b.Dx()) / float64(n)
	dst := image.NewNRGBA(image.Rect(0, 0, n, n))
	for y := 0; y < n; y++ {
		y0, y1 := span(b.Min.Y, y, step)
		for x := 0; x < n; x++ {
			x0, x1 := span(b.Min.X, x, step)
			var r, g, bl, a, count uint64
			for sy := y0; sy < y1; sy++ {
				for sx := x0; sx < x1; sx++ {
					pr, pg, pb, pa := src.At(sx, sy).RGBA()
					r, g, bl, a = r+uint64(pr), g+uint64(pg), bl+uint64(pb), a+uint64(pa)
					count++
				}
			}
			dst.Set(x, y, color.RGBA64{
				R: uint16(r / count), G: uint16(g / count), B: uint16(bl / count), A: uint16(a / count),
			})
		}
	}
	return dst
}

func span(origin, i int, step float64) (int, int) {
	lo := origin + int(float64(i)*step)
	hi := origin + int(math.Ceil(float64(i+1)*step))
	return lo, max(hi, lo+1)
}

// object answers a `COFF` object holding res in a `.rsrc` section: the
// three-level resource directory (type, id, language), one data entry per
// resource, and the data. Each data entry's address is relative to the
// section, and a relocation has the linker add the section's address.
func object(res []resource) []byte {
	sort.Slice(res, func(i, j int) bool {
		if res[i].typ != res[j].typ {
			return res[i].typ < res[j].typ
		}
		return res[i].id < res[j].id
	})
	var types []uint16
	count := map[uint16]int{}
	for _, r := range res {
		if count[r.typ] == 0 {
			types = append(types, r.typ)
		}
		count[r.typ]++
	}

	off := 16 + 8*len(types)
	typeAt := map[uint16]int{}
	for _, t := range types {
		typeAt[t] = off
		off += 16 + 8*count[t]
	}
	langAt, entryAt, dataAt := make([]int, len(res)), make([]int, len(res)), make([]int, len(res))
	for i := range res {
		langAt[i] = off
		off += 16 + 8
	}
	for i := range res {
		entryAt[i] = off
		off += 16
	}
	for i, r := range res {
		off = align8(off)
		dataAt[i] = off
		off += len(r.data)
	}

	sec := make([]byte, align8(off))
	le := binary.LittleEndian
	// A directory's header is zero but for its count of entries by id.
	dir := func(at, entries int) { le.PutUint16(sec[at+14:], uint16(entries)) }
	const subdirectory = 1 << 31
	dir(0, len(types))
	for i, t := range types {
		le.PutUint32(sec[16+8*i:], uint32(t))
		le.PutUint32(sec[16+8*i+4:], uint32(typeAt[t])|subdirectory)
	}
	seen := map[uint16]int{}
	for i, r := range res {
		if seen[r.typ] == 0 {
			dir(typeAt[r.typ], count[r.typ])
		}
		at := typeAt[r.typ] + 16 + 8*seen[r.typ]
		seen[r.typ]++
		le.PutUint32(sec[at:], uint32(r.id))
		le.PutUint32(sec[at+4:], uint32(langAt[i])|subdirectory)

		dir(langAt[i], 1)
		le.PutUint32(sec[langAt[i]+16:], langEnUS)
		le.PutUint32(sec[langAt[i]+20:], uint32(entryAt[i]))

		le.PutUint32(sec[entryAt[i]:], uint32(dataAt[i]))
		le.PutUint32(sec[entryAt[i]+4:], uint32(len(r.data)))
		copy(sec[dataAt[i]:], r.data)
	}

	const fileHeader, sectionHeader, relocation = 20, 40, 10
	rawAt := fileHeader + sectionHeader
	relocAt := rawAt + len(sec)
	symbolAt := relocAt + relocation*len(res)
	var b bytes.Buffer
	_ = binary.Write(&b, le, struct {
		Machine, Sections                   uint16
		Time, SymbolTable, Symbols          uint32
		OptionalHeaderSize, Characteristics uint16
	}{0x8664, 1, 0, uint32(symbolAt), 1, 0, 0})
	_ = binary.Write(&b, le, struct {
		Name                                        [8]byte
		VirtualSize, VirtualAddress, RawSize, RawAt uint32
		RelocationsAt, LineNumbersAt                uint32
		Relocations, LineNumbers                    uint16
		Characteristics                             uint32
	}{
		Name:          [8]byte{'.', 'r', 's', 'r', 'c'},
		RawSize:       uint32(len(sec)),
		RawAt:         uint32(rawAt),
		RelocationsAt: uint32(relocAt),
		Relocations:   uint16(len(res)),
		// Initialized data, readable.
		Characteristics: 0x40000040,
	})
	b.Write(sec)
	for i := range res {
		// IMAGE_REL_AMD64_ADDR32NB against symbol 0, the section.
		_ = binary.Write(&b, le, struct {
			At, Symbol uint32
			Type       uint16
		}{uint32(entryAt[i]), 0, 3})
	}
	_ = binary.Write(&b, le, struct {
		Name                     [8]byte
		Value                    uint32
		Section                  int16
		Type                     uint16
		StorageClass, AuxSymbols uint8
	}{Name: [8]byte{'.', 'r', 's', 'r', 'c'}, Section: 1, StorageClass: 3})
	// An empty string table holds only its own size.
	_ = binary.Write(&b, le, uint32(4))
	return b.Bytes()
}

func align8(n int) int { return (n + 7) &^ 7 }
