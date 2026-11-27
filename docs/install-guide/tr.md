# File Preview kurulumu (Orca uygulaması)

File Preview eklentisini Orca uygulamasının ayarlarından GitHub adresiyle kurma ve açma adımları. Terminal gerekmez.

> Ekran görüntüleri: Orca 1.4.279, Türkçe arayüz. Diğer Orca sürümlerinde adlar ve konumlar biraz farklı olabilir.

## Adımlar

1. Orca penceresinin sol altındaki **Ayarlar** düğmesine (dişli simgesi) tıklayın.

   ![Adım 1](tr/01-settings-button.png)

2. Menüden **Ayarlar** seçeneğini seçin.

   ![Adım 2](tr/02-settings-menu.png)

3. Soldaki ayarlar listesinde **Eklentiler** öğesine tıklayın.

   ![Adım 3](tr/03-plugins.png)

4. Sağ üstteki **Eklenti ekle** düğmesine tıklayın.

   ![Adım 4](tr/04-add-plugin.png)

5. **Bir Git URL’sinden…** seçeneğini seçin.

   ![Adım 5](tr/05-from-git-url.png)

6. **Eklenti yükle** penceresi **Git URL'si** sekmesinde açılır. Aşağıdaki adresi **#ref içeren repository URL'si** alanına yapıştırın:

   ```text
   https://github.com/hangams84/orca-file-preview.git
   ```

   ![Adım 6](tr/06-repository-url.png)

7. **Devam** düğmesine tıklayın.

   ![Adım 7](tr/07-continue.png)

8. Orca en yeni sürümü bulur (“En son sürüm olan v0.4.0, e6fe45d commit'inde yüklenir.”). **Yükle** düğmesine tıklayın.

   ![Adım 8](tr/08-install.png)

9. Orca yayıncıya güvenip güvenmediğinizi sorar (“hangams84 kaynağına güvendiğinizden emin olun”). **Yükle** düğmesine tıklayın.

   ![Adım 9](tr/09-trust.png)

10. Eklenti sayfasındaki **Erişebildikleri** bölümü, eklentinin neler yapabileceğini gösterir: önizlediği dosya türlerini açmak. **Eklentiyi etkinleştir** düğmesine tıklayın. (**Kapalı tut** seçilirse eklenti kurulu kalır ama kapalı olur.)

    ![Adım 10](tr/10-enable.png)

11. Durum artık **Açık** olarak görünüyor. **Uygulamaya dön** düğmesine tıklayın.

    ![Adım 11](tr/11-enabled.png)

12. Gezginde desteklenen bir dosyayı açın, örneğin **sample.docx**.

    ![Adım 12](tr/12-open-sample.png)

13. Dosya önizlemede açılır.

    ![Adım 13](tr/13-preview.png)

14. İsteğe bağlı: DWG çizimlerini görmek için DWG ek eklentisini aynı şekilde (4–10. adımlar) kurun. Aşağıdaki adresi yapıştırın, **Devam** ve **Yükle** düğmelerine tıklayın, sonra eklentiyi açın.

    ```text
    https://github.com/hangams84/orca-file-preview-dwg.git
    ```

    ![Adım 14](tr/14-optional-dwg.png)

## Sorun giderme

- **Git URL ile kurulum çalışmıyor**: Git URL ile kurulum için Orca 1.4.252 veya daha yenisi gerekir. Orca’yı güncelleyip yeniden deneyin.
- **“plugin exceeds the install size or file count limit”**: Bu sorun yalnızca v0.2.2’den önceki eski etiketlerde (v0.1.0–v0.2.1) görüldü. Yukarıdaki adresi `#etiket` olmadan kullanın; Orca en yeni sürümü kurar.
- **`.txt`, `.csv`, `.tsv`, `.html` veya `.htm` dosyası metin olarak açılıyor**: Bu türleri Orca kendisi açar, önce Source görünümünde. Önizlemeyi sekmenin sağ üstündeki görünüm değiştirme düğmesiyle seçin.
- **3B model, robot (URDF) veya çizimde doku, ağ ya da başvurulan dosyalar eksik**: Düzenleyici yalnızca açılan dosyayı alır. Önizleme araç çubuğundaki 📁 düğmesine tıklayıp başvurulan dosyaların bulunduğu klasörü seçin (Shift: tek tek dosyalar) veya dosyaları önizlemenin üzerine bırakın.
- **50 MB’tan büyük dosyalar (“exceeds 50MB limit”)**: Orca bir düzenleyiciye en fazla 50 MB verir. Dosyayı sağ kenar çubuğundaki **File Preview** panelinde “Open file…” ile açın; orada bu sınır yoktur (1 GB’a kadar).

---

[Diğer diller](README.md) · [File Preview deposu](https://github.com/hangams84/orca-file-preview)
