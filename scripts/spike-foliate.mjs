import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts'); await fs.mkdir(artifacts, { recursive: true });
const epubPath = path.join(artifacts, 'foliate-sample.epub');
const epubFiles = {
  'mimetype': 'application/epub+zip',
  'META-INF/container.xml': '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  'OEBPS/content.opf': '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>文枢电子书样本</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
  'OEBPS/c1.xhtml': '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>文枢电子书样本</h1><p>这是用于foliate-js读取验证的中文章节。</p></body></html>'
};
const py = `import zipfile,sys
files=${JSON.stringify(epubFiles)}
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('mimetype',files['mimetype'],compress_type=zipfile.ZIP_STORED)
 for n,v in files.items():
  if n!='mimetype': z.writestr(n,v)
`;
const pyPath = path.join(artifacts, 'make-epub.py'); await fs.writeFile(pyPath, py); await execFileAsync('python', [pyPath, epubPath]);
const mobiPath = path.join(artifacts, 'sample.mobi');
let mobiDownloaded = false;
try { await execFileAsync('powershell', ['-NoProfile', '-Command', `Invoke-WebRequest -Uri 'https://www.gutenberg.org/cache/epub/1342/pg1342-images.mobi' -OutFile '${mobiPath}'`], { timeout: 120000 }); mobiDownloaded = (await fs.stat(mobiPath)).size > 1000; } catch {}
const htmlPath = path.join(artifacts, 'foliate-spike.html');
await fs.writeFile(htmlPath, `<!doctype html><meta charset="utf-8"><script type="module">import { makeBook } from '/node_modules/foliate-js/view.js'; window.openBook=async url=>{const book=await makeBook(url); const doc=await book.sections[0].createDocument(); return {metadata:book.metadata, sections:book.sections.length, text:doc.body?.textContent||doc.documentElement?.textContent||''};};</script>`);
const server = http.createServer(async (req,res)=>{ const p=path.resolve(root, `.${decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname)}`); if(!p.startsWith(root)){res.writeHead(403);return res.end()} try{const b=await fs.readFile(p);const type=p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/octet-stream';res.writeHead(200,{'content-type':type});res.end(b)}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const port=server.address().port; const browser=await chromium.launch({headless:true}); const page=await browser.newPage(); await page.goto(`http://127.0.0.1:${port}/artifacts/foliate-spike.html`); await page.waitForFunction(() => typeof window.openBook === 'function');
const result={spike:'foliate-js-ebook',package:'foliate-js@1.0.1',epub:{ok:false},mobi:{ok:false,downloaded:mobiDownloaded},errors:[]};
try{const epub=await page.evaluate(url=>window.openBook(url),`/artifacts/${path.basename(epubPath)}`); result.epub={ok:epub.sections===1 && epub.text.includes('中文章节'),sections:epub.sections,title:epub.metadata?.title,text:epub.text}}catch(e){result.errors.push(`EPUB: ${e}`)}
if(mobiDownloaded) try{const mobi=await page.evaluate(url=>window.openBook(url),`/artifacts/${path.basename(mobiPath)}`); result.mobi={ok:mobi.sections>0,sections:mobi.sections,title:mobi.metadata?.title,text:mobi.text.slice(0,200)}}catch(e){result.errors.push(`MOBI: ${e}`)} else result.errors.push('MOBI: public sample download failed; no claim made');
await browser.close();server.close(); result.ok=result.epub.ok && result.mobi.ok; await fs.writeFile(path.join(artifacts,'foliate-result.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2)); if(!result.ok)process.exitCode=1;
