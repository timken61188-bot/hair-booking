# 髮型工作室預約系統（官方 LINE + GitHub Pages + Supabase）

給一人工作室的設計師使用：

| 客人（在 LINE 裡開啟） | 設計師後台（`admin.html`） |
|---|---|
| 選服務 → 日期 → 時段 → 送出預約 | 確認／婉拒／完成預約，可補登電話預約 |
| 查看、取消自己的預約 | 客人資料、髮質備註 |
| 作品集、價目表、店家資訊 | 服務紀錄：配方、金額、照片 |
| 前一天晚上收到 LINE 提醒 | 作品集上傳、服務項目、營業時間、公休日 |

**LINE 通知**
- 客人：預約送出／設計師確認／被取消時、前一天晚上 8 點提醒
- 設計師：有新預約、客人取消、每晚 8 點收到明天行程

> 官方帳號的免費方案每月推播則數有限，每筆預約大約會用到 3～4 則（通知客人、通知設計師、前一天提醒）。客人多了以後，可到 LINE Official Account Manager 查看用量，或在設定勾選「自動成立」省掉確認通知那一則。

---

## 一、LINE 設定

### 1. 開官方帳號
1. 到 [LINE Official Account Manager](https://manager.line.biz/) 建立官方帳號（例如「小美 Hair」）。
2. **設定 → Messaging API → 啟用 Messaging API**，建立一個 Provider（例如「小美 Hair」）。
3. **設定 → 回應設定**：開啟「聊天」，關掉「自動回應訊息」（客人回覆的訊息設計師才看得到）。

### 2. 取得 Channel access token
到 [LINE Developers Console](https://developers.line.biz/console/) → 剛剛的 Provider → 官方帳號那個 **Messaging API** channel → **Messaging API** 分頁 → 最下面 **Channel access token (long-lived)** 按 **Issue**，複製起來。

### 3. 建立 LINE Login + LIFF
1. 同一個 Provider 底下 **Create a new channel → LINE Login**，App types 勾 **Web app**。
2. **Basic settings** 分頁記下 **Channel ID**。
3. **Linked LINE Official Account** 選剛剛的官方帳號。
4. **LIFF** 分頁 → **Add**：
   - Size：**Full**
   - Endpoint URL：`https://<GitHub帳號>.github.io/<repo名稱>/`（第三段做完才會有，先填這個格式）
   - Scopes：勾 **openid**、**profile**
   - Bot link feature：**On (Aggressive)**（客人第一次打開時會請他加好友，才收得到提醒）
5. 記下 **LIFF ID**（長得像 `2001234567-AbCdEfGh`）。
6. Channel 最上方狀態從 **Developing** 按成 **Published**，否則只有你自己能登入。

> 官方帳號和 LINE Login 一定要在**同一個 Provider**，不然推播找不到客人。

---

## 二、Supabase 設定

1. 到 [supabase.com](https://supabase.com) 建立專案（Region 選 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**），**資料庫密碼記下來**。
2. **Project Settings → API** 記下：
   - Project URL（`https://xxxx.supabase.co`，`xxxx` 就是 project ref）
   - anon public key
3. 右上頭像 → **Account preferences → Access Tokens** → 產生一組 token，記下。
4. **Authentication → Users → Add user → Create new user**：輸入設計師的 Email、密碼，勾 **Auto Confirm User**。這就是後台登入帳號。
5. **Authentication → Sign In / Providers**：把 **Allow new users to sign up** 關掉（只有設計師能登入後台）。

---

## 三、GitHub 設定

把這個資料夾上傳成一個 GitHub repo，然後在 repo 的 **Settings**：

1. **Pages** → Source 選 **GitHub Actions**。
2. **Secrets and variables → Actions**

   **Variables** 分頁：

   | 名稱 | 內容 |
   |---|---|
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_ANON_KEY` | anon public key |
   | `SUPABASE_PROJECT_REF` | 網址裡的 `xxxx` |
   | `LIFF_ID` | LIFF ID |
   | `LINE_LOGIN_CHANNEL_ID` | LINE Login 的 Channel ID |
   | `ADMIN_LINE_USER_ID` | 設計師自己的 LINE ID（第四段第 3 步取得，先留空） |

   **Secrets** 分頁：

   | 名稱 | 內容 |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | Supabase Access Token |
   | `SUPABASE_DB_PASSWORD` | 資料庫密碼 |
   | `LINE_CHANNEL_ACCESS_TOKEN` | 官方帳號的 Channel access token |
   | `CRON_SECRET` | 自己亂打一串英數字（30 字以上），保護提醒功能 |

3. **Actions** 分頁：
   - 「部署後端（Supabase）」→ **Run workflow**（建立資料表、部署功能）
   - 「發布網頁（GitHub Pages）」→ **Run workflow**

   兩個都打勾後，網址是 `https://<GitHub帳號>.github.io/<repo名稱>/`。回 LINE Developers 確認 LIFF 的 Endpoint URL 是這個網址。

> 私人 repo 用 GitHub Pages 需要付費方案；用公開 repo 也沒關係，程式碼裡沒有密碼，客人資料都在 Supabase。
> 公開 repo 如果 60 天沒有任何更新，GitHub 會暫停「每晚預約提醒」，到 Actions 分頁按 **Enable workflow** 就會恢復。

---

## 四、開始使用

1. 設計師用手機打開 `https://<GitHub帳號>.github.io/<repo名稱>/admin.html` 登入，可以「加到主畫面」當 App 用。
   先到 **設定** 填店名、地址、營業時間；到 **服務** 調整價目；到 **作品集** 上傳照片。
2. 在 LINE 打開 `https://liff.line.me/<LIFF ID>`，確認看得到預約頁。
3. 切到「我的預約」，最下面會顯示你的 **LINE ID**（`U` 開頭）。把它填進 GitHub Variables 的 `ADMIN_LINE_USER_ID`，再跑一次「部署後端（Supabase）」，之後就會收到新預約通知和每晚行程。
4. **圖文選單**（LINE Official Account Manager → 圖文選單），建議 4 格：

   | 按鈕 | 連結 |
   |---|---|
   | 線上預約 | `https://liff.line.me/<LIFF ID>` |
   | 我的預約 | `https://liff.line.me/<LIFF ID>?page=mine` |
   | 作品集 | `https://liff.line.me/<LIFF ID>?page=works` |
   | 價目表 | `https://liff.line.me/<LIFF ID>?page=price` |

5. 測試提醒：Actions 分頁 →「每晚預約提醒」→ **Run workflow**，明天有預約的客人會收到提醒。

---

## 檔案說明

```
index.html / js/customer.js   客人預約頁（LIFF）
admin.html / js/admin.js      設計師後台
js/common.js, css/style.css   共用
supabase/migrations/          資料表
supabase/functions/api        預約、取消、通知（驗證 LINE 身分）
supabase/functions/reminders  每晚提醒
.github/workflows/            自動部署與每晚提醒
```
