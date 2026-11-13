"""One-off: release notes for v0.1.0 from that commit's own evidence (run inside a checkout of v0.1.0).
   python tools/release-notes-v010.py <checkout-dir> <out.md>"""
import glob
import json
import os
import re
import sys

src, out_path = sys.argv[1], sys.argv[2]
ev = os.path.join(src, "docs", "evidence")
rounds = []
for d in glob.glob(os.path.join(ev, "round-*", "summary.json")):
    n = int(re.search(r"round-(\d+)", d).group(1))
    s = json.load(open(d, encoding="utf-8"))
    ip = d.replace("summary.json", "issues.json")
    issues = json.load(open(ip, encoding="utf-8")) if os.path.exists(ip) else []
    h = s.get("harness", [])
    rounds.append((n, s, issues, h))
rounds.sort(key=lambda r: r[0])
m = json.load(open(os.path.join(src, "plugin", "orca-plugin.json"), encoding="utf-8"))
exts = sorted({e for ed in m["contributes"]["customEditors"] for e in ed["extensions"]})
last = rounds[-1][1]
out = [
    "First verified release of **File Preview for Orca**: read-only previews inside [Orca](https://github.com/stablyai/orca) on desktop and browser/mobile clients.",
    "Orca 안에서 Office · PDF · 텍스트 · 표 · HTML · 이미지 파일을 읽기 전용으로 미리보기 하는 플러그인의 첫 검증 릴리스입니다.",
    "",
    "## 지원 형식 / Formats",
    "",
    " ".join(f"`{e}`" for e in exts),
    "",
    f"- Requires Orca **{m['engines']['orca']}** · `sandboxed-ui` only (no extra capabilities, no network, never edits files)",
    "",
    "## 설치 / Install",
    "",
    "```sh",
    "orca plugin install https://github.com/hangams84/orca-file-preview/tree/v0.1.0/plugin",
    "```",
    "",
    'Or unzip `orca-file-preview-0.1.0.zip` and run `orca plugin install "File Preview/plugin"`.',
    "Installer scripts, executables, the updater, HWP/HWPX and 3D previews arrive in v0.2.0.",
    "",
    f"## 검증 결과 / Verification ({len(rounds)} rounds on Windows 11, Orca {last.get('orcaVersion', '')})",
    "",
    "| Round | Checks | Browser harness | Issues found / fixed |",
    "| --- | --- | --- | --- |",
]
for n, s, issues, h in rounds:
    out.append(f"| {n} | {sum(c['ok'] for c in s['checks'])}/{len(s['checks'])} | {sum(x['pass'] for x in h)}/{len(h)} | {len(issues)} / {sum(i['status'] == 'fixed' for i in issues)} |")
out += [
    "",
    "Final round: " + " · ".join(f"{'✅' if c['ok'] else '❌'} {c['name']}" for c in last["checks"]),
    "",
    "Reports, issue tables and screenshots: [docs/README.md](https://github.com/hangams84/orca-file-preview/blob/v0.1.0/docs/README.md)",
    "",
]
open(out_path, "w", encoding="utf-8").write("\n".join(out))
print("\n".join(out))
