import { jpegSize, safeToDisplay } from '../jpeg';

/** A minimal JPEG header: SOI, an APP0 segment, then a SOF0 frame header with the given size. */
function jpeg(width: number, height: number, marker = 0xc0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sof = [0xff, marker, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

describe('jpeg guard', () => {
  it('reads the frame size', () => {
    expect(jpegSize(jpeg(1600, 1200))).toEqual({ width: 1600, height: 1200 });
    expect(jpegSize(jpeg(800, 600, 0xc2))).toEqual({ width: 800, height: 600 }); // progressive
  });

  it('refuses huge dimensions (a few bytes that would exhaust the decoder)', () => {
    expect(safeToDisplay(jpeg(1600, 1200))).toBe(true);
    expect(safeToDisplay(jpeg(30000, 30000))).toBe(false);
    expect(safeToDisplay(jpeg(4097, 10))).toBe(false);
  });

  it('refuses anything that is not a well-formed JPEG', () => {
    expect(safeToDisplay(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // PNG
    expect(safeToDisplay(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff]))).toBe(false); // segment past the end
    expect(safeToDisplay(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBe(false); // scan before any frame
    expect(safeToDisplay(jpeg(0, 100))).toBe(false);
  });
});
