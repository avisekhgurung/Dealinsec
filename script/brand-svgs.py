"""
DealInSec brand SVGs: writes client/public/brand/*.svg and client/public/favicon.svg from one geometry.
Run from the repo root:  python3 script/brand-svgs.py
The React component (client/src/components/dealinsec-logo.tsx) and server LOGO_SVG (server/tools/layout.ts)
use the same paths and colours: change them together. The PNGs (favicons, app icons, email logo) were rendered
from these SVGs with headless Chrome (Inter loaded) and favicon.ico assembled from 16/32/48/64 px renders.
"""
import os
OUT = "client/public/brand"
os.makedirs(OUT, exist_ok=True)

# The D: a left bar in shadow, the top ribbon sweeping round the bowl, the bottom ribbon folding up from the corner.
BAR = "M8 8C10 14.6 14.2 19 20 19V45L8 56Z"
TOP = "M8 8H30C45.5 8 57 18.5 57 32C57 45.5 45.5 56 30 56H28V45H29.5C37 45 42.5 39.4 42.5 32C42.5 24.6 37 19 29.5 19H20C14.2 19 10 14.6 8 8Z"
BOTTOM = "M8 56L20 45H31V56Z"
SOLID = "M8 8H30C45.5 8 57 18.5 57 32C57 45.5 45.5 56 30 56H8ZM20 19V45H29.5C37 45 42.5 39.4 42.5 32C42.5 24.6 37 19 29.5 19Z"

def mark_defs(p):
    return f'''<linearGradient id="{p}t" x1="10" y1="8" x2="56" y2="52" gradientUnits="userSpaceOnUse"><stop stop-color="#2FE6A0"/><stop offset=".45" stop-color="#14BF8F"/><stop offset="1" stop-color="#0C8E7B"/></linearGradient>
    <linearGradient id="{p}l" x1="14" y1="10" x2="14" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#086B5F"/><stop offset=".35" stop-color="#0E9A85"/><stop offset=".8" stop-color="#0E9883"/><stop offset="1" stop-color="#0A7B6C"/></linearGradient>
    <linearGradient id="{p}b" x1="8" y1="56" x2="31" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="#33EBA4"/><stop offset=".55" stop-color="#1CCB94"/><stop offset="1" stop-color="#10A584"/></linearGradient>'''

def mark_paths(p):
    return f'<path d="{BAR}" fill="url(#{p}l)"/><path d="{TOP}" fill="url(#{p}t)"/><path d="{BOTTOM}" fill="url(#{p}b)"/>'

FONT = "Inter, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
TONES = {
    "light": {"deal": "#111B22", "tag": "#3A4550", "w1": "#22D892", "w2": "#0C8E7B"},
    "dark": {"deal": "#F3F6F7", "tag": "#A3B3BD", "w1": "#3DF0AC", "w2": "#14B990"},
}

def write(name, svg):
    with open(f"{OUT}/{name}", "w") as f:
        f.write(svg.strip() + "\n")

TITLE = "<title>DealInSec</title>"
write("dealinsec-mark.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" role="img" aria-label="DealInSec">{TITLE}
  <defs>{mark_defs("m")}</defs>
  {mark_paths("m")}
</svg>''')
write("dealinsec-mark-white.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" role="img" aria-label="DealInSec">{TITLE}
  <path d="{SOLID}" fill="#FFFFFF" fill-rule="evenodd"/>
</svg>''')
write("dealinsec-mark-charcoal.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" role="img" aria-label="DealInSec">{TITLE}
  <path d="{SOLID}" fill="#111B22" fill-rule="evenodd"/>
</svg>''')

def horizontal(tone):
    t = TONES[tone]
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 288 64" fill="none" role="img" aria-label="DealInSec">{TITLE}
  <defs>{mark_defs("h")}
    <linearGradient id="hw" x1="0" y1="16" x2="0" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="{t["w1"]}"/><stop offset="1" stop-color="{t["w2"]}"/></linearGradient></defs>
  {mark_paths("h")}
  <text x="78" y="48" font-family="{FONT}" font-size="44" font-weight="800" letter-spacing="-1.5" textLength="205" lengthAdjust="spacingAndGlyphs"><tspan fill="{t["deal"]}">Deal</tspan><tspan fill="url(#hw)">InSec</tspan></text>
</svg>'''

def lockup(tone):
    t = TONES[tone]
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 76" fill="none" role="img" aria-label="DealInSec. Find Clients. Close Deals. Get Paid.">{TITLE}
  <defs>{mark_defs("k")}
    <linearGradient id="kw" x1="0" y1="14" x2="0" y2="46" gradientUnits="userSpaceOnUse"><stop stop-color="{t["w1"]}"/><stop offset="1" stop-color="{t["w2"]}"/></linearGradient></defs>
  <g transform="scale(1.1875)">{mark_paths("k")}</g>
  <text x="92" y="46" font-family="{FONT}" font-size="44" font-weight="800" letter-spacing="-1.5" textLength="205" lengthAdjust="spacingAndGlyphs"><tspan fill="{t["deal"]}">Deal</tspan><tspan fill="url(#kw)">InSec</tspan></text>
  <text x="93" y="66" font-family="{FONT}" font-size="10.5" font-weight="500" letter-spacing=".6" textLength="186" lengthAdjust="spacing" fill="{t["tag"]}">Find Clients. Close Deals. Get Paid.</text>
</svg>'''

write("dealinsec-logo.svg", horizontal("light"))
write("dealinsec-logo-dark.svg", horizontal("dark"))
write("dealinsec-lockup.svg", lockup("light"))
write("dealinsec-lockup-dark.svg", lockup("dark"))
# The browser-tab icon is the mark itself (transparent: it reads on light and dark tab strips).
with open("client/public/favicon.svg", "w") as f:
    f.write(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <defs>{mark_defs("f")}</defs>
  {mark_paths("f")}
</svg>
''')
print("ok")
