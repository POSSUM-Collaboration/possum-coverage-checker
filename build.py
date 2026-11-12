#!/usr/bin/env python3
"""Inline src/data.js, src/lib.js and src/ui.js into src/page.html -> index.html (the whole app, one file)."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
page = (ROOT / "src" / "page.html").read_text(encoding="utf-8")
for marker, name in (("/*@DATA@*/", "data.js"), ("/*@LIB@*/", "lib.js"), ("/*@UI@*/", "ui.js")):
    code = (ROOT / "src" / name).read_text(encoding="utf-8").replace("</script", "<\\/script")
    assert marker in page, marker
    page = page.replace(marker, code)
(ROOT / "index.html").write_text(page, encoding="utf-8")
print(f"index.html: {len(page)} bytes")
