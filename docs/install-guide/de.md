# File Preview installieren (Orca-App)

So installieren und aktivieren Sie das Plugin File Preview über seine GitHub-URL in den Einstellungen der Orca-App. Ein Terminal ist nicht nötig.

> Screenshots: Orca 1.4.279, deutsche Oberfläche. In anderen Orca-Versionen können Namen und Positionen leicht abweichen. Der Pfad oben („Settings / …“) ist in Orca noch nicht übersetzt.

## Schritte

1. Klicken Sie unten links im Orca-Fenster auf die Schaltfläche **Einstellungen** (Zahnrad).

   ![Schritt 1](de/01-settings-button.png)

2. Wählen Sie im Menü **Einstellungen**.

   ![Schritt 2](de/02-settings-menu.png)

3. Klicken Sie links in der Liste der Einstellungen auf **Plugins**.

   ![Schritt 3](de/03-plugins.png)

4. Klicken Sie oben rechts auf **Plugin hinzufügen**.

   ![Schritt 4](de/04-add-plugin.png)

5. Wählen Sie **Aus einer Git-URL…**.

   ![Schritt 5](de/05-from-git-url.png)

6. Der Dialog **Plugin installieren** öffnet sich auf dem Tab **Git-URL**. Fügen Sie diese Adresse in **Repository-URL mit #ref** ein:

   ```text
   https://github.com/hangams84/orca-file-preview.git
   ```

   ![Schritt 6](de/06-repository-url.png)

7. Klicken Sie auf **Weiter**.

   ![Schritt 7](de/07-continue.png)

8. Orca findet die neueste Version („Installiert v0.4.0, die neueste Version, bei Commit e6fe45d.“). Klicken Sie auf **Installieren**.

   ![Schritt 8](de/08-install.png)

9. Orca fragt, ob Sie dem Herausgeber vertrauen („Stellen Sie sicher, dass Sie hangams84 vertrauen“). Klicken Sie auf **Installieren**.

   ![Schritt 9](de/09-trust.png)

10. Die Plugin-Seite zeigt unter **Kann zugreifen auf**, was das Plugin darf: die Dateitypen öffnen, die es anzeigt. Klicken Sie auf **Plugin aktivieren**. (**Ausgeschaltet lassen** lässt es installiert, aber ausgeschaltet.)

    ![Schritt 10](de/10-enable.png)

11. Der Status zeigt jetzt **An**. Klicken Sie auf **Zur App zurückkehren**.

    ![Schritt 11](de/11-enabled.png)

12. Öffnen Sie im Explorer eine unterstützte Datei, zum Beispiel **sample.docx**.

    ![Schritt 12](de/12-open-sample.png)

13. Die Datei öffnet sich in der Vorschau.

    ![Schritt 13](de/13-preview.png)

14. Optional: Um DWG-Zeichnungen anzuzeigen, installieren Sie das DWG-Zusatz-Plugin auf dieselbe Weise (Schritte 4–10). Fügen Sie die Adresse unten ein, klicken Sie auf **Weiter** und **Installieren** und schalten Sie es dann ein.

    ```text
    https://github.com/hangams84/orca-file-preview-dwg.git
    ```

    ![Schritt 14](de/14-optional-dwg.png)

## Fehlerbehebung

- **Die Installation über die Git-URL funktioniert nicht**: Die Installation über eine Git-URL braucht Orca 1.4.252 oder neuer. Aktualisieren Sie Orca und versuchen Sie es erneut.
- **„plugin exceeds the install size or file count limit“**: Das trat nur bei alten Tags (v0.1.0–v0.2.1) vor v0.2.2 auf. Verwenden Sie die Adresse oben ohne `#Tag`; Orca installiert dann die neueste Version.
- **Eine `.txt`-, `.csv`-, `.tsv`-, `.html`- oder `.htm`-Datei öffnet sich als Text**: Diese Typen öffnet Orca selbst, zuerst in der Ansicht Source. Wählen Sie die Vorschau mit dem Ansichtsumschalter oben rechts im Tab.
- **Einem 3D-Modell, Roboter (URDF) oder einer Zeichnung fehlen Texturen, Meshes oder referenzierte Dateien**: Der Editor erhält nur die geöffnete Datei. Klicken Sie in der Symbolleiste der Vorschau auf 📁 und wählen Sie den Ordner mit den referenzierten Dateien (Umschalt: einzelne Dateien), oder ziehen Sie die Dateien auf die Vorschau.
- **Dateien über 50 MB („exceeds 50MB limit“)**: Orca übergibt einem Editor höchstens 50 MB. Öffnen Sie die Datei mit „Open file…“ im Panel **File Preview** in der rechten Seitenleiste; dort gibt es diese Grenze nicht (bis 1 GB).

---

[Andere Sprachen](README.md) · [File-Preview-Repository](https://github.com/hangams84/orca-file-preview)
