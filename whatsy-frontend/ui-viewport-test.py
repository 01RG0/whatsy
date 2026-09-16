"""
Whatsy Phase 6 UI Viewport Test
Runs Playwright headless tests across all phone/tablet/desktop viewports.
Writes ui-test-report.md with honest findings.
"""
import asyncio
import datetime
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = "http://localhost:5173"
REPORT_PATH = Path("D:/pRoG/whatsy/ui-test-report.md")
SCREENSHOTS_DIR = Path("D:/pRoG/whatsy/ui-test-screenshots")
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

VIEWPORTS = [
    # Phones Portrait
    {"name": "iPhone SE",           "w": 375,  "h": 667,  "cat": "phone-portrait"},
    {"name": "iPhone 14",           "w": 390,  "h": 844,  "cat": "phone-portrait"},
    {"name": "iPhone 14 Pro Max",   "w": 430,  "h": 932,  "cat": "phone-portrait", "notch": True},
    {"name": "Samsung S24",         "w": 360,  "h": 780,  "cat": "phone-portrait"},
    {"name": "Samsung S24 Ultra",   "w": 412,  "h": 915,  "cat": "phone-portrait"},
    {"name": "Pixel 9",             "w": 393,  "h": 851,  "cat": "phone-portrait"},
    {"name": "Z Fold folded",       "w": 344,  "h": 882,  "cat": "phone-portrait"},
    {"name": "Z Flip compact",      "w": 260,  "h": 512,  "cat": "phone-portrait", "critical_narrow": True},
    # Phones Landscape
    {"name": "iPhone 14 landscape", "w": 844,  "h": 390,  "cat": "phone-landscape"},
    {"name": "iPhone 14 Pro Max landscape", "w": 932, "h": 430, "cat": "phone-landscape"},
    {"name": "S24 landscape",       "w": 780,  "h": 360,  "cat": "phone-landscape"},
    # Foldable unfolded
    {"name": "Z Fold unfolded",     "w": 768,  "h": 1076, "cat": "foldable"},
    # Tablets
    {"name": "iPad Mini",           "w": 768,  "h": 1024, "cat": "tablet"},
    {"name": "iPad Pro 12.9",       "w": 1024, "h": 1366, "cat": "tablet"},
    # Desktop
    {"name": "Laptop HD",           "w": 1280, "h": 720,  "cat": "desktop"},
    {"name": "Desktop FHD",         "w": 1920, "h": 1080, "cat": "desktop"},
    {"name": "Desktop 2K",          "w": 2560, "h": 1440, "cat": "desktop"},
]

CHECKS = [
    ("body_renders",       "body",                      "Page body renders"),
    ("no_horizontal_scroll","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2",  "No horizontal overflow"),
    ("input_bar",          "[data-testid='chat-input'], textarea, input[type='text'], input[placeholder]", "Input bar present"),
    ("console_clean",      None,                        "No JS errors in console"),
]

async def test_viewport(page, vp):
    findings = []
    await page.set_viewport_size({"width": vp["w"], "height": vp["h"]})

    # Collect console errors
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

    try:
        await page.goto(BASE_URL, wait_until="networkidle", timeout=15000)
    except Exception as e:
        findings.append({"sev": "CRITICAL", "msg": f"Page failed to load: {e}"})
        return findings, None

    # Screenshot
    shot_path = SCREENSHOTS_DIR / f"{vp['name'].replace(' ', '_')}.png"
    await page.screenshot(path=str(shot_path), full_page=False)

    # Horizontal scroll check
    overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    if overflow > 4:
        findings.append({"sev": "MAJOR", "msg": f"Horizontal overflow: {overflow}px extra width"})

    # Input bar accessible
    input_visible = await page.evaluate("""
        () => {
            const el = document.querySelector('textarea, input[type=text], input[placeholder], [contenteditable=true]');
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.bottom <= window.innerHeight && rect.top >= 0 && rect.width > 10;
        }
    """)
    if not input_visible:
        sev = "CRITICAL" if vp.get("critical_narrow") else "MAJOR"
        findings.append({"sev": sev, "msg": "Input bar not visible / outside viewport"})

    # Sidebar check (desktop/tablet should show sidebar, mobile may hide it)
    sidebar_exists = await page.evaluate("""
        () => {
            const el = document.querySelector('[class*=sidebar],[class*=Sidebar],[data-testid=sidebar],nav,aside');
            return !!el;
        }
    """)
    if not sidebar_exists and vp["cat"] in ("desktop", "tablet"):
        findings.append({"sev": "MAJOR", "msg": "No sidebar found on desktop/tablet"})

    # Safe area inset check for notch devices
    if vp.get("notch"):
        safe_area = await page.evaluate("""
            () => {
                const el = document.querySelector('header,[class*=header],[class*=Header]');
                if (!el) return null;
                const styles = window.getComputedStyle(el);
                return styles.paddingTop;
            }
        """)
        if safe_area and safe_area == "0px":
            findings.append({"sev": "MINOR", "msg": f"Header padding-top=0 on notch device — safe-area-inset-top may not be applied"})

    # Dark mode toggle
    dark_toggle = await page.evaluate("""
        () => {
            const btn = document.querySelector('[class*=dark],[class*=theme],[aria-label*=dark],[aria-label*=theme]');
            return !!btn;
        }
    """)

    # Text/content renders
    has_content = await page.evaluate("""
        () => document.body.innerText.trim().length > 0
    """)
    if not has_content:
        findings.append({"sev": "CRITICAL", "msg": "Page renders empty — no visible text content"})

    # Z Flip 260px specific: check minimum tap targets
    if vp.get("critical_narrow"):
        small_targets = await page.evaluate("""
            () => {
                const btns = document.querySelectorAll('button, [role=button], a');
                let tooSmall = 0;
                btns.forEach(b => {
                    const r = b.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)) tooSmall++;
                });
                return tooSmall;
            }
        """)
        if small_targets > 0:
            findings.append({"sev": "MINOR", "msg": f"{small_targets} tap target(s) smaller than 44×44px"})

    # Console errors
    if console_errors:
        for err in console_errors[:3]:
            findings.append({"sev": "MAJOR", "msg": f"Console error: {err[:120]}"})

    if not findings:
        findings.append({"sev": "PASS", "msg": "No issues detected"})

    return findings, shot_path

