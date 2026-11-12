// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The slice of pdfmake 0.3's browser build the PDF writer uses. pdfmake ships
// no type declarations; this states exactly what `pdf.ts` relies on, so an
// upgrade that changes any of it fails the typecheck rather than an export.
declare module "pdfmake/build/pdfmake" {
  interface FontFaces {
    normal: string;
    bold: string;
    italics: string;
    bolditalics: string;
  }
  interface PdfMake {
    /** Files by name, base64-encoded. */
    addVirtualFileSystem(vfs: Record<string, string>): void;
    addFonts(fonts: Record<string, FontFaces>): void;
    /** Decides whether a URL in a document definition may be fetched. */
    setUrlAccessPolicy(callback: (url: string) => boolean): void;
    createPdf(definition: object): { getBuffer(): Promise<Uint8Array> };
  }
  const pdfMake: PdfMake;
  export default pdfMake;
}
