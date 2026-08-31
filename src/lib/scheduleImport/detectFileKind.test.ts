import { describe, it, expect } from 'vitest'
import { detectFileKind } from './detectFileKind'

function bytesFrom(arr: number[]): Uint8Array {
  return new Uint8Array(arr)
}

function bytesFromText(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('detectFileKind', () => {
  it('detects real xlsx by zip magic bytes', () => {
    expect(detectFileKind(bytesFrom([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]))).toBe('xlsx')
  })

  it('detects real legacy xls by OLE2 magic bytes', () => {
    expect(
      detectFileKind(bytesFrom([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toBe('xlsx')
  })

  it('detects pdf by %PDF header', () => {
    expect(detectFileKind(bytesFromText('%PDF-1.4\n...'))).toBe('pdf')
  })

  it('detects html-as-xls via <html tag', () => {
    expect(detectFileKind(bytesFromText('<html><body><table></table></body></html>'))).toBe(
      'xls-html',
    )
  })

  it('detects html-as-xls via bare <table tag with leading whitespace', () => {
    expect(detectFileKind(bytesFromText('  \n<table><tr><td>x</td></tr></table>'))).toBe(
      'xls-html',
    )
  })

  it('detects html-as-xls case-insensitively with a BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesFromText('<HTML><TABLE>')])
    expect(detectFileKind(withBom)).toBe('xls-html')
  })

  it('returns unknown for unrecognized bytes', () => {
    expect(detectFileKind(bytesFrom([1, 2, 3, 4, 5]))).toBe('unknown')
  })
})