async def main():
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
            locale="en-US",
        )
        page = await context.new_page()

        for vp in VIEWPORTS:
            print(f"  Testing {vp['name']} ({vp['w']}×{vp['h']})...")
            findings, shot = await test_viewport(page, vp)
            results.append({"vp": vp, "findings": findings, "screenshot": shot})

        await browser.close()

    # Build report
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        "# Whatsy Phase 6 — UI Viewport Test Report",
        f"\n**Generated:** {now}  ",
        f"**Tool:** Playwright headless Chromium  ",
        f"**Viewports tested:** {len(VIEWPORTS)}  ",
        f"**Base URL:** {BASE_URL}\n",
        "---\n",
        "## Executive Summary\n",
    ]

    all_findings = [f for r in results for f in r["findings"] if f["sev"] != "PASS"]
    criticals = [f for f in all_findings if f["sev"] == "CRITICAL"]
    majors    = [f for f in all_findings if f["sev"] == "MAJOR"]
    minors    = [f for f in all_findings if f["sev"] == "MINOR"]
    cosmetics = [f for f in all_findings if f["sev"] == "COSMETIC"]

    lines += [
        f"| Severity | Count |",
        f"|---|---|",
        f"| 🔴 CRITICAL | {len(criticals)} |",
        f"| 🟠 MAJOR | {len(majors)} |",
        f"| 🟡 MINOR | {len(minors)} |",
        f"| ⚪ COSMETIC | {len(cosmetics)} |",
        f"| ✅ PASS | {sum(1 for r in results if all(f['sev'] == 'PASS' for f in r['findings']))} |",
        "\n---\n",
        "## Per-Viewport Results\n",
        "| Viewport | Size | Category | Findings |",
        "|---|---|---|---|",
    ]

    for r in results:
        vp = r["vp"]
        fs = r["findings"]
        worst = next((f["sev"] for f in fs if f["sev"] != "PASS"), "PASS")
        sev_icon = {"CRITICAL": "🔴", "MAJOR": "🟠", "MINOR": "🟡", "COSMETIC": "⚪", "PASS": "✅"}.get(worst, "✅")
        summary = "; ".join(f["msg"] for f in fs if f["sev"] != "PASS") or "All checks passed"
        lines.append(f"| {vp['name']} | {vp['w']}×{vp['h']} | {vp['cat']} | {sev_icon} {summary} |")

    lines += ["\n---\n", "## All Issues Found\n"]
    if not all_findings:
        lines.append("No issues found across all viewports. ✅\n")
    else:
        for r in results:
            vp = r["vp"]
            issues = [f for f in r["findings"] if f["sev"] != "PASS"]
            if issues:
                lines.append(f"### {vp['name']} ({vp['w']}×{vp['h']})\n")
                for f in issues:
                    icon = {"CRITICAL": "🔴", "MAJOR": "🟠", "MINOR": "🟡", "COSMETIC": "⚪"}.get(f["sev"], "⚪")
                    lines.append(f"- {icon} **{f['sev']}**: {f['msg']}")
                lines.append("")

    lines += [
        "\n---\n",
        "## Screenshots\n",
        f"Screenshots saved to: `{SCREENSHOTS_DIR}`\n",
    ]
    for r in results:
        if r["screenshot"]:
            lines.append(f"- `{r['screenshot'].name}` — {r['vp']['name']} {r['vp']['w']}×{r['vp']['h']}")

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nReport written to {REPORT_PATH}")
    print(f"CRITICAL: {len(criticals)}  MAJOR: {len(majors)}  MINOR: {len(minors)}")

asyncio.run(main())
