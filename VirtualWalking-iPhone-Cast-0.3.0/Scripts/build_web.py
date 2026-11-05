#!/usr/bin/env python3
"""Bundle the existing training UI for WKWebView; no network hosting needed."""
from pathlib import Path
import base64
import re

root = Path(__file__).resolve().parent.parent
web = root / 'Web'
html = (web / 'index.html').read_text()
html = re.sub(r'<script\b[^>]*src="[^"]+"[^>]*>\s*</script>', '', html)
html = re.sub(r'<link rel="stylesheet"[^>]*>', '<style>' + (web / 'styles.css').read_text() + '</style>', html)
icon = 'data:image/svg+xml;base64,' + base64.b64encode((web / 'icon.svg').read_bytes()).decode()
html = html.replace('href="icon.svg"', 'href="' + icon + '"').replace('src="icon.svg"', 'src="' + icon + '"')
scripts = []
for name in ['core.js', 'bluetooth.js', 'joint-start.js', 'cast.js', 'app.js']:
    content = (web / name).read_text()
    content = re.sub('</script', r'<\\/script', content, flags=re.I)
    scripts.append('<script>\n' + content + '\n</script>')
html = html.replace('</body>', '\n'.join(scripts) + '\n</body>')
(web / 'native.html').write_text(html)
print('Native HTML bundled.')
