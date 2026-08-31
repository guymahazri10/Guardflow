import type { FileKind } from './types'

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]
const PDF_MAGIC = '%PDF'

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false
  return magic.every((byte, i) => bytes[i] === byte)
}

function stripBom(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.slice(3)
  }
  return bytes
}

export function detectFileKind(bytes: Uint8Array): FileKind {
  if (startsWith(bytes, XLSX_MAGIC)) return 'xlsx'
  if (startsWith(bytes, OLE2_MAGIC)) return 'xlsx'

  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(stripBom(bytes).slice(0, 2048))
  const trimmed = decoded.trimStart()

  if (trimmed.startsWith(PDF_MAGIC)) return 'pdf'

  const lower = trimmed.toLowerCase()
  if (lower.startsWith('<html') || lower.startsWith('<!doctype html') || lower.startsWith('<table')) {
    return 'xls-html'
  }

  return 'unknown'
}
