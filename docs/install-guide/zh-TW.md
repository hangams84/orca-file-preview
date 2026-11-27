# 安裝 File Preview（Orca 應用程式）

在 Orca 應用程式的設定中，透過 GitHub 網址安裝並啟用 File Preview 外掛。不需要使用終端機。

> 截圖：Orca 1.4.279，繁體中文介面。其他 Orca 版本中的名稱和位置可能略有不同。

## 步驟

1. 點選 Orca 視窗左下角的 **設定** 按鈕（齒輪圖示）。

   ![第 1 步](zh-TW/01-settings-button.png)

2. 在選單中選擇 **設定**。

   ![第 2 步](zh-TW/02-settings-menu.png)

3. 在左側的設定清單中點選 **外掛**。

   ![第 3 步](zh-TW/03-plugins.png)

4. 點選右上角的 **新增外掛**。

   ![第 4 步](zh-TW/04-add-plugin.png)

5. 選擇 **從 Git URL…**。

   ![第 5 步](zh-TW/05-from-git-url.png)

6. **安裝外掛** 對話框會在 **Git URL** 分頁中開啟。將下面的網址貼到 **存放庫 URL**：

   ```text
   https://github.com/hangams84/orca-file-preview.git
   ```

   ![第 6 步](zh-TW/06-repository-url.png)

7. 點選 **繼續**。

   ![第 7 步](zh-TW/07-continue.png)

8. Orca 會找到最新版本（「將安裝最新版本 v0.4.0（提交 e6fe45d）。」）。點選 **安裝**。

   ![第 8 步](zh-TW/08-install.png)

9. Orca 會詢問你是否信任發布者（「請確認你信任 hangams84」）。點選 **安裝**。

   ![第 9 步](zh-TW/09-trust.png)

10. 外掛頁面的 **可存取** 部分列出了外掛能做的事：開啟它預覽的檔案類型。點選 **啟用外掛**。（選擇 **保持關閉** 則只安裝、不啟用。）

    ![第 10 步](zh-TW/10-enable.png)

11. 狀態現在顯示為 **開啟**。點選 **返回應用程式**。

    ![第 11 步](zh-TW/11-enabled.png)

12. 在檔案總管中開啟一個支援的檔案，例如 **sample.docx**。

    ![第 12 步](zh-TW/12-open-sample.png)

13. 檔案會在預覽中開啟。

    ![第 13 步](zh-TW/13-preview.png)

14. 選用：如需檢視 DWG 圖面，請用同樣的方法（第 4–10 步）安裝 DWG 配套外掛。貼上下面的網址，點選 **繼續** 和 **安裝**，然後啟用它。

    ```text
    https://github.com/hangams84/orca-file-preview-dwg.git
    ```

    ![第 14 步](zh-TW/14-optional-dwg.png)

## 疑難排解

- **無法透過 Git URL 安裝**：透過 Git URL 安裝需要 Orca 1.4.252 或更新版本。請更新 Orca 後再試一次。
- **「plugin exceeds the install size or file count limit」**：這個問題只發生在 v0.2.2 之前的舊標籤（v0.1.0–v0.2.1）。請使用上面不帶 `#標籤` 的網址，Orca 會安裝最新版本。
- **`.txt` `.csv` `.tsv` `.html` `.htm` 檔案以文字形式開啟**：這些類型由 Orca 自己開啟，會先顯示 Source 檢視。請用分頁右上角的檢視切換按鈕選擇預覽。
- **3D 模型、機器人（URDF）或圖面缺少材質、網格或參照檔案**：編輯器只會收到開啟的那個檔案。點選預覽工具列中的 📁 按鈕，選擇含有參照檔案的資料夾（按住 Shift：選擇個別檔案），或將檔案拖放到預覽中。
- **超過 50 MB 的檔案（「exceeds 50MB limit」）**：Orca 最多只會傳 50 MB 給編輯器。請在右側邊欄的 **File Preview** 面板中用「Open file…」開啟檔案，它沒有這個限制（最大 1 GB）。

---

[其他語言](README.md) · [File Preview 儲存庫](https://github.com/hangams84/orca-file-preview)
