// Exercise real Office converters and sanitizer with disposable document mutations.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import XLSX from 'xlsx'
import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { sanitizeOfficeHtml } from '../src/office-html.js'

const root=path.resolve(import.meta.dirname,'..')
const dataRoot=path.join(root,'测试数据/鲲穹文件传输测试数据包')
const safe=path.join(dataRoot,'01-安全文件集')
const evidence=process.env.ACCEPTANCE_EVIDENCE_DIR
const fixture=path.resolve(process.argv[2]||'')
assert.ok(fixture.startsWith(path.join(os.tmpdir(),'kunqiong-browser-')),'Requires disposable browser fixture')
const window=new JSDOM('').window,purifier=createDOMPurify(window)
let passed=0
function check(label,condition){assert.ok(condition,label);passed++;console.log('PASS '+label)}
function inspect(html){const doc=new JSDOM(sanitizeOfficeHtml(html,purifier)).window.document;return{doc,unsafe:doc.querySelectorAll('script,iframe,form,input,[onerror],[onclick],a[href^="javascript:"],a[href^="data:text/html"]').length}}
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const png=fs.readFileSync(path.join(safe,'TC-03-04-图片预览-1x1.png'))
const zip=await JSZip.loadAsync(fs.readFileSync(path.join(safe,'TC-03-08-Office文档预览.docx')))
let xml=await zip.file('word/document.xml').async('string')
const attacks='<img src=x onerror=alert(1)><script>alert(1)</script>'
const paragraphs=`<w:p><w:r><w:t>${escape(attacks)}</w:t></w:r></w:p>`+
 ['javascript:alert(1)','data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;','https://example.com/'].map((_,i)=>`<w:p><w:hyperlink r:id="preview-link-${i}"><w:r><w:t>preview-link-${i}</w:t></w:r></w:hyperlink></w:p>`).join('')+
 '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="100" name="safe image"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="safe.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="preview-image"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
xml=xml.replace('<w:sectPr',paragraphs+'<w:sectPr');zip.file('word/document.xml',xml)
let rels=await zip.file('word/_rels/document.xml.rels').async('string')
rels=rels.replace('</Relationships>',['javascript:alert(1)','data:text/html,<script>alert(1)</script>','https://example.com/'].map((target,i)=>`<Relationship Id="preview-link-${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escape(target)}" TargetMode="External"/>`).join('')+'<Relationship Id="preview-image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/preview-safe.png"/></Relationships>')
zip.file('word/_rels/document.xml.rels',rels);zip.file('word/media/preview-safe.png',png)
const types=await zip.file('[Content_Types].xml').async('string')
if(!types.includes('Extension="png"'))zip.file('[Content_Types].xml',types.replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>'))
const docx=await zip.generateAsync({type:'nodebuffer'})
const converted=await mammoth.convertToHtml({buffer:docx})
check('DOCX真实转换器产生危险链接供过滤',converted.value.includes('javascript:')&&converted.value.includes('data:text/html'))
const doc=inspect(converted.value)
check('DOCX危险协议与活跃元素被移除',doc.unsafe===0)
check('DOCX安全中文表格、图片和文本保留',doc.doc.querySelector('table')?.textContent.includes('安全测试')&&doc.doc.querySelector('img[src^="data:image/png"]')&&doc.doc.body.textContent.includes(attacks)&&doc.doc.querySelector('a[href="https://example.com/"]'))
const workbook=XLSX.read(fs.readFileSync(path.join(safe,'TC-03-09-Excel表格预览.xlsx')),{type:'buffer'})
const sheet=XLSX.utils.aoa_to_sheet([['安全表格','值'],['脚本字符串',attacks],['危险链接','危险data链接'],['安全链接','安全内容']])
sheet.A3.l={Target:'javascript:alert(1)'};sheet.B3.l={Target:'data:text/html,<script>alert(1)</script>'};sheet.A4.l={Target:'https://example.com/'}
XLSX.utils.book_append_sheet(workbook,sheet,'安全输入')
const xlsx=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'})
const reread=XLSX.read(xlsx,{type:'buffer'})
const excel=inspect(XLSX.utils.sheet_to_html(reread.Sheets['安全输入'],{editable:false,header:'',footer:''}))
check('XLSX危险协议与事件没有进入DOM',excel.unsafe===0)
check('XLSX表格与HTML字面文本保留',excel.doc.querySelector('table')&&excel.doc.body.textContent.includes(attacks)&&excel.doc.body.textContent.includes('安全内容'))
const metadata=JSON.parse(fs.readFileSync(path.join(fixture,'storage/metadata.json'),'utf8'))
const session=metadata.sessions.find(s=>s.user.id==='browser-owner');assert.ok(session)
const htmlName=fs.readdirSync(path.join(dataRoot,'06-安全与异常输入')).find(n=>n.startsWith('TC-07-02-'))
const files=[{name:'验收安全输入.docx',bytes:docx},{name:'验收安全输入.xlsx',bytes:xlsx},{name:'验收危险HTML.html',bytes:fs.readFileSync(path.join(dataRoot,'06-安全与异常输入',htmlName))},{name:'验收安全图片.png',bytes:png}]
const form=new FormData();for(const file of files)form.append('files',new Blob([file.bytes]),file.name)
const response=await fetch('http://localhost:18045/api/shares',{method:'POST',headers:{cookie:'kunqiong_session='+session.id},body:form})
const payload=await response.json()
check('真实ClamAV扫描四类安全输入文件后发布',response.status===201&&payload.share.files.length===4&&payload.share.files.every(f=>f.scanEngine==='clamav'))
const result={passed,failures:[],shareId:payload.share.id,shareUrl:payload.share.shareUrl,files:files.map(f=>({name:f.name,size:f.bytes.length})),scanner:'real ClamAV localhost:3310'}
if(evidence)fs.writeFileSync(path.join(evidence,'preview-security-results.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2));window.close()
