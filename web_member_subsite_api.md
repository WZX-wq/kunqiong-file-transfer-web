# 子站「会员套餐（时长制）」接口说明

主站 **api-web** 提供：套餐列表、创建支付订单、查询订单支付结果。会员已改为**按子站隔离**：子站必须传 `subsite_name`，服务端仅返回该子站匹配到的会员状态；不匹配即无会员。会员业务不与主站 AI 工具 `tools_id` 鲲币扣费混用。

**生产基址**（`domain_bind` 指向 `toolsapi` 应用，**无** `/toolsapi` 路径前缀）：

- `https://api-web.kunqiongai.com/`

**支付回调**由主站处理（子站勿模拟），异步通知地址示例：

- 微信：`https://api-web.kunqiongai.com/pay_notify/wxpay`
- 支付宝：`https://api-web.kunqiongai.com/pay_notify/alipay`

会员订单在支付网关侧以商户单号 `out_trade_no` 与主站订单表一致，单号**固定前缀** `WM1`（例如 `WM1` + 日期 + 随机段）。

---

## 1. 统一响应

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | int | `1` 成功；`0` 业务失败；`401` 未登录等 |
| `msg` | string | 提示信息 |
| `time` | int | 服务端时间戳 |
| `data` | object \| null | 业务数据 |

**说明**：`BaseController::success` / `error` 约定如此；`code=1` 为成功。

---

## 2. 鉴权（必登录接口）与 `api-web-token` 获取

以下接口**必须**已登录。任选一种方式传递 **api-web 会话 UUID（api-web-token）**（**不要**用三段式 JWT 充当 Bearer 会话，网关侧 `Auth` 会忽略纯 JWT 形态，仅认 Token 表 UUID）：

| 方式 | 说明 |
|------|------|
| Query / Body | `token`、`kq_token` |
| Header | `token: <uuid>`，或 `Authorization: Bearer <uuid>`，或 `HTTP_TOKEN`（如网关转发） |
| Cookie | `api_web_token`、`kq_token`、`user_token` |

子站 H5/浏览器若与主站同域或 Cookie 可携带，可依赖 Cookie；纯后端调用建议 Header `token` 或 `Authorization: Bearer <uuid>`。

### 2.1 `api-web-token` 获取方式（推荐顺序）

1. **用户先在登录站完成登录**（如 `login.kunqiongai.com` 对接的统一登录流程）。  
2. 登录成功后，前端通常可从以下位置拿到 UUID token：  
   - Query 参数：`token` / `api_web_token` / `kq_token`  
   - Cookie：`api_web_token` / `kq_token` / `user_token`  
   - 本地存储（历史实现）：`localStorage.kq_token` 或 `localStorage.token`
3. 子站调用本文件接口时，把该 token 放到 Header `token`（最稳妥）。

### 2.2 token 有效性快速检查

调用 `POST /user/user_all_info`：

- 返回 `code=1`：token 可用
- 返回 `code=401`：token 失效或未登录，需重新登录获取新 token

未登录时通常返回 `code: 401`，`msg: 请先登录`。

---

## 3. 获取会员套餐与当前子站权益 `POST /user/get_web_member_package_info`

**Content-Type**：`application/x-www-form-urlencoded` 或 `multipart/form-data`（与项目其它 user 接口一致；若用 JSON 请先自测中间件/网关能解析到 `param`）。

**Body**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `subsite_name` | string | 否（强烈建议传） | 子站名（如 `ebook.kunqiongai.com` 或完整 URL）；用于按子站隔离会员状态。未传会按默认子站处理 |

**成功时 `data`**

| 字段 | 类型 | 说明 |
|------|------|------|
| `packages` | array | 后台启用的套餐列表，见下表 |
| `web_member_expire_at` | string \| null | 用户当前会员到期时间（`Y-m-d H:i:s`），无则 `null` |
| `web_member_active` | bool | 是否仍在有效期内（由 `web_member_expire_at` 计算） |
| `subsite_name` | string | 服务端归一化后的子站名 |

**`packages` 单项**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int | 套餐 ID，创建订单时传 `package_id` |
| `name` | string | 名称 |
| `description` | string | 描述 |
| `days` | int | 购买后顺延天数 |
| `price_yuan` | float | 售价（元） |
| `benefit_text` | string | 权益说明文案 |
| `cover_url` | string | 封面图 URL（可为空） |

### 3.1 会员状态显示规则（子站前端必须遵循）

- `web_member_active = true`：显示“会员有效”并放行会员权益功能。
- `web_member_active = false`：显示“当前子站未开通会员”。
- 到期时间展示使用 `web_member_expire_at`（仅当 `web_member_active=true` 时展示）。
- 会员判断必须带 `subsite_name` 调本接口，不要只看历史缓存或其他子站请求结果。

### 3.2 请求示例

```bash
curl -X POST "https://api-web.kunqiongai.com/user/get_web_member_package_info" \
  -H "token: 你的api-web-token(UUID)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "subsite_name=https://ebook.kunqiongai.com/"
```

---

