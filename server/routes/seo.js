// 站点级 SEO 的路由出口：robots.txt 与 sitemap.xml
//
// 这两个文件必须由服务端按「当前部署域名」生成，不能放进 public/ 静态托管：
// sitemap 里的 <loc> 与 robots 里的 Sitemap 指令都要求绝对地址，
// 写死域名会导致换个部署环境（测试服/正式服/私有化）就全部失效。
// 域名解析统一走 requestOrigin()，与页面 canonical 完全一致。

import { robotsTxt, sitemapXml } from '../services/seo.js'

export function registerSeoRoutes(app) {
  app.get('/robots.txt', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.type('text/plain').send(robotsTxt(req))
  })
  app.get('/sitemap.xml', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.type('application/xml').send(sitemapXml(req))
  })
}
