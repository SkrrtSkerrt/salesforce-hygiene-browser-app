"""Real-browser acceptance against local files or an unchanged public static deployment.
Run: python tests/browser-acceptance.py --browser firefox --mobile
Synthetic inputs only; no uploads, application substitution, or deployment.
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
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode, unquote
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
    parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
    parser.add_argument('--mobile', action='store_true', help='390x844 touch viewport (not device emulation)')
    parser.add_argument('--base-url', help='Static deployment root, with or without trailing slash')
    parser.add_argument('--cache-key', default=None, help='Cache-bust every allowed static GET')
    args = parser.parse_args()
    out = (args.output or Path('/tmp/browser-hardening-matrix') / f'{args.browser}-{"mobile" if args.mobile else "desktop"}').resolve()
    out.mkdir(parents=True, exist_ok=True)
    viewport = {'width': 390, 'height': 844} if args.mobile else {'width': 1280, 'height': 900}
    report = {'status': 'running', 'engine': args.browser, 'viewport': viewport, 'mobile_size': args.mobile,
              'checks': [], 'requests': [], 'console_errors': [], 'page_errors': [], 'unsupported': [], 'downloads': []}
    server = None
    if args.base_url:
        parsed = urlsplit(args.base_url)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password:
            parser.error('--base-url must be an HTTP(S) static deployment root without credentials')
        base = urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip('/') + '/', '', ''))
    else:
        server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}/'
    origin = urlsplit(base)
    report['base_url'] = base
    report['cache_key'] = args.cache_key
    unexpected = []
    page = None
    try:
        with sync_playwright() as engine, tempfile.TemporaryDirectory(prefix='fictional-browser-inputs-') as temp:
            browser = getattr(engine, args.browser).launch()
            report['browser'] = browser.version
            report['executable'] = getattr(engine, args.browser).executable_path
            context = browser.new_context(accept_downloads=True, service_workers='block', viewport=viewport, has_touch=args.mobile)
            context.set_default_timeout(10000)
            page = context.new_page()
            page.on('pageerror', lambda error: report['page_errors'].append(str(error)))
            page.on('console', lambda message: report['console_errors'].append(message.text) if message.type == 'error' else None)

            def route_request(route):
                request = route.request
                entry = {'method': request.method, 'url': request.url, 'type': request.resource_type}
                report['requests'].append(entry)
                parsed = urlsplit(request.url)
                relative = unquote(parsed.path[len(origin.path):]) if parsed.path.startswith(origin.path) else None
                allowed = (parsed.scheme == origin.scheme and parsed.netloc == origin.netloc
                           and request.method == 'GET' and relative is not None
                           and '..' not in relative.split('/') and '\\' not in relative
                           and (relative in ('', 'index.html') or (relative.startswith('src/') and relative.endswith('.js'))
                                or relative.startswith('docs/samples/')))
                entry['allowed'] = allowed
                if not allowed:
                    unexpected.append(entry)
                    route.abort()
                else:
                    if args.cache_key:
                        query = [(key, value) for key, value in parse_qsl(parsed.query) if key != 'acceptance_cache']
                        query.append(('acceptance_cache', args.cache_key))
                        transport = urlunsplit(parsed._replace(query=urlencode(query)))
                        entry['transport_url'] = transport
                        route.continue_(url=transport)
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
            page.goto(base, wait_until='networkidle')
            files = page.locator('#metadataFiles')
            folder = page.locator('#metadataFolder')
            json_button = page.locator('#downloadJson')
            html_button = page.locator('#downloadHtml')
            status = page.locator('#scanStatus')

            def checked(name):
                report['checks'].append(name)
                report['privacy_last_completed_group'] = page.evaluate('''() => ({boundaryCalls: window.__boundaryCalls,
                    localStorageKeys: Object.keys(localStorage), sessionStorageKeys: Object.keys(sessionStorage), cookies: document.cookie})''')

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
                target = out / (f'report-{len(report["downloads"]) + 1}' + suffix)
                item.save_as(target)
                report['downloads'].append({'path': str(target), 'suggested_filename': item.suggested_filename,
                                            'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
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
            assert result['rules_evaluated'] == [result['findings'][0]['rule_id']]
            assert result['manifest']['upload_model'] == 'no-server-upload'
            assert all(key in result for key in ['schema_version', 'tool_version', 'generated_at_local', 'processing_model', 'input_summary', 'rules_evaluated', 'limitations', 'coverage'])
            assert BLANK not in json.dumps(result)
            html = download(html_button, '.html')
            assert html.index('<h2>Scope and limitations</h2>') < html.index('<h2>Findings</h2>')
            assert '<ValidationRule>' not in html
            checked('native File selection, one finding, real JSON/HTML Blob downloads and report contract')

            def check_layout(label):
                geometry = page.evaluate('''() => ({width: innerWidth, documentWidth: document.documentElement.scrollWidth,
                    coverageWidth: document.querySelector('#coverageRows').clientWidth,
                    coverageScrollWidth: document.querySelector('#coverageRows').scrollWidth})''')
                report.setdefault('layout', {})[label] = geometry
                page.screenshot(path=str(out / (label + '.png')), full_page=True)
                assert geometry['documentWidth'] <= geometry['width'] + 1, geometry
                for selector in ['#metadataFiles', '#metadataFolder', '#downloadJson', '#downloadHtml',
                                 '#limitations-title', '#findings-title', '#coverage-title']:
                    control = page.locator(selector)
                    control.scroll_into_view_if_needed()
                    expect(control).to_be_visible()
                    box = control.bounding_box()
                    assert box and box['width'] > 0 and box['height'] > 0 and box['x'] >= 0 and box['x'] + box['width'] <= viewport['width'] + 1, (selector, box)
                    if args.mobile and selector in ['#metadataFiles', '#metadataFolder', '#downloadJson', '#downloadHtml']:
                        assert box['height'] >= 43.5, (selector, box)  # Fractional layout rounding differs by engine.
                if geometry['coverageScrollWidth'] > geometry['coverageWidth']:
                    scrolled = page.locator('#coverageRows').evaluate('node => { node.scrollLeft = node.scrollWidth; const moved = node.scrollLeft; node.scrollLeft = 0; return moved; }')
                    assert scrolled > 0, 'Coverage columns must remain horizontally reachable'
                for control in [json_button, html_button]:
                    expect(control).to_be_enabled()

            check_layout('finding-layout')
            checked('document fits viewport; native inputs, export controls, findings/limitations/coverage usable')

            for name, text, expected_status in [
                ('Documented.validationRule-meta.xml', PRESENT, 'nonblank direct description'),
                ('Malformed.validationRule-meta.xml', '<ValidationRule><description/></Wrong>', 'Malformed input'),
                ('Comment.validationRule-meta.xml', '<ValidationRule><!-- <description/> --></ValidationRule>', 'Not Assessed'),
            ]:
                select(name, text, expected_status)
                expect(page.locator('#findingsRows .finding')).to_have_count(0)
            checked('documented/malformed XML and comment-lookalike false-positive prevention')

            for name, content in [
                ('InvalidUtf8.validationRule-meta.xml', b'<ValidationRule><description>\xff</description></ValidationRule>'),
                ('Foreign.validationRule-meta.xml', '<ValidationRule xmlns="urn:fictional:foreign"><description/></ValidationRule>'),
                ('ForeignChild.validationRule-meta.xml', '<ValidationRule><description xmlns="urn:fictional:foreign"/></ValidationRule>'),
            ]:
                select(name, content)
                expect(page.locator('#findingsRows .finding')).to_have_count(0)
                invalid_result = json.loads(download(json_button, '.json'))
                assert invalid_result['rules_evaluated'] == sorted({row['rule_id'] for row in invalid_result['coverage'] if row['rule_id']})
                if name.startswith('InvalidUtf8'):
                    assert invalid_result['rules_evaluated'] == []
                else:
                    assert invalid_result['rules_evaluated'] == result['rules_evaluated']
                assert any(row['status'] in ('Malformed input', 'Not Assessed', 'Rejected') for row in invalid_result['coverage'])
            select('Unsupported.txt', 'Fictional non-metadata text')
            assert json.loads(download(json_button, '.json'))['rules_evaluated'] == []
            checked('invalid UTF-8 and foreign namespaces have no findings; rules_evaluated reflects actual rule attempts')

            for compression, label in [(zipfile.ZIP_STORED, 'Stored'), (zipfile.ZIP_DEFLATED, 'Deflated')]:
                select(label + '.zip', zip_bytes([('objects/Account/validationRules/Fictional.validationRule-meta.xml', BLANK)], compression))
                expect(page.locator('#findingsRows .finding')).to_have_count(1)
            checked('native stored and deflate ZIP extraction')

            unsafe = zip_bytes([(name, BLANK) for name in ['../Fictional.validationRule-meta.xml', '/Fictional.validationRule-meta.xml', 'C:Folder/Fictional.validationRule-meta.xml', '\\Fictional.validationRule-meta.xml']])
            select('Unsafe.zip', unsafe, 'Rejected')
            expect(page.locator('#findingsRows .finding')).to_have_count(0)
            select('Corrupt.zip', b'not a zip', 'Malformed input')
            expect(page.locator('#findingsRows .finding')).to_have_count(0)
            checked('unsafe archive raw paths rejected and corrupt archive contained')

            folder_path = Path(temp) / 'FictionalFolder'
            folder_path.mkdir()
            (folder_path / 'FolderRule.validationRule-meta.xml').write_text(BLANK)
            if folder.evaluate("node => 'webkitdirectory' in node"):
                folder.set_input_files(str(folder_path))
                expect(status).to_contain_text('Scan complete.')
                expect(page.locator('#findingsRows .finding')).to_have_count(1)
                expect(page.locator('#coverageRows')).to_contain_text('FictionalFolder/FolderRule.validationRule-meta.xml')
                checked('native directory selection and relative-path provenance')
            else:
                report['unsupported'].append('Native directory input unsupported by this engine; not passed or simulated')

            # Deterministic async gates alter only synthetic File reads, not app modules.
            page.evaluate('''() => {
                const read = File.prototype.arrayBuffer;
                window.__readStarted = false; window.__readFinished = false;
                File.prototype.arrayBuffer = function () {
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
            check_layout('final-layout')
            if not args.base_url:
                report['runtime_sha256'] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT / 'index.html', *sorted((ROOT / 'src').glob('*.js'))]}
            report['limitations'] = ['Only the recorded engine/version and viewport were tested.', 'Synthetic inputs only; not an org/schema or compliance assessment.', 'Controlled File.arrayBuffer gates/exceptions supplement native input/download scenarios.', 'Public transport runs test deployed bytes, not local source hashes.']
            report['status'] = 'passed'
            context.close()
            browser.close()
    except Exception as error:
        report['status'] = 'failed'
        report['failure'] = str(error)
        # Preserve boundary evidence even when a regression stops a group early.
        try:
            if page is not None and not page.is_closed():
                report['privacy_at_failure'] = page.evaluate('''() => ({boundaryCalls: window.__boundaryCalls,
                    localStorageKeys: Object.keys(localStorage), sessionStorageKeys: Object.keys(sessionStorage), cookies: document.cookie})''')
                page.screenshot(path=str(out / 'failure-state.png'), full_page=True)
        except Exception as evidence_error:
            report['failure_evidence_error'] = str(evidence_error)
        raise
    finally:
        if server:
            server.shutdown()
            server.server_close()
        (out / 'acceptance.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'report': str(out / 'acceptance.json')}))


if __name__ == '__main__':
    main()