## 4. 创建会员支付订单 `POST /user/create_web_member_order`

**Body 参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `package_id` | int | **是** | 套餐主键，须为启用状态 |
| `pay_type` | int | **是** | `1` 微信 NATIVE（扫码）<br>`2` 支付宝（PC 为表单跳转；WAP 为手机收银台） |
| `subsite_name` | string | **是** | 子站名（如 `ebook.kunqiongai.com` 或 `https://ebook.kunqiongai.com/`），会员按子站隔离 |

**成功时 `data`（公共）**

| 字段 | 类型 | 说明 |
|------|------|------|
| `order_no` | string | 主站订单号，前缀 `WM1` |
| `package_id` | int | 套餐 ID |
| `package_name` | string | 套餐名 |
| `package_days` | int | 本单包含天数 |
| `pay_amount` | float | 应付金额（元） |
| `pay_type` | int | 同请求 |
| `subsite_name` | string | 服务端归一化后的子站名 |

**`pay_type=1` 微信额外字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| `qrcode_img_url` | string | 二维码 `data:image/png;base64,...`，可直接作 `<img src="...">` |
| `code_url` | string | 微信 `code_url`，可自画二维码 |

**`pay_type=2` 支付宝额外字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| `alipaysubmit_html` | string | 自动提交表单的 HTML，**整段写入新窗口/iframe 或 `document.write`** 以拉起收银台；移动端为 WAP 地址流程 |

**常见错误**：套餐不存在/停用、参数校验失败、微信支付下单失败、二维码生成失败、支付宝下单失败等，返回 `code=0` 及 `msg` 说明。

### 4.1 请求示例

```bash
curl -X POST "https://api-web.kunqiongai.com/user/create_web_member_order" \
  -H "token: 你的api-web-token(UUID)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "package_id=1&pay_type=1&subsite_name=https://ebook.kunqiongai.com/"
```

---

## 5. 查询订单支付状态 `POST /user/check_web_member_order_paystatus`

仅允许查询**当前登录用户**本人订单。

**Body 参数**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `order_no` | string | **是** | 创建订单返回的 `order_no` |

**成功时 `data`**

| 字段 | 类型 | 说明 |
|------|------|------|
| `pay_status` | int | `0` 未支付；`1` 已支付 |
| `order_no` | string | 与请求一致 |
| `expire_at` | string \| null | 本单在支付成功回调中写入的**该笔订单**会员到期时间（`Y-m-d H:i:s`）；未支付可能为 `null` |

`msg`：已支付为「支付成功」，未支付为「还未支付」。支付成功后，用户总权益仍以 **`user.web_member_expire_at`** 为准（续费在剩余时间上顺延），可再次调「套餐信息」或用户信息接口刷新。

**轮询建议**：支付页每隔 1～2 秒查询，最多 1～2 分钟；**不要**依赖前端写本地已支付，必须以接口或用户信息中的到期字段为准。

### 5.1 请求示例

```bash
curl -X POST "https://api-web.kunqiongai.com/user/check_web_member_order_paystatus" \
  -H "token: 你的api-web-token(UUID)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "order_no=WM1xxxxxxxx"
```

---

## 6. 用户信息字段与子站会员关系（可选）

已登录时还可调（与其它业务共用）：

- `POST /user/user_info`  
- `POST /user/user_all_info`  

返回中若已接入，会包含：

| 字段 | 说明 |
|------|------|
| `web_member_expire_at` | 当前用户兼容展示到期时间（非子站精确态） |
| `web_member_active` | 当前实现中的通用会员态字段 |

子站**强烈推荐**：展示与鉴权优先使用 `get_web_member_package_info + subsite_name` 返回值作为唯一依据；与鲲币余额、`tools_id` 无关。

---

## 7. 联调检查清单（子站隔离）

1. 同一账号在 `ebook` 传 `subsite_name=ebook.kunqiongai.com` 调 `get_web_member_package_info`，确认可返回套餐。  
2. 在 `ebook` 成功支付一笔会员订单后，`check_web_member_order_paystatus` 返回 `pay_status=1`。  
3. 再次调 `get_web_member_package_info(subsite_name=ebook...)`，应 `web_member_active=true`。  
4. 调 `get_web_member_package_info(subsite_name=idphoto.kunqiongai.com)`，应 `web_member_active=false`（未在该子站开通）。  
5. 结论：子站隔离生效，不再全站共享会员。

---

## 8. 本次变更摘要（2026-04-28）

- `create_web_member_order`：新增必传 `subsite_name`，并记录到订单（用于隔离续期）。
- `get_web_member_package_info`：新增 `subsite_name` 入参支持，返回该子站精确会员状态。
- 支付回调续期：改为仅按同子站订单续期，避免跨子站串会员。
- 前端接入建议：统一在请求里传 `subsite_name=当前子站域名或URL`。

---

## 9. 变更说明

文档与接口随主站 `app/toolsapi/controller/user/WebMemberRecharge.php`、`app/common/service/WebMemberService.php` 实现；若路由或字段调整，以仓库最新代码为准。
