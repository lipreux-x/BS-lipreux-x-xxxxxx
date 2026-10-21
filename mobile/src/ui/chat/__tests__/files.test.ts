import { MAX_FILE_NAME } from '@/crypto';
import { fileExt, fileSizeLabel, safeFileName } from '../files';

describe('document sizes', () => {
  it('reads in bytes, kilobytes and megabytes with a French decimal', () => {
    expect(fileSizeLabel(830)).toBe('830 o');
    expect(fileSizeLabel(12_400)).toBe('12 Ko');
    expect(fileSizeLabel(1_234_567)).toBe('1,2 Mo');
    expect(fileSizeLabel(10_000_000)).toBe('10 Mo');
  });
});

describe('document names', () => {
  it('drops paths and control characters, keeps the rest', () => {
    expect(safeFileName('Contrat 2026.pdf')).toBe('Contrat 2026.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('....etcpasswd');
    expect(safeFileName('a\u0000b\nc.txt')).toBe('abc.txt');
  });

  it('falls back to "document" when nothing is left, keeps the extension when cut', () => {
    expect(safeFileName('  ')).toBe('document');
    expect(safeFileName('..')).toBe('document');
    const long = 'x'.repeat(200) + '.PDF';
    const cut = safeFileName(long);
    expect(cut.length).toBe(MAX_FILE_NAME);
    expect(cut.endsWith('.pdf')).toBe(true);
  });

  it('reads the extension for the badge', () => {
    expect(fileExt('rapport.pdf')).toBe('PDF');
    expect(fileExt('archive.tar.gz')).toBe('GZ');
    expect(fileExt('.bashrc')).toBe('');
    expect(fileExt('sans extension')).toBe('');
  });
});
