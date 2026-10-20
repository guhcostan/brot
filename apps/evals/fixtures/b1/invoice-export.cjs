'use strict';
// Parses the CSV that the invoice export writes. The first line is the header; rows without an invoice_id are dropped.
function parseInvoiceExport(text) {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const [header, ...rows] = lines;
  const names = header.split(',');
  return rows
    .map((line) => {
      const cells = line.split(',');
      return Object.fromEntries(names.map((name, index) => [name, cells[index] ?? '']));
    })
    .filter((row) => row.invoice_id);
}

module.exports = parseInvoiceExport;
