# 髮型工作室預約系統（官方 LINE + Firebase）

架構跟得霖、派遣系統一樣：

| 部分 | 用什麼 |
|---|---|
| 客人預約頁、設計師後台 | Firebase Hosting（`https://<專案ID>.web.app/`） |
| 後端 API | Cloud Functions `api`（asia-east1） |
| 每晚 8 點提醒 | Cloud Functions `dailyReminder` |
| 資料 | Firestore；照片放 Cloud Storage |
| 自動部署 | GitHub Actions：推到 `main` → 測試 → 部署 |

## 功能

**客人（在 LINE 裡開啟）**：選服務 → 日期 → 時段 → 預約；查看／取消自己的預約；作品集、價目表、店家資訊。

**設計師後台**（`/admin.html`，密碼登入，30 天內不用再輸入）：確認／婉拒／完成預約、補登電話預約；客人資料與髮質備註；服務紀錄（配方、金額、照片）；作品集；服務項目；營業時間、公休日。

**LINE 通知**：客人在預約送出、被確認、被取消時收到通知，前一天晚上 8 點收到提醒；設計師在有新預約、客人取消時收到通知，每晚 8 點收到明天行程。

> 官方帳號免費方案每月推播則數有限，每筆預約大約用 3～4 則。客人多了可在設定勾選「自動成立」省掉確認通知。

## 上線設定

### 1. Firebase
1. https://console.firebase.google.com → 新增專案（Google Analytics 可關）
2. 升級 **Blaze** 方案（Cloud Functions、Storage 需要）
3. **Firestore Database** → 建立資料庫 → 位置 `asia-east1（台灣）` → 正式版模式
4. **Storage** → 開始使用 → 位置 `asia-east1` → 正式版模式

### 2. 部署用服務帳戶
https://console.cloud.google.com/iam-admin/serviceaccounts （先切到這個專案）→ 建立服務帳戶 `github-deploy`，角色：
- 編輯者
- Cloud Functions 管理員
- Secret Manager 管理員
- 服務帳戶使用者

建立後 → 金鑰 → 新增金鑰 → JSON，下載 .json 檔。

### 3. GitHub（Settings → Secrets and variables → Actions）

**Secrets**

| 名稱 | 內容 |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | 上一步 .json 檔的全文 |
| `ADMIN_PASSWORD` | 設計師後台密碼（建議英文＋數字） |
| `LINE_CHANNEL_ACCESS_TOKEN` | 官方帳號 Messaging API 的 Channel access token |

**Variables**

| 名稱 | 內容 |
|---|---|
| `LINE_LOGIN_CHANNEL_ID` | LINE Login 的 Channel ID |
| `LIFF_ID` | LIFF ID |
| `ADMIN_LINE_USER_ID` | 設計師自己的 LINE ID（`U` 開頭，上線後在預約頁「我的預約」最下面看得到） |

Actions → 「部署到 Firebase」→ Run workflow。完成後摘要會列出網址。

### 4. LINE
1. LINE Login channel → LIFF → Endpoint URL 改成 `https://<專案ID>.web.app/`
2. 官方帳號圖文選單：

| 按鈕 | 連結 |
|---|---|
| 線上預約 | `https://liff.line.me/<LIFF ID>` |
| 我的預約 | `https://liff.line.me/<LIFF ID>?page=mine` |
| 作品集 | `https://liff.line.me/<LIFF ID>?page=works` |
| 價目表 | `https://liff.line.me/<LIFF ID>?page=price` |

### 5. 開始使用
設計師打開 `https://<專案ID>.web.app/admin.html` 登入（第一次登入會放入預設價目），到「設定」填店名、地址、營業時間。

## 檔案

```
public/index.html, js/customer.js   客人預約頁（LIFF）
public/admin.html, js/admin.js      設計師後台
functions/index.js                  API、每晚提醒
functions/lib.js                    時段計算（有自動測試）
firestore.rules, storage.rules      資料只能經由後端讀寫
.github/workflows/deploy.yml        自動測試＋部署
```
