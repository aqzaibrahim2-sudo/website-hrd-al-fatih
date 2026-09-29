const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const gas = fs.readFileSync(path.join(__dirname, '..', 'code.gs'), 'utf8');
const context = {};
vm.runInNewContext(gas, context);

function fakeSheet(ids) {
  return {
    ids: ids.slice(),
    getLastRow() { return this.ids.length + 1; },
    getRange(row, col, count) {
      assert.equal(row, 2); assert.equal(col, 1);
      return { getDisplayValues: () => this.ids.slice(0, count).map(id => [id]) };
    }
  };
}

assert.equal(context.programPrefix_('Program'), 'PRG');
assert.equal(context.programPrefix_('Project'), 'PRJ');
assert.equal(context.programPrefix_('Issue'), 'ISU');
assert.equal(context.programPrefix_('Task'), 'TSK');
assert.throws(() => context.programPrefix_('Other'), /Jenis Program tidak valid/);
assert.equal(context.nextProgramId_(fakeSheet(['PRG-001', 'PRG-003', 'PRJ-020']), 'Program'), 'PRG-004');
assert.equal(context.nextProgramId_(fakeSheet(['PRG-001', 'PRJ-020']), 'Project'), 'PRJ-021');
assert.equal(context.nextProgramId_(fakeSheet([]), 'Program'), 'PRG-001');

assert.match(gas, /lock\.waitLock\(15000\)/);
assert.match(gas, /var id = nextProgramId_\(sheet, data\.JENIS\)/);
assert.match(gas, /ID_PROGRAM: id/);
assert.match(gas, /Ignore any client-supplied ID/);
console.log('PASS: 4 prefix mappings, invalid type rejection, global sequence, and server allocation assertions');
