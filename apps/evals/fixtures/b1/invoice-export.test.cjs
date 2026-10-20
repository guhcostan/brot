'use strict';
const assert = require('node:assert');
const parseInvoiceExport = require('./invoice-export');

const rows = [
  { invoice_id: 'INV-1', amount: '120' },
  { invoice_id: 'INV-2', amount: '80' },
];
const body = 'invoice_id,amount\nINV-1,120\nINV-2,80\n';
assert.deepStrictEqual(parseInvoiceExport(body), rows);
assert.deepStrictEqual(parseInvoiceExport(`﻿${body}`), rows);
console.log('ok');
