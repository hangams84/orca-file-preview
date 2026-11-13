// FilePreviewSetup.exe - offline installer / updater / uninstaller for File Preview for Orca on Windows.
// The release package (orca-file-preview-<version>.zip) is embedded as a resource. The program unpacks it
// to %LOCALAPPDATA%\FilePreviewForOrca\<version>\ and runs installer\windows\file-preview.ps1 from there,
// so all logic (Orca detection, approval prompt, old-Orca fallback, Windows 10+ check) lives in one script.
//
//   FilePreviewSetup.exe                 menu
//   FilePreviewSetup.exe /install [/yes] install this version (replaces an installed copy)
//   FilePreviewSetup.exe /update [/check] [/yes]   newest GitHub release
//   FilePreviewSetup.exe /uninstall [/yes]
//   FilePreviewSetup.exe /status
// Built by tools/build-windows-exe.ps1 with the .NET Framework 4 compiler that ships with Windows.
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("File Preview for Orca - Setup")]
[assembly: AssemblyProduct("File Preview for Orca")]
[assembly: AssemblyCompany("orca-file-preview")]
[assembly: AssemblyVersion(BuildInfo.Version + ".0")]
[assembly: AssemblyFileVersion(BuildInfo.Version + ".0")]

static class Setup
{
    static int Main(string[] args)
    {
        try { Console.OutputEncoding = Encoding.UTF8; } catch { }
        Console.Title = "File Preview for Orca " + BuildInfo.Version + " Setup";
        bool yes = Has(args, "/yes") || Has(args, "-yes") || Has(args, "--yes");
        string action = null;
        foreach (string a in args)
        {
            string x = a.TrimStart('/', '-').ToLowerInvariant();
            if (x == "install" || x == "update" || x == "uninstall" || x == "status") action = x;
        }
        bool interactive = action == null;
        if (interactive) action = Menu();
        if (action == null) return 0;
        int rc;
        try
        {
            string pkg = Unpack();
            string ps1 = Path.Combine(pkg, "File Preview", "installer", "windows", "file-preview.ps1");
            if (action == "install")
            {
                // Replace any installed copy (it re-copies from its own original folder on update).
                RunScript(ps1, "uninstall -Yes", true);
                rc = RunScript(ps1, "install" + (yes ? " -Yes" : ""), false);
            }
            else if (action == "update") rc = RunScript(ps1, "update" + (Has(args, "/check") ? " -Check" : "") + (yes ? " -Yes" : ""), false);
            else if (action == "uninstall") rc = RunScript(ps1, "uninstall" + (yes ? " -Yes" : ""), false);
            else rc = RunScript(ps1, "status", false);
        }
        catch (Exception e)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("ERROR: " + e.Message);
            Console.ResetColor();
            rc = 1;
        }
        if (interactive)
        {
            Console.WriteLine();
            Console.Write("Press Enter to close. / Enter 키를 누르면 닫힙니다. ");
            Console.ReadLine();
        }
        return rc;
    }

    static bool Has(string[] args, string flag)
    {
        foreach (string a in args) if (string.Equals(a, flag, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    static string Menu()
    {
        Console.WriteLine("File Preview for Orca " + BuildInfo.Version);
        Console.WriteLine("Orca 미리보기 플러그인 (Office · PDF · HWP · 3D ...)");
        Console.WriteLine();
        Console.WriteLine("  1) Install this version  / 이 버전 설치");
        Console.WriteLine("  2) Update from GitHub    / 최신 버전으로 업데이트");
        Console.WriteLine("  3) Uninstall             / 제거");
        Console.WriteLine("  4) Status                / 상태 확인");
        Console.WriteLine("  0) Exit                  / 종료");
        Console.WriteLine();
        Console.Write("> ");
        string k = (Console.ReadLine() ?? "").Trim();
        switch (k)
        {
            case "1": return "install";
            case "2": return "update";
            case "3": return "uninstall";
            case "4": return "status";
            default: return null;
        }
    }

    // Unpacks the embedded package once per version and returns its folder.
    static string Unpack()
    {
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FilePreviewForOrca");
        string dir = Path.Combine(root, BuildInfo.Version);
        string marker = Path.Combine(dir, ".complete");
        if (File.Exists(marker)) return dir;
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
        Directory.CreateDirectory(dir);
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        {
            if (s == null) throw new Exception("The setup has no embedded package.");
            using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    string dest = Path.GetFullPath(Path.Combine(dir, e.FullName.Replace('/', Path.DirectorySeparatorChar)));
                    if (!dest.StartsWith(Path.GetFullPath(dir), StringComparison.OrdinalIgnoreCase)) continue; // no path escape
                    if (e.FullName.EndsWith("/")) { Directory.CreateDirectory(dest); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    e.ExtractToFile(dest, true);
                }
            }
        }
        File.WriteAllText(marker, DateTime.UtcNow.ToString("o"));
        return dir;
    }

    static int RunScript(string ps1, string arguments, bool quiet)
    {
        ProcessStartInfo psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass -File \"" + ps1 + "\" " + arguments);
        psi.UseShellExecute = false;
        psi.RedirectStandardOutput = quiet;
        psi.RedirectStandardError = quiet;
        using (Process p = Process.Start(psi))
        {
            if (quiet) { p.StandardOutput.ReadToEnd(); p.StandardError.ReadToEnd(); }
            p.WaitForExit();
            return p.ExitCode;
        }
    }
}
