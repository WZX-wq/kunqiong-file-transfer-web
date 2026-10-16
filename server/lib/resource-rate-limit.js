import { clientAddress } from './request-security.js'
import { resourceCreateAttempts } from '../state.js'

const WINDOW_MS=5*60*1000
const LIMIT=60

// Count attempts before parsing multipart data; never trust a caller-supplied proxy IP.
export function limitResourceCreation(req,res,next) {
  if (req.method!=='POST' || !['/api/shares','/api/collections','/api/upload-sessions','/api/account/workspace/members'].includes(req.path)) return next()
  const now=Date.now()
  for (const [key,entry] of resourceCreateAttempts) if(now-entry.startedAt>=WINDOW_MS) resourceCreateAttempts.delete(key)
  const key=req.path+':'+clientAddress(req)
  let entry=resourceCreateAttempts.get(key)
  if(!entry){entry={startedAt:now,count:0};resourceCreateAttempts.set(key,entry)}
  if(entry.count>=LIMIT){res.setHeader('Retry-After',Math.max(1,Math.ceil((entry.startedAt+WINDOW_MS-now)/1000)));return res.status(429).json({message:'创建请求过于频繁，请稍后重试'})}
  entry.count++
  next()
}
