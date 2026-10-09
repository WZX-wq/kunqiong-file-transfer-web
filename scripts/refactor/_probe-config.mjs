// 供 verify-runtime.mjs 以子进程方式导入，用于覆盖 config.js 的环境分支
// 不加任何逻辑：只要 import 不抛错即视为通过
import {} from "../../server/config.js"
