// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package main

import (
	"bytes"
	"debug/pe"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func square(n int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, n, n))
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			c := color.RGBA{0x10, 0x10, 0x10, 0xff}
			if x < n/2 {
				c = color.RGBA{0xf0, 0xf0, 0xf0, 0xff}
			}
			img.Set(x, y, c)
		}
	}
	return img
}

// lookup follows the resource directory from the section's start to the
// data of type typ and id, as Windows does once the section is loaded.
func lookup(t *testing.T, sec []byte, typ, id uint32) []byte {
	t.Helper()
	le := binary.LittleEndian
	child := func(at int, want uint32) int {
		n := int(le.Uint16(sec[at+12:])) + int(le.Uint16(sec[at+14:]))
		for i := 0; i < n; i++ {
			e := at + 16 + 8*i
			if want == 0 || le.Uint32(sec[e:]) == want {
				return int(le.Uint32(sec[e+4:]) &^ (1 << 31))
			}
		}
		t.Fatalf("no entry %d in the directory at %d", want, at)
		return 0
	}
	entry := child(child(child(0, typ), id), 0)
	at, size := le.Uint32(sec[entry:]), le.Uint32(sec[entry+4:])
	return sec[at : at+size]
}

func TestTheObjectHoldsTheIconAndTheManifest(t *testing.T) {
	res, err := resources(square(512))
	if err != nil {
		t.Fatal(err)
	}
	obj := object(res)
	f, err := pe.NewFile(bytes.NewReader(obj))
	if err != nil {
		t.Fatal(err)
	}
	if f.Machine != pe.IMAGE_FILE_MACHINE_AMD64 || len(f.Sections) != 1 || f.Sections[0].Name != ".rsrc" {
		t.Fatalf("machine %#x, sections %d", f.Machine, len(f.Sections))
	}
	s := f.Sections[0]
	if len(s.Relocs) != len(sizes)+2 {
		t.Fatalf("%d relocations for %d resources", len(s.Relocs), len(sizes)+2)
	}
	for _, r := range s.Relocs {
		if r.Type != 3 || r.SymbolTableIndex != 0 {
			t.Fatalf("relocation %+v", r)
		}
	}
	sec, err := s.Data()
	if err != nil {
		t.Fatal(err)
	}

	if m := lookup(t, sec, rtManifest, 1); !strings.Contains(string(m), "PerMonitorV2") {
		t.Fatalf("manifest %q", m)
	}
	group := lookup(t, sec, rtGroupIcon, 1)
	le := binary.LittleEndian
	if le.Uint16(group[2:]) != 1 || int(le.Uint16(group[4:])) != len(sizes) {
		t.Fatalf("group header % x", group[:6])
	}
	for i, n := range sizes {
		e := group[6+14*i:]
		id := uint32(le.Uint16(e[12:]))
		img, err := png.Decode(bytes.NewReader(lookup(t, sec, rtIcon, id)))
		if err != nil {
			t.Fatalf("icon %d: %v", id, err)
		}
		if img.Bounds().Dx() != n || int(le.Uint32(e[8:])) != len(lookup(t, sec, rtIcon, id)) {
			t.Fatalf("icon %d is %d pixels and %d bytes, the group says %d and %d",
				id, img.Bounds().Dx(), len(lookup(t, sec, rtIcon, id)), n, le.Uint32(e[8:]))
		}
		if side := int(e[0]); side != n%256 {
			t.Fatalf("icon %d: the group says %d for %d", id, side, n)
		}
	}
}

func TestScaleAveragesTheSourcePixels(t *testing.T) {
	img := scale(square(512), 2)
	if c := img.NRGBAAt(0, 0); c.R != 0xf0 || c.A != 0xff {
		t.Fatalf("left %v", c)
	}
	if c := img.NRGBAAt(1, 1); c.R != 0x10 || c.A != 0xff {
		t.Fatalf("right %v", c)
	}
}

// TestTheCommittedTrayIconsMatchTheirSources fails when the tray's
// committed icons were not written again after their sources changed.
func TestTheCommittedTrayIconsMatchTheirSources(t *testing.T) {
	brand := filepath.Join("..", "..", "..", "docs", "brand")
	files, err := trayFiles(filepath.Join(brand, "tray-night.png"), filepath.Join(brand, "tray-day.png"))
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join("..", "..", "internal", "adapters", "tray", "icon")
	for name, want := range files {
		got, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil || !bytes.Equal(got, want) {
			t.Errorf("%s differs from its source (%v); run: go run ./tools/winres -tray internal/adapters/tray/icon -tray-night ../docs/brand/tray-night.png -tray-day ../docs/brand/tray-day.png", name, err)
		}
	}
}

func TestTheTrayIconHoldsEveryTraySize(t *testing.T) {
	ico, _, err := trayIcons(square(512))
	if err != nil {
		t.Fatal(err)
	}
	le := binary.LittleEndian
	if le.Uint16(ico[2:]) != 1 || int(le.Uint16(ico[4:])) != len(traySizes) {
		t.Fatalf("header % x", ico[:6])
	}
	for i, n := range traySizes {
		e := ico[6+16*i:]
		at, size := le.Uint32(e[12:]), le.Uint32(e[8:])
		img, err := png.Decode(bytes.NewReader(ico[at : at+size]))
		if err != nil || img.Bounds().Dx() != n || int(e[0]) != n {
			t.Fatalf("image %d: %v, want %d pixels", i, err, n)
		}
	}
}

func TestResourcesRefuseASmallOrOblongIcon(t *testing.T) {
	if _, err := resources(square(128)); err == nil {
		t.Fatal("a 128-pixel icon was taken")
	}
	if _, err := resources(image.NewRGBA(image.Rect(0, 0, 512, 300))); err == nil {
		t.Fatal("an oblong icon was taken")
	}
}
