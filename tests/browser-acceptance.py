"""Optional real-Chromium acceptance; uses an existing Playwright installation only.
Run: python tests/browser-acceptance.py --output /tmp/browser-acceptance
No dependency installation, external requests, customer inputs or deployment.
"""
import argparse
import functools
import hashlib
import io
import json
from pathlib import Path
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import zipfile

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BLANK = '<ValidationRule><description/></ValidationRule>'
PRESENT = '<ValidationRule><description>Fictional documentation</description></ValidationRule>'


def zip_bytes(entries, compression=zipfile.ZIP_STORED):
    target = io.BytesIO()
    with zipfile.ZipFile(target, 'w', compression=compression) as archive:
        for name, text in entries:
            archive.writestr(name, text)
    return target.getvalue()


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        if path not in ('/', '/index.html') and not path.startswith(('/src/', '/docs/samples/')):
            self.send_error(404)
            return
        super().do_GET()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=None)
    args = parser.parse_args()
    out = (args.output or Path(tempfile.mkdtemp(prefix='browser-acceptance-'))).resolve()
    out.mkdir(parents=True, exist_ok=True)
    report = {'status': 'running', 'checks': [], 'requests': [], 'console_errors': [], 'page_errors': []}
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    unexpected = []
    try:
        with sync_playwright() as engine, tempfile.TemporaryDirectory(prefix='fictional-browser-inputs-') as temp:
            browser = engine.chromium.launch()
            report['browser'] = browser.version
            context = browser.new_context(accept_downloads=True, service_workers='block')
            page = context.new_page()
            page.on('pageerror', lambda error: report['page_errors'].append(str(error)))
            page.on('console', lambda message: report['console_errors'].append(message.text) if message.type == 'error' else None)

            def route_request(route):
                request = route.request
                entry = {'method': request.method, 'url': request.url, 'type': request.resource_type}
                report['requests'].append(entry)
                path = urlsplit(request.url).path
                allowed = request.url.startswith(origin + '/') and request.method == 'GET' and (path in ('/', '/index.html') or path.startswith('/src/'))
                if not allowed:
                    unexpected.append(entry)
                    route.abort()
                else:
                    route.continue_()

            context.route('**/*', route_request)
            page.add_init_script('''
                window.__boundaryCalls = [];
                const deny = name => function () { window.__boundaryCalls.push(name); throw new Error('Blocked boundary operation: ' + name); };
                for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker']) window[name] = deny(name);
                navigator.sendBeacon = deny('sendBeacon');
                Storage.prototype.setItem = deny('storage.setItem');
                if (window.IDBFactory) IDBFactory.prototype.open = deny('indexedDB.open');
                if (navigator.serviceWorker) navigator.serviceWorker.register = deny('serviceWorker.register');
                if (window.caches) caches.open = deny('caches.open');
            ''')
            page.goto(origin + '/', wait_until='networkidle')
            files = page.locator('#metadataFiles')
            folder = page.locator('#metadataFolder')
            json_button = page.locator('#downloadJson')
            html_button = page.locator('#downloadHtml')
            status = page.locator('#scanStatus')

            def checked(name):
                report['checks'].append(name)

            def select(name, content, expected_text=None):
                files.set_input_files({'name': name, 'mimeType': 'application/zip' if name.endswith('.zip') else 'application/xml', 'buffer': content.encode() if isinstance(content, str) else content})
                expect(status).to_contain_text('Scan complete.')
                if expected_text:
                    expect(page.locator('#coverageRows')).to_contain_text(expected_text)

            def download(button, suffix):
                with page.expect_download() as event:
                    button.click()
                item = event.value
                assert item.suggested_filename.endswith(suffix)
                assert item.failure() is None
                target = out / ('report' + suffix)
                item.save_as(target)
                return target.read_text()

            expect(json_button).to_be_disabled()
            expect(html_button).to_be_disabled()
            assert page.locator('form, iframe').count() == 0
            assert page.locator('#limitations-title').evaluate('(node) => !!(node.compareDocumentPosition(document.querySelector("#findings-title")) & Node.DOCUMENT_POSITION_FOLLOWING)')
            checked('initial export gating, no forms/iframes, limitations before findings')

            select('Fictional.validationRule-meta.xml', BLANK, 'blank description')
            expect(page.locator('#findingsRows .finding')).to_have_count(1)
            result = json.loads(download(json_button, '.json'))
            assert len(result['findings']) == 1
            assert result['manifest']['upload_model'] == 'no-server-upload'
            assert all(key in result for key in ['schema_version', 'tool_version', 'generated_at_local', 'processing_model', 'input_summary', 'rules_evaluated', 'limitations', 'coverage'])
            assert BLANK not in json.dumps(result)
            html = download(html_button, '.html')
            assert html.index('<h2>Scope and limitations</h2>') < html.index('<h2>Findings</h2>')
            assert '<ValidationRule>' not in html
            checked('native File selection, one finding, real JSON/HTML Blob downloads and report contract')

            for name, text, expected_status in [
                ('Documented.validationRule-meta.xml', PRESENT, 'nonblank direct description'),
                ('Malformed.validationRule-meta.xml', '<ValidationRule><description/></Wrong>', 'Malformed input'),
                ('Comment.validationRule-meta.xml', '<ValidationRule><!-- <description/> --></ValidationRule>', 'Not Assessed'),
            ]:
                select(name, text, expected_status)
                expect(page.locator('#findingsRows .finding')).to_have_count(0)
            checked('documented/malformed XML and comment-lookalike false-positive prevention')

            for compression, label in [(zipfile.ZIP_STORED, 'Stored'), (zipfile.ZIP_DEFLATED, 'Deflated')]:
                select(label + '.zip', zip_bytes([('objects/Account/validationRules/Fictional.validationRule-meta.xml', BLANK)], compression))
                expect(page.locator('#findingsRows .finding')).to_have_count(1)
            checked('real Chromium stored and deflate ZIP extraction')

            unsafe = zip_bytes([(name, BLANK) for name in ['../Fictional.validationRule-meta.xml', '/Fictional.validationRule-meta.xml', 'C:Folder/Fictional.validationRule-meta.xml', '\\Fictional.validationRule-meta.xml']])
            select('Unsafe.zip', unsafe, 'Rejected')
            expect(page.locator('#findingsRows .finding')).to_have_count(0)
            select('Corrupt.zip', b'not a zip', 'Malformed input')
            expect(page.locator('#findingsRows .finding')).to_have_count(0)
            checked('unsafe archive raw paths rejected and corrupt archive contained')

            folder_path = Path(temp) / 'FictionalFolder'
            folder_path.mkdir()
            (folder_path / 'FolderRule.validationRule-meta.xml').write_text(BLANK)
            folder.set_input_files(str(folder_path))
            expect(status).to_contain_text('Scan complete.')
            expect(page.locator('#findingsRows .finding')).to_have_count(1)
            expect(page.locator('#coverageRows')).to_contain_text('FictionalFolder/FolderRule.validationRule-meta.xml')
            checked('native directory selection and relative-path provenance')

            # Deterministic async gates alter only synthetic File reads, not app modules.
            page.evaluate('''() => {
                const read = File.prototype.text;
                window.__readStarted = false; window.__readFinished = false;
                File.prototype.text = function () {
                    if (!this.name.startsWith('Slow')) return read.call(this);
                    window.__readStarted = true;
                    return new Promise((resolve, reject) => { window.__releaseRead = async () => {
                        window.__readFinished = true;
                        if (this.name.startsWith('SlowReject')) reject(new Error('Fictional private diagnostic'));
                        else resolve(await read.call(this));
                    }; });
                };
            }''')
            for slow_name, clear in [('Slow.validationRule-meta.xml', False), ('SlowReject.validationRule-meta.xml', False), ('SlowClear.validationRule-meta.xml', True)]:
                page.evaluate('window.__readStarted = false; window.__readFinished = false')
                files.set_input_files({'name': slow_name, 'mimeType': 'application/xml', 'buffer': BLANK.encode()})
                page.wait_for_function('window.__readStarted')
                expect(status).to_contain_text('Processing local files.')
                expect(json_button).to_be_disabled()
                expect(html_button).to_be_disabled()
                expect(page.locator('#findingsRows .finding')).to_have_count(0)
                if clear:
                    # Playwright requires a directory path even for [] on webkitdirectory.
                    # Reset the native input, then dispatch its normal change event.
                    folder.evaluate("node => { node.value = ''; node.dispatchEvent(new Event('change', {bubbles:true})); }")
                    expect(status).to_contain_text('No files selected.')
                else:
                    select('Latest.validationRule-meta.xml', PRESENT)
                before = status.inner_text()
                page.evaluate('async () => { await window.__releaseRead(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); }')
                expect(status).to_have_text(before)
                expect(page.locator('#findingsRows .finding')).to_have_count(0)
                if clear:
                    expect(json_button).to_be_disabled()
            checked('pending exports blocked; newest result wins over late success/read error; cross-input clear stays empty')

            # Controlled top-level classifier exception with actual UI and scanner.
            page.evaluate('''() => {
                const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get;
                Object.defineProperty(File.prototype, 'size', {configurable: true, get() {
                    if (this.name === 'Failure.zip') throw new Error('Fictional private diagnostic');
                    return size.call(this);
                }});
            }''')
            files.set_input_files({'name': 'Failure.zip', 'mimeType': 'application/zip', 'buffer': b'fictional'})
            expect(status).to_contain_text('Unable to complete the local scan.')
            expect(json_button).to_be_disabled()
            expect(html_button).to_be_disabled()
            assert 'Fictional private diagnostic' not in page.locator('body').inner_text()
            select('Retry.validationRule-meta.xml', BLANK)
            expect(page.locator('#findingsRows .finding')).to_have_count(1)
            files.set_input_files([])
            select('Retry.validationRule-meta.xml', BLANK)
            checked('controlled classifier exception: static safe error, export blocking, recovery and reselection')

            report['privacy'] = page.evaluate('''async () => ({
                boundaryCalls: window.__boundaryCalls,
                localStorageKeys: Object.keys(localStorage), sessionStorageKeys: Object.keys(sessionStorage),
                indexedDatabases: indexedDB.databases ? await indexedDB.databases() : [],
                serviceWorkers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
                cacheKeys: window.caches ? await caches.keys() : [], cookies: document.cookie,
                remoteAssets: [...document.querySelectorAll('[src], link[href]')].map(n => n.src || n.href).filter(u => /^https?:/.test(u) && !u.startsWith(location.origin + '/'))
            })''')
            assert not any(report['privacy'].values()), report['privacy']
            assert not context.cookies()
            assert not unexpected, unexpected
            assert not report['page_errors'], report['page_errors']
            assert not report['console_errors'], report['console_errors']
            checked('no nonstatic/network API attempts, external assets, storage, cookies, service workers, caches or JS errors')
            page.screenshot(path=str(out / 'final-state.png'), full_page=True)
            report['runtime_sha256'] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT / 'index.html', *sorted((ROOT / 'src').glob('*.js'))]}
            report['limitations'] = ['Chromium only; no Firefox/WebKit installed.', 'Synthetic inputs only; not an org/schema or compliance assessment.', 'Controlled File API gates/exceptions supplement native input/download scenarios.', 'Independent review retains preexisting namespace-local-name matching, replacement UTF-8 decoding, and classification-vs-assessment reporting limitations.']
            report['status'] = 'passed'
            context.close()
            browser.close()
    except Exception as error:
        report['status'] = 'failed'
        report['failure'] = str(error)
        raise
    finally:
        server.shutdown()
        server.server_close()
        (out / 'acceptance.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'report': str(out / 'acceptance.json')}))


if __name__ == '__main__':
    main()
