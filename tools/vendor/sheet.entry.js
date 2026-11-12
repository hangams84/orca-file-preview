// SheetJS Community Edition 0.20.3 (Apache-2.0). Codepage tables included for legacy .xls text.
import * as XLSX from 'xlsx'
import * as cptable from 'xlsx/dist/cpexcel.full.mjs'
XLSX.set_cptable(cptable)
export const read = XLSX.read
export const utils = XLSX.utils
export const SSF = XLSX.SSF
