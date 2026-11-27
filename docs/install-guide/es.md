# Instalar File Preview (aplicación Orca)

Cómo instalar y activar el plugin File Preview desde su URL de GitHub en la configuración de la aplicación Orca. No hace falta usar la terminal.

> Capturas: Orca 1.4.279, interfaz en español. Los nombres y las posiciones pueden variar un poco en otras versiones de Orca. La ruta de navegación de la parte superior («Settings / …») aún no está traducida en Orca.

## Pasos

1. Haga clic en el botón **Ajustes** (icono de engranaje), en la esquina inferior izquierda de la ventana de Orca.

   ![Paso 1](es/01-settings-button.png)

2. En el menú, elija **Ajustes**.

   ![Paso 2](es/02-settings-menu.png)

3. En la lista de ajustes de la izquierda, haga clic en **Plugins** (sección **Experimental**).

   ![Paso 3](es/03-plugins.png)

4. Haga clic en **Añadir plugin**, en la esquina superior derecha.

   ![Paso 4](es/04-add-plugin.png)

5. Elija **Desde una URL de Git…**.

   ![Paso 5](es/05-from-git-url.png)

6. El cuadro de diálogo **Instalar plugin** se abre en la pestaña **Git URL**. Pegue esta dirección en **URL del repositorio**:

   ```text
   https://github.com/hangams84/orca-file-preview.git
   ```

   ![Paso 6](es/06-repository-url.png)

7. Haga clic en **Continuar**.

   ![Paso 7](es/07-continue.png)

8. Orca encuentra la versión más reciente («Instala v0.4.0, la versión más reciente, en el commit e6fe45d.»). Haga clic en **Instalar**.

   ![Paso 8](es/08-install.png)

9. Orca le pide que confirme que confía en el editor («Asegúrate de que confías en hangams84»). Haga clic en **Instalar**.

   ![Paso 9](es/09-trust.png)

10. En la página del plugin, la sección **Puede acceder a** muestra lo que puede hacer el plugin: abrir los tipos de archivo que previsualiza y leer los archivos que abre («Ningún otro acceso»). Haga clic en **Activar plugin**. (**Mantener desactivado** lo deja instalado, pero desactivado.)

    ![Paso 10](es/10-enable.png)

11. El estado ahora muestra **Activado**. Haga clic en **Volver a la app**, arriba a la izquierda.

    ![Paso 11](es/11-enabled.png)

12. Abra un archivo compatible en el explorador de archivos de la derecha, por ejemplo **sample.docx**.

    ![Paso 12](es/12-open-sample.png)

13. El archivo se abre en la vista previa.

    ![Paso 13](es/13-preview.png)

14. Opcional: para ver planos DWG, instale el plugin complementario de DWG de la misma forma (pasos 4–10). Pegue la dirección de abajo, haga clic en **Continuar** y en **Instalar**, y luego actívelo.

    ```text
    https://github.com/hangams84/orca-file-preview-dwg.git
    ```

    ![Paso 14](es/14-optional-dwg.png)

## Solución de problemas

- **La instalación desde la URL de Git no funciona**: instalar desde una URL de Git requiere Orca 1.4.252 o posterior. Actualice Orca y vuelva a intentarlo.
- **«plugin exceeds the install size or file count limit»**: esto solo ocurría con etiquetas antiguas (v0.1.0–v0.2.1), anteriores a v0.2.2. Use la dirección de arriba sin `#etiqueta`; así Orca instalará la versión más reciente.
- **Un archivo `.txt`, `.csv`, `.tsv`, `.html` o `.htm` se abre como texto**: Orca abre estos tipos por sí mismo, primero en la vista **Código fuente**. Elija la vista previa con el selector de vista de la esquina superior derecha de la pestaña.
- **A un modelo 3D, robot (URDF) o plano le faltan texturas, mallas o archivos referenciados**: el editor solo recibe el archivo abierto. Haga clic en el botón 📁 de la barra de herramientas de la vista previa y elija la carpeta con los archivos referenciados (con Mayús: archivos sueltos), o arrástrelos a la vista previa.
- **Archivos de más de 50 MB («exceeds 50MB limit»)**: Orca pasa como máximo 50 MB a un editor. Abra el archivo con «Open file…» en el panel **File Preview** de la barra lateral derecha; el panel no tiene ese límite (admite hasta 1 GB).

---

[Otros idiomas](README.md) · [Repositorio de File Preview](https://github.com/hangams84/orca-file-preview)
