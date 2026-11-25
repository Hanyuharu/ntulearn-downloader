# NTULearn 课件下载器 / NTULearn Downloader (Chrome / Edge Extension)

[中文说明](#中文说明) | [English](#english)

---

<a id="中文说明"></a>

## 中文说明

一个基于 Manifest V3 的浏览器扩展，用于一键扫描并批量下载 NTULearn（Blackboard Learn Ultra）课程中的课件文件、图文页面笔记（`_notes.html`）与非视频外链清单（`_links.txt`），自动按课程代码和网页目录顺序归档到浏览器默认下载目录。

### 主要功能

- **复用浏览器登录态**：无需填写账号密码或手动抓包 Cookie，直接复用你在浏览器中登录 NTULearn（含微软 SSO / MFA）后的有效会话。
- **还原网页目录结构**：按精简课程代码（如 `25S1-CS1001-LEC`）和网页目录层级与顺序编号（`01_Course Materials/...`）自动归档，编号前缀可随时开关。
- **智能内容提取**：
  - 自动下载 PDF / PPT / Word / ZIP 等各类课件、内嵌文件与作业区附件。
  - Ultra Document 图文页面智能去套娃：单文件且无正文时直接放在上级目录；多文件或含正文时自动建子文件夹并将正文保存为离线可阅的 `_notes.html`。
  - 自动跳过录播视频流链接（Echo360 / Panopto 等），非视频外部链接按目录汇总保存为 `_links.txt`。
- **增量同步与容错**：本地记录已下载项目，再次同步时自动跳过已下文件；支持随时中止、单独取消勾选或一键重试失败项。

### 输出目录示例

```text
默认下载目录 (Downloads)/NTUlearn/
└── 25S1-CS1001-LEC/
    ├── 01_Course Materials/
    │   ├── Week_01_Slides.pdf
    │   └── _links.txt
    └── 02_Tutorials/
        └── Tutorial_1_Notes/
            ├── _notes.html
            └── Tut1_Questions.pdf
```

### 安装步骤（Chrome / Edge）

1. 打开浏览器的扩展程序管理页面：
   - **Chrome**：地址栏输入 `chrome://extensions`
   - **Edge**：地址栏输入 `edge://extensions`
2. 打开页面右上角（或左侧）的 **「开发者模式」** 开关。
3. 点击 **「加载已解压的扩展程序」**（Edge 为 **「加载解压缩的扩展」**）。
4. 选择本项目文件夹（包含 `manifest.json` 的目录）并确认。
5. 建议点击浏览器工具栏拼图图标，将 **「NTULearn 课件下载器」** 固定到工具栏方便随时打开。

### 使用方法

1. 在浏览器中正常登录 [NTULearn](https://ntulearn.ntu.edu.sg)。
2. 点击工具栏中的 **NTULearn 课件下载器** 图标，打开下载控制台页面。
3. 确认右上角显示 **「已登录」**（若刚完成登录，点击 **「刷新登录状态」** 即可）。
4. 在上方设置栏中确认保存子目录（默认 `NTUlearn`，实际路径为 `浏览器默认下载目录/NTUlearn/...`）及各项开关。
5. 在左侧按学期筛选或搜索课程，勾选需要归档的课程（已关闭/归档课程也可勾选尝试）。
6. 点击 **「1. 扫描所选课程」**，扫描完成后可在预览区检查完整路径并自由勾选/取消单个文件。
7. 点击 **「2. 开始下载到默认下载目录」**，等待进度条完成即可；若个别文件失败，可点击 **「重试失败项」** 单独补下。

### 重要提示：避免批量弹出「另存为」窗口

如果你的 Chrome / Edge 开启了 **「下载前询问每个文件的保存位置」**，批量下载多个课件时会连续弹出保存对话框。建议在批量下载前临时关闭：

- **Chrome**：打开 `chrome://settings/downloads`，关闭 **「下载前询问每个文件的保存位置」**。
- **Edge**：打开 `edge://settings/downloads`，关闭 **「每次下载都询问我该做些什么」**。

下载完成后，可根据个人习惯重新开启。

### 使用声明与许可协议（License & Disclaimer）

- **许可协议**：本项目采用 [PolyForm Noncommercial License 1.0.0](./LICENSE)（`PolyForm-Noncommercial-1.0.0`）发布，**仅限非商业与个人学习用途，严禁任何形式的商业销售、收费服务或盈利性二次分发**。
- **隐私与运行机制**：本扩展完全运行于本地浏览器，仅复用用户本人正常登录后的当前会话读取自己已选课程的文件列表。扩展**不收集、不存储、不向任何第三方发送**账号、密码、Cookie 或课程数据，亦不包含任何绕过认证/MFA 或下载受保护流媒体视频的功能。
- **免责声明**：本软件按“原样（AS IS）”提供，不作任何明示或暗示担保。使用者须自行遵守所在院校的 IT 使用政策、学术诚信规范及相关版权法规，**严禁将下载的课程讲义、试卷等受版权保护资料用于公开传播或商业用途**。因违反上述规定或滥用本工具产生的任何后果，均由使用者自行承担，作者不承担任何法律或连带责任。

---

<a id="english"></a>

## English

A Manifest V3 browser extension for Chrome and Edge that scans and batch-downloads course materials, Ultra Document notes (`_notes.html`), and non-video external links (`_links.txt`) from NTULearn (Blackboard Learn Ultra), automatically organizing them into your browser's default Downloads folder while mirroring the webpage folder hierarchy.

### Features

- **Session Reuse (No Password/MFA Automation Needed)**: Uses your active NTULearn browser session directly after you sign in normally via NTU Microsoft SSO / MFA.
- **Webpage Hierarchy & Order Preservation**: Organizes files under concise course codes (e.g., `25S1-CS1001-LEC`) and mirrors Blackboard's folder/learning-module tree with optional zero-padded order prefixes (`01_Course Materials/...`).
- **Smart Content Extraction**:
  - Downloads standalone files, embedded `/bbcswebdav/` assets, and assignment attachments (PDF, PPT, Word, ZIP, etc.).
  - Smart Ultra Document handling: a document with a single attachment and no meaningful body text is saved directly in the parent folder without creating a redundant subfolder; documents with text or multiple attachments get a dedicated subfolder with `_notes.html`.
  - Automatically skips lecture recording/video links (Echo360, Panopto, Kaltura, etc.) and collects non-video external links into `_links.txt` per folder.
- **Incremental Sync & Retry**: Tracks downloaded items in `chrome.storage.local` to skip already-downloaded files on future runs, with abort support and one-click retry for failed tasks.

### Output Structure Example

```text
Downloads/NTUlearn/
└── 25S1-CS1001-LEC/
    ├── 01_Course Materials/
    │   ├── Week_01_Slides.pdf
    │   └── _links.txt
    └── 02_Tutorials/
        └── Tutorial_1_Notes/
            ├── _notes.html
            └── Tut1_Questions.pdf
```

### Installation (Chrome / Edge)

1. Open the Extensions management page:
   - **Chrome**: navigate to `chrome://extensions`
   - **Edge**: navigate to `edge://extensions`
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project directory (the folder containing `manifest.json`).
5. Optionally pin **NTULearn 课件下载器** to your browser toolbar for quick access.

### Usage

1. Log in to [NTULearn](https://ntulearn.ntu.edu.sg) in your browser as usual.
2. Click the extension icon in the toolbar to open the dashboard tab.
3. Verify that the top-right status shows logged in (or click **刷新登录状态 / Refresh Login** after signing in).
4. Review the root subfolder name (default: `NTUlearn`, saved under `Downloads/NTUlearn/...`) and options in the settings bar.
5. Filter by semester or search courses on the left, then select the courses you want to archive.
6. Click **1. 扫描所选课程 (Scan Selected Courses)** to preview the folder tree and file list.
7. Click **2. 开始下载到默认下载目录 (Start Download)**; if any files fail due to transient network errors, click **重试失败项 (Retry Failed)** afterward.

### Important Tip: Disable "Ask where to save each file"

If your browser is configured to ask where to save every file before downloading, batch downloading will trigger repeated Save-As dialogs. Temporarily disable it before running a batch download:

- **Chrome**: `chrome://settings/downloads` → turn off **Ask where to save each file before downloading**.
- **Edge**: `edge://settings/downloads` → turn off **Ask me what to do with each download**.

### License & Disclaimer

- **License**: Released under the [PolyForm Noncommercial License 1.0.0](./LICENSE) (`PolyForm-Noncommercial-1.0.0`). Personal study, research, and noncommercial use are permitted; **any commercial use, paid service, resale, or monetization is strictly prohibited**.
- **Local-Only & Privacy**: This extension runs entirely inside your local browser using your own already-authenticated session. It **does not collect, store, or transmit** any credentials, cookies, or course data to any third-party server, and does not bypass authentication/MFA or download protected video streams.
- **Disclaimer**: THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. Users are solely responsible for complying with their institution's IT acceptable use policies, academic integrity guidelines, and copyright laws. **Do not redistribute downloaded course materials or use them commercially.** The authors assume no liability for any damages or consequences arising from the use or misuse of this software.
