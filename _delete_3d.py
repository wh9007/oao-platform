# -*- coding: utf-8 -*-
from pathlib import Path
p = Path(r"C:\Users\wh-90\Desktop\Html 代码\OAO.eth 20260612 更新测试\OAO.html")
lines = p.read_text(encoding="utf-8").splitlines(keepends=True)
# Find duplicate time-scroll marker after theme toggle
start = None
end = None
for i, line in enumerate(lines):
    if i > 14200 and line.strip() == "// 时间席位滚动功能" and start is None:
        if i + 1 < len(lines) and "oaoBackgroundCanvas" in lines[i + 1]:
            start = i
    if start is not None and end is None and line.strip() == "// 时间席位滚动功能" and i > start:
        end = i
        break
if start is None or end is None:
    raise SystemExit(f"markers not found start={start} end={end}")
new_lines = lines[:start] + lines[end:]
p.write_text("".join(new_lines), encoding="utf-8")
print(f"removed lines {start+1}-{end}, new total {len(new_lines)}")
