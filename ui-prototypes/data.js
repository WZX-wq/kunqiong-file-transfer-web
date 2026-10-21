export const variants = {
  a: {name:'居中工作台', en:'CENTERED WORKSPACE', desc:'把上传动作放在页面中心，让文件交付一眼可见', detail:'白色画布 · 钴蓝操作 · 居中上传工作区', number:'01'},
  b: {name:'石墨任务台', en:'GRAPHITE TASKBOARD', desc:'以深色控制台呈现任务状态、记录和运营数据', detail:'石墨底色 · 冰青状态 · 高密度工作面板', number:'02'},
  c: {name:'松绿编辑页', en:'PINE EDITORIAL', desc:'用宽版排版和纵向信息节奏呈现文件内容', detail:'清亮纸白 · 松绿重点 · 编辑式纵向版面', number:'03'},
  d: {name:'工业交付面板', en:'INDUSTRIAL DELIVERY', desc:'用清晰分区和硬朗网格组织交付与管理操作', detail:'冷白灰底 · 墨黑结构 · 信号橙强调', number:'04'},
}
// Pages and explicit review states, traced to the current React components.
export const groups = [
  {name:'文件发送与提取', source:'src/pages/workspace.jsx · src/pages/public.jsx', pages:[
    ['send','发送文件','/'], ['send-files','待发送文件','/ · SendView'], ['send-settings','分享设置','/ · SettingsModal'],
    ['send-uploading','上传进度','/ · UploadProgressPanel'], ['send-scan','文件安全检查','/ · SecurityCheckStatus'], ['send-failed','上传失败与重试','/ · SecurityCheckFailure'],
    ['send-result','发送成功','/ · ShareResult'], ['send-result-qr','分享二维码','/ · QrPreviewModal'],
    ['retrieve','输入取件码','/ · RetrieveModal'], ['retrieve-found','取件结果','/ · RetrieveModal'],
    ['share','接收分享文件','/share/:token'], ['share-locked','密码提取','/share/:token · locked'], ['share-unavailable','分享失效','/share/:token · error'],
    ['share-manage','管理分享','/share/manage/:token'], ['file-preview','文件预览','FilePreviewModal'], ['guest-quota','游客额度提醒','GuestQuotaModal'],
  ]},
  {name:'文件收集', source:'src/pages/workspace.jsx · src/pages/public.jsx', pages:[
    ['collect','创建收集任务','/?view=collect'], ['collect-result','收集任务已创建','CollectionSuccess'], ['collect-qr','收集二维码','QrPreviewModal'],
    ['collect-manage','收集管理','/collect/manage/:token'], ['collect-settings','收集设置','ManageItemModal'],
    ['collect-submit','登录提交文件','/collect/:token'], ['collect-submit-anon','匿名提交文件','/collect/:token · anonymous'],
    ['collect-submitted','提交成功','/collect/:token · success'], ['collect-closed','收集已截止','/collect/:token · closed'],
  ]},
  {name:'记录与消息', source:'src/pages/records.jsx · MessageCenter', pages:[
    ['records','收发记录','/?view=records'], ['files','文件管理','RecordsView · files'], ['messages','消息中心','MessageCenter'],
  ]},
  {name:'会员与团队', source:'src/pages/workspace-page.jsx · src/pages/team.jsx · src/pages/public.jsx', pages:[
    ['workspace','会员与团队空间','/workspace'], ['plans','套餐对比','UpgradeModal'], ['plan-pay','订单支付','UpgradeModal · pending_payment'], ['plan-paid','支付成功','UpgradeModal · paid'],
    ['team','成员观察','/team'], ['team-resources','团队资源','/team?tab=resources'], ['team-members','团队成员','TeamPage · manage'],
    ['team-requests','入团申请','TeamPage · requests'], ['team-member','成员权限操作','TeamPage · member actions'], ['invite','团队邀请','/e/:slug'],
  ]},
  {name:'账户设置', source:'src/pages/settings.jsx · src/pages/orders.jsx · AuthButton', pages:[
    ['settings-profile','个人资料','/settings/profile'], ['settings-security','账号与安全','/settings/security'], ['settings-bind','账号绑定','AccountBindModal'],
    ['settings-notice','消息通知','/settings/notice'], ['settings-cleanup','文件清理','/settings/cleanup'], ['settings-orders','我的订单','/settings/orders'],
    ['order-detail','订单详情','OrderDetail'], ['login','统一账号登录入口','/api/auth/login'],
  ]},
  {name:'运营后台', source:'src/pages/AdminPage.jsx', pages:[
    ['admin-login','管理员登录','/admin · AdminLoginModal'], ['admin-dashboard','数据看板','/admin · dashboard'],
    ['admin-resources','资源管理','/admin · resources'], ['admin-users','用户管理','/admin · users'], ['admin-logs','安全日志','/admin · security'], ['admin-config','系统配置','/admin · config'],
  ]},
  {name:'帮助与规则', source:'src/lib/constants.js · FOOTER_CONTENT', pages:[
    ['help','帮助中心','ContentModal · help'], ['terms','服务协议','ContentModal · terms'], ['privacy','隐私政策','ContentModal · privacy'],
    ['email','文件分享通知','email-templates · preview'],
  ]},
]
export const pages = groups.flatMap(g=>g.pages.map(([id,title,route])=>({id,title,route,group:g.name,source:g.source})))
export const sampleFiles = [
  {id:'f1',name:'品牌视觉规范.pdf', size:'8.4 MB',type:'PDF', bytes:8808038},
  {id:'f2',name:'产品演示视频.mp4', size:'128.6 MB',type:'MP4',bytes:134846874},
  {id:'f3',name:'交付素材.zip', size:'48.2 MB',type:'ZIP',bytes:50541363},
]
export const sampleRecords = [
  {id:1,name:'品牌视觉规范与交付素材', count:3,size:'185.2 MB',date:'2026-10-19 10:32',end:'2026-10-22',status:'有效',type:'发送',scope:'我发送的'},
  {id:2,name:'十月项目资料收集',count:12,size:'264.8 MB',date:'2026-10-18 16:20',end:'2026-10-29',status:'进行中',type:'收集',scope:'我收集的'},
  {id:3,name:'产品需求文档 v2.docx',count:1,size:'2.6 MB',date:'2026-10-18 14:05',end:'2026-10-21',status:'有效',type:'接收',scope:'发给我的'},
  {id:4,name:'首页设计稿.fig',count:1,size:'36.2 MB',date:'2026-10-17 11:45',end:'2026-10-20',status:'即将过期',type:'发送',scope:'我发送的'},
  {id:5,name:'项目周报',count:2,size:'5.8 MB',date:'2026-10-16 09:10',end:'2026-10-19',status:'已截止',type:'收集',scope:'向我收集的'},
  {id:6,name:'历史交付文件.zip',count:1,size:'72.4 MB',date:'2026-10-12 15:30',end:'2026-10-15',status:'已过期',type:'发送',scope:'我发送的'},
]
export const plans = [
  {id:'free',label:'基础版',desc:'个人临时传输',price:0,days:'免费使用',space:'20 GB',team:'—',single:'2 GB',people:'10 人',tasks:'1 个'},
  {id:'member',label:'月卡会员',desc:'个人会员空间',price:19,days:'30 天',space:'100 GB',team:'—',single:'5 GB',people:'50 人',tasks:'5 个'},
  {id:'team',label:'团队季卡',desc:'小团队协作',price:49,days:'90 天',space:'500 GB',team:'200 GB',single:'10 GB',people:'100 人',tasks:'20 个'},
  {id:'halfyear',label:'半年卡',desc:'长期团队协作',price:79,days:'180 天',space:'1 TB',team:'500 GB',single:'15 GB',people:'300 人',tasks:'50 个'},
  {id:'year',label:'年卡',desc:'全年团队协作',price:129,days:'365 天',space:'1 TB',team:'500 GB',single:'20 GB',people:'500 人',tasks:'100 个'},
]
export const teamMembers = [
 {id:1,name:'林川',email:'lin@example.com',role:'拥有者',space:'32.4 GB',percent:16.2,files:42},
 {id:2,name:'陈晓',email:'chen@example.com',role:'管理员',space:'12.8 GB',percent:6.4,files:24},
 {id:3,name:'周宁',email:'zhou@example.com',role:'成员',space:'8.6 GB',percent:4.3,files:16},
 {id:4,name:'李悦',email:'li@example.com',role:'成员',space:'4.6 GB',percent:2.3,files:8},
]
