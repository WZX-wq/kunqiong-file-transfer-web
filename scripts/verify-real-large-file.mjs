// Optional local integration: actual boundary data + real ClamAV; synthetic browser fixture only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
const root=path.resolve(import.meta.dirname,'..'),fixture=path.resolve(process.argv[2]||'')
assert.ok(fixture.startsWith(path.join(os.tmpdir(),'kunqiong-browser-')),'Requires disposable browser fixture')
const metadata=()=>JSON.parse(fs.readFileSync(path.join(fixture,'storage/metadata.json'),'utf8'))
const session=metadata().sessions.find(s=>s.user.id==='browser-owner')
assert.ok(session,'Sign into the synthetic browser fixture first')
const base='http://localhost:18045',headers={connection:'close',cookie:'kunqiong_session='+session.id}
const file=path.join(root,'测试数据/鲲穹文件传输测试数据包/02-边界大小文件/TC-04-02-单文件大小边界-5GB.bin'),size=fs.statSync(file).size,chunkSize=8*1024**2
assert.equal(size,5*1024**3,'Use real 5GB boundary data, not a placeholder')
let passed=0,failures=[]
function check(label,value){if(value){passed++;console.log('PASS '+label)}else{failures.push(label);console.log('FAIL '+label)}}
async function api(url,body){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{...headers,...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()}}
let existing
if(process.argv.includes('--resume'))for(const name of fs.readdirSync(path.join(fixture,'storage/tmp/upload-sessions'))){const manifest=JSON.parse(fs.readFileSync(path.join(fixture,'storage/tmp/upload-sessions',name,'session.json'),'utf8'));if(manifest.files?.[0]?.size===size&&manifest.ownerUserId==='browser-owner')existing=manifest.id}
const created=existing?{status:201,data:{sessionId:existing}}:await api('/api/upload-sessions',{files:[{name:path.basename(file),size,mimeType:'application/octet-stream'}],chunkSize})
check('真实5GB会话创建/恢复',created.status===201)
const uploaded=new Set(existing?(await api('/api/upload-sessions/'+existing)).data.files[0].uploadedChunks:[])
const id=created.data.sessionId,total=Math.ceil(size/chunkSize),hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),started=Date.now()
try{for(let index=0;index<total;index++){
 const bytes=Buffer.allocUnsafe(Math.min(chunkSize,size-index*chunkSize));assert.equal(fs.readSync(fd,bytes,0,bytes.length,index*chunkSize),bytes.length);hash.update(bytes)
 const form=new FormData();form.append('fileIndex','0');form.append('chunkIndex',String(index));form.append('totalChunks',String(total));form.append('chunkHash',crypto.createHash('sha256').update(bytes).digest('hex'));form.append('chunk',new Blob([bytes]),'chunk')
 if(!uploaded.has(index)){const r=await api('/api/upload-sessions/'+id+'/chunks',form);assert.equal(r.status,200,JSON.stringify(r.data))}
 if(index===2){const progress=await api('/api/upload-sessions/'+id);check('中断后重新查询进度',progress.status===200&&progress.data.files[0].uploadedChunks.length>=3)}
 if((index+1)%64===0)console.log('5GB uploaded '+(index+1)+'/'+total+' chunks')
}}finally{fs.closeSync(fd)}
const originalHash=hash.digest('hex');console.log('5GB upload complete; scanning with real ClamAV')
const complete=await api('/api/upload-sessions/'+id+'/complete',{})
check('真实ClamAV通过5GB文件',complete.status===201&&complete.data.share.files[0].scanEngine==='clamav'&&complete.data.share.files[0].reviewStatus==='approved')
let share=complete.data.share
if(share){
const url=base+'/api/shares/'+share.id+'/files/0/download',first=await fetch(url,{headers:{...headers,range:'bytes=0-8388607'}}),downloadHash=crypto.createHash('sha256');let received=0
check('大文件首段206',first.status===206)
for await(const b of first.body){downloadHash.update(b);received+=b.length}
const resumed=await fetch(url,{headers:{...headers,range:'bytes='+received+'-'}})
check('5GB Range断点恢复',resumed.status===206&&resumed.headers.get('content-range')==='bytes '+received+'-'+(size-1)+'/'+size)
for await(const b of resumed.body){downloadHash.update(b);received+=b.length}
check('最终5GB字节数与SHA256一致',received===size&&downloadHash.digest('hex')===originalHash)
}else {
 const progress=await api('/api/upload-sessions/'+id);check('扫描受限后全部分片保留可恢复',progress.status===200&&progress.data.files[0].uploadedChunks.length===total);
 const storedHash=crypto.createHash('sha256');for await(const b of fs.createReadStream(path.join(fixture,'storage/tmp/upload-sessions',id,'0.target')))storedHash.update(b);check('扫描受限后5GB磁盘文件哈希完整',storedHash.digest('hex')===originalHash);
}
const dataRoot=path.join(root,'测试数据/鲲穹文件传输测试数据包/06-安全与异常输入'),danger=fs.readdirSync(dataRoot).find(n=>n.startsWith('TC-07-01-'))
const form=new FormData();form.append('files',new Blob([fs.readFileSync(path.join(dataRoot,danger))]),danger)
const harmless=await api('/api/shares',form)
check('无害标记在真实ClamAV中按普通文本放行',harmless.status===201)
const threat=new FormData();threat.append('files',new Blob(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*']),'eicar-fixture.txt')
const before=metadata().shares.length,rejected=await api('/api/shares',threat)
check('真实ClamAV拦截EICAR且不发布',rejected.status===415&&metadata().shares.length===before)
const result={passed,failures,scanResponse:{status:complete.status,message:complete.data.message,code:complete.data.code},bytes:size,sha256:originalHash,durationMs:Date.now()-started,scanner:'real ClamAV localhost:3310',fixture,shareId:share?.id}
if(process.env.ACCEPTANCE_EVIDENCE_DIR){fs.mkdirSync(process.env.ACCEPTANCE_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.ACCEPTANCE_EVIDENCE_DIR,'real-large-file-results.json'),JSON.stringify(result,null,2))}
console.log(JSON.stringify(result,null,2));process.exitCode=failures.length?1:0
