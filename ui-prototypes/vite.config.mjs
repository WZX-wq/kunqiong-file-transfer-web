import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {variants} from './data.js'
const root=path.dirname(fileURLToPath(import.meta.url))
const input=[path.join(root,'index.html'),...Object.keys(variants).flatMap(v=>fs.readdirSync(path.join(root,v)).filter(n=>n.endsWith('.html')).map(n=>path.join(root,v,n)))]
export default defineConfig({root,plugins:[react()],server:{host:'127.0.0.1',port:4280,strictPort:true,fs:{allow:[path.dirname(root)]}},build:{outDir:'build',rollupOptions:{input}}})
