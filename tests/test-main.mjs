import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as scanner from '../src/scanner-adapter.js';
import * as renderer from '../src/report-renderer.js';

// Run with: node --experimental-vm-modules --test tests/test-main.mjs
// The real UI, scanner and renderer run with fictional Files and a minimal DOM.
// Only the download boundary and unexpected classifier failure seam are faked.
const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const inputIds = ['metadataFiles', 'metadataFolder'];
const exportIds = ['downloadJson', 'downloadHtml'];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(label, { delayed = false } = {}) {
  const text = '<ValidationRule><active>true</active><description> </description></ValidationRule>';
  const file = new File([text], `${label}.validationRule-meta.xml`, { type: 'text/xml' });
  Object.defineProperty(file, 'webkitRelativePath', {
    value: `objects/Account/validationRules/${file.name}`,
  });
  const gate = deferred();
  const started = deferred();
  const bytes = new TextEncoder().encode(text).buffer;
  file.arrayBuffer = () => { started.resolve(); return gate.promise; };
  if (!delayed) gate.resolve(bytes);
  return { file, started: started.promise, finish: () => gate.resolve(bytes) };
}

async function mount({ classify = scanner.classifySelectedFiles } = {}) {
  const nodes = new Map();
  for (const id of [...inputIds, ...exportIds, 'fileSummary', 'scanStatus', 'limitationsRows', 'coverageRows', 'findingsRows']) {
    nodes.set(id, {
      textContent: '', innerHTML: '', disabled: false, files: [], handlers: new Map(),
      addEventListener(event, callback) { this.handlers.set(event, callback); },
      // Intentionally bypass disabled semantics: the handler must guard itself.
      dispatch(event) { return this.handlers.get(event)?.(); },
    });
  }
  const downloads = [];
  const messages = [];
  const context = vm.createContext({
    document: { querySelector: (selector) => nodes.get(selector.slice(1)) },
    console: Object.fromEntries(['log', 'warn', 'error', 'info'].map((level) => [level, (...args) => messages.push(args.join(' '))])),
  });
  const bindings = {
    './scanner-adapter.js': { ...scanner, classifySelectedFiles: classify },
    './report-renderer.js': renderer,
    './report-exporter.js': { downloadReport: (result, format) => downloads.push({ result, format }) },
  };
  const main = new vm.SourceTextModule(mainSource, { context });
  await main.link((specifier) => {
    const exports = bindings[specifier];
    assert.ok(exports, 'UI imports stay within the expected local modules');
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await main.evaluate();
  return {
    nodes, downloads, messages,
    select(id, files) {
      nodes.get(id).files = files;
      // Observe any rejection immediately, even when testing older completions.
      return Promise.resolve(nodes.get(id).dispatch('change')).then(
        () => ({ ok: true }), () => ({ ok: false }),
      );
    },
    clickBoth() { for (const id of exportIds) nodes.get(id).dispatch('click'); },
    visible() { return [...nodes.values()].map((node) => node.textContent + node.innerHTML).join('\n'); },
  };
}

function assertBlocked(ui) {
  for (const id of exportIds) assert.equal(ui.nodes.get(id).disabled, true, `${id} disabled`);
  const before = ui.downloads.length;
  // Do not let a disabled property mask a missing handler-level guard.
  for (const id of exportIds) ui.nodes.get(id).disabled = false;
  ui.clickBoth();
  for (const id of exportIds) ui.nodes.get(id).disabled = true;
  assert.equal(ui.downloads.length, before, 'direct dispatch cannot download an absent or stale report');
}

function assertFinished(ui, label) {
  assert.match(ui.nodes.get('scanStatus').textContent, /complete|finished/i);
  assert.match(ui.nodes.get('coverageRows').innerHTML, new RegExp(label));
  for (const id of exportIds) assert.equal(ui.nodes.get(id).disabled, false);
}

function assertPending(ui, previousLabel) {
  assert.match(ui.nodes.get('scanStatus').textContent, /pending|classifying|processing|scanning/i);
  if (previousLabel) assert.equal(ui.visible().includes(previousLabel), false, 'previous report is cleared immediately');
  assertBlocked(ui);
}

test('initial empty UI cannot export, even via direct handler dispatch', async () => {
  const ui = await mount();
  assertBlocked(ui);
});

for (const input of inputIds) {
  test(`${input}: pending selection discards previous report and restores exports only on completion`, async () => {
    const ui = await mount();
    await ui.select(input, [fixture('Previous').file]);
    assertFinished(ui, 'Previous');
    ui.clickBoth();
    assert.deepEqual(ui.downloads.map(({ format }) => format), ['json', 'html']);
    const next = fixture('Replacement', { delayed: true });
    const completion = ui.select(input, [next.file]);
    assertPending(ui, 'Previous');
    await next.started;
    next.finish();
    assert.equal((await completion).ok, true);
    assertFinished(ui, 'Replacement');
    ui.clickBoth();
    for (const { result } of ui.downloads.slice(2)) {
      assert.ok(result.coverage.some((row) => row.path.includes('Replacement')));
      assert.ok(result.coverage.every((row) => !row.path.includes('Previous')));
    }
  });
}

for (const olderInput of inputIds) {
  for (const newerInput of inputIds) {
    for (const olderFinishesFirst of [false, true]) {
      test(`${olderInput} -> ${newerInput}: only newest renders (older finishes ${olderFinishesFirst ? 'first' : 'last'})`, async () => {
        const ui = await mount();
        const older = fixture('Older', { delayed: true });
        const newer = fixture('Newest', { delayed: true });
        const oldCompletion = ui.select(olderInput, [older.file]);
        await older.started;
        const newCompletion = ui.select(newerInput, [newer.file]);
        await newer.started;
        assertPending(ui);
        if (olderFinishesFirst) {
          older.finish();
          await oldCompletion;
          assertPending(ui, 'Older');
        }
        newer.finish();
        await newCompletion;
        assertFinished(ui, 'Newest');
        const visible = ui.visible();
        if (!olderFinishesFirst) {
          older.finish();
          await oldCompletion;
        }
        assert.equal(ui.visible(), visible, 'older completion cannot change any result/status surface');
        ui.clickBoth();
        assert.equal(ui.downloads.length, 2);
        assert.ok(ui.downloads.every(({ result }) => result.coverage.every((row) => !row.path.includes('Older'))));
      });
    }
    test(`${olderInput} pending -> ${newerInput} clear cannot resurrect results`, async () => {
      const ui = await mount();
      await ui.select(olderInput, [fixture('Previous').file]);
      const older = fixture('Cleared', { delayed: true });
      const completion = ui.select(olderInput, [older.file]);
      await older.started;
      await ui.select(newerInput, []);
      assert.equal(ui.nodes.get('fileSummary').textContent, 'No files selected.');
      assert.equal(ui.nodes.get('scanStatus').textContent, 'No files selected.');
      assertBlocked(ui);
      const cleared = ui.visible();
      older.finish();
      await completion;
      assert.equal(ui.visible(), cleared);
      assertBlocked(ui);
      assert.equal(ui.visible().includes('Previous'), false);
    });
  }
}

for (const input of inputIds) {
  test(`${input}: unexpected classification rejection is handled with a static safe failure and can recover`, async () => {
    const gate = deferred();
    let rejectNext = false;
    const ui = await mount({ classify: (files) => rejectNext ? gate.promise : scanner.classifySelectedFiles(files) });
    await ui.select(input, [fixture('Previous').file]);
    rejectNext = true;
    const completion = ui.select(input, [fixture('Failed').file]);
    assertPending(ui, 'Previous');
    gate.reject(new Error('FICTIONAL_EXCEPTION_DETAIL <raw private diagnostic>'));
    assert.equal((await completion).ok, true, 'change handler consumes classification rejection');
    assert.equal(ui.nodes.get('scanStatus').textContent,
      'Unable to complete the local scan. No report is available. Select files again to retry.');
    assert.equal(ui.visible().includes('FICTIONAL_EXCEPTION_DETAIL'), false);
    assert.equal(ui.visible().includes('raw private diagnostic'), false);
    assert.equal(ui.messages.join(' ').includes('FICTIONAL_EXCEPTION_DETAIL'), false);
    assertBlocked(ui);
    rejectNext = false;
    await ui.select(input, [fixture('Recovered').file]);
    assertFinished(ui, 'Recovered');
  });
}

for (const input of inputIds) {
  test(`${input}: older success cannot replace a newer failed scan`, async () => {
    const older = fixture('Older', { delayed: true });
    let calls = 0;
    const ui = await mount({ classify: (files) => {
      if (++calls === 2) throw new Error('FICTIONAL_SYNCHRONOUS_FAILURE');
      return scanner.classifySelectedFiles(files);
    } });
    const oldCompletion = ui.select(input, [older.file]);
    await older.started;
    const otherInput = inputIds.find((id) => id !== input);
    assert.equal((await ui.select(otherInput, [fixture('Failed').file])).ok, true);
    assert.match(ui.nodes.get('scanStatus').textContent, /unable/i);
    assertBlocked(ui);
    const visible = ui.visible();
    older.finish();
    await oldCompletion;
    assert.equal(ui.visible(), visible);
    assertBlocked(ui);
  });
}

for (const finalState of ['pending', 'complete', 'cleared']) {
  test(`stale rejection cannot alter newer ${finalState} state`, async () => {
    const gate = deferred();
    let calls = 0;
    const ui = await mount({ classify: (files) => ++calls === 1 ? gate.promise : scanner.classifySelectedFiles(files) });
    const oldCompletion = ui.select('metadataFiles', [fixture('Older').file]);
    const next = fixture('Newest', { delayed: true });
    const newCompletion = ui.select('metadataFolder', [next.file]);
    await next.started;
    if (finalState === 'complete') {
      next.finish();
      await newCompletion;
      assertFinished(ui, 'Newest');
    } else if (finalState === 'cleared') {
      await ui.select('metadataFiles', []);
    }
    const visible = ui.visible();
    gate.reject(new Error('FICTIONAL_STALE_EXCEPTION'));
    assert.equal((await oldCompletion).ok, true);
    assert.equal(ui.visible(), visible);
    assert.equal(ui.messages.join(' ').includes('FICTIONAL_STALE_EXCEPTION'), false);
    if (finalState !== 'complete') assertBlocked(ui);
    next.finish();
    await newCompletion;
    if (finalState === 'cleared') {
      assert.equal(ui.visible(), visible);
      assertBlocked(ui);
    }
  });
}
