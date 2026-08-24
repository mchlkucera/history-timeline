#!/usr/bin/env python3
"""Inline data.js + app.js into one double-clickable file."""
import os
d = os.path.dirname(os.path.abspath(__file__))
html = open(os.path.join(d,'index.html')).read()
data = open(os.path.join(d,'data.js')).read()
app  = open(os.path.join(d,'app.js')).read()
html = html.replace('<script src="./data.js"></script>\n<script src="./app.js"></script>',
                    '<script>\n'+data+'\n</script>\n<script>\n'+app+'\n</script>')
out = os.path.join(d,'timeline-layers.html')
open(out,'w').write(html)
print('wrote', out, os.path.getsize(out), 'bytes')
