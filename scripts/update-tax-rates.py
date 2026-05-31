#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
update_rates.py — 抓取 TaxTips.ca 的「联邦+省合并边际税率」并改写
tax_calculator.html 中 TAX_DATA_START / TAX_DATA_END 之间的内嵌数据块。

仅用 Python 标准库（urllib + re），无需 pip install。

用法:
    python update_rates.py                 # 抓取当前自然年, 校验通过后改写 HTML
    python update_rates.py --year 2026      # 指定年份
    python update_rates.py --dry-run        # 只打印解析结果, 不写文件
    python update_rates.py --file path.html # 指定目标 HTML

说明:
  - 抓取 ab.htm / bc.htm / on.htm 三页的「Combined Federal & XX Tax Brackets
    ... Including Surtaxes」表, 取目标年的 "Other Income" 与 "Eligible" 股息两列。
  - 资本利得在页面端由普通收入税率 × 计入比例(默认 0.5)派生, 故此处不写入。
  - 任一校验失败则中止且不改写, 打印错误。改写前会自动备份 .bak。
"""
import argparse
import datetime
import json
import re
import shutil
import sys
import urllib.request

PROVS = ["AB", "BC", "ON"]
BASE = "https://www.taxtips.ca/taxrates/{}.htm"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# 各省最高合并边际率(普通收入)的预期值, 用于校验 (允许 ±2.5)
EXPECTED_TOP = {"AB": 48.0, "BC": 53.5, "ON": 53.53}


def fetch(prov: str) -> str:
    url = BASE.format(prov.lower())
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).strip()


def parse_threshold(text: str):
    """ 'first $53,891' -> 53891 ; 'over $A up to $B' -> B ; 'over $Z' -> None """
    nums = re.findall(r"\$([\d,]+)", text)
    nums = [int(n.replace(",", "")) for n in nums]
    low = text.lower()
    if low.startswith("first") and nums:
        return nums[0]
    if "up to" in low and nums:
        return nums[-1]
    if low.startswith("over") and nums:        # 'over $Z' 无上限 = 最高阶
        return None
    return nums[-1] if nums else None


def parse_rate(text: str):
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*%", text)
    return float(m.group(1)) if m else None


def find_combined_table(html: str):
    tables = re.findall(r"<table.*?</table>", html, re.S | re.I)
    for t in tables:
        head = strip_tags(t)[:300].lower()
        if "combined federal" in head and "marginal tax rates" in head:
            return t
    raise RuntimeError("未找到 'Combined Federal ... Marginal Tax Rates' 表")


def parse_province(html: str, year: int):
    """返回 (otherIncome[], eligibleDividend[])，每项 {upTo, rate}。"""
    table = find_combined_table(html)
    rows = re.findall(r"<tr.*?</tr>", table, re.S | re.I)
    parsed_rows = []
    for r in rows:
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S | re.I)
        parsed_rows.append([strip_tags(c) for c in cells])

    # 定位年份块: 含 4 个单元、其中有 '<year> Taxable Income' 的表头行
    offset = None
    for cells in parsed_rows:
        if len(cells) == 4 and any(f"{year} Taxable Income" in c for c in cells):
            idx = next(i for i, c in enumerate(cells) if f"{year} Taxable Income" in c)
            offset = 0 if idx == 0 else 5
            break
    if offset is None:
        raise RuntimeError(f"未在表头找到 {year} 年份列")

    other, elig = [], []
    for cells in parsed_rows:
        # 数据行: 10 列, 首列是收入区间
        if len(cells) != 10:
            continue
        income_txt = cells[offset]
        if not re.search(r"\$\d", income_txt):
            continue
        upTo = parse_threshold(income_txt)
        o_rate = parse_rate(cells[offset + 1])      # Other Income
        d_rate = parse_rate(cells[offset + 3])      # Canadian Dividends - Eligible
        if o_rate is None or d_rate is None:
            continue
        other.append({"upTo": upTo, "rate": o_rate})
        elig.append({"upTo": upTo, "rate": d_rate})
    return other, elig


def validate(prov: str, other, elig):
    errs = []
    if not (5 <= len(other) <= 16):
        errs.append(f"{prov}: 普通收入阶数异常 ({len(other)})")
    # 门槛升序, 仅最后一项可为 None
    ths = [b["upTo"] for b in other]
    if None in ths[:-1]:
        errs.append(f"{prov}: 中间阶出现无上限")
    if ths[-1] is not None:
        errs.append(f"{prov}: 最高阶应为无上限(None)")
    finite = [t for t in ths if t is not None]
    if finite != sorted(finite):
        errs.append(f"{prov}: 门槛非升序")
    # 普通收入税率范围与单调
    orates = [b["rate"] for b in other]
    if any(not (0 <= r <= 60) for r in orates):
        errs.append(f"{prov}: 普通收入税率超出 0–60% 区间")
    if orates != sorted(orates):
        errs.append(f"{prov}: 普通收入边际率非递增")
    top = orates[-1]
    exp = EXPECTED_TOP[prov]
    if abs(top - exp) > 2.5:
        errs.append(f"{prov}: 最高边际率 {top}% 与预期 {exp}% 偏差过大")
    # 股息率范围
    if any(not (-20 <= b["rate"] <= 50) for b in elig):
        errs.append(f"{prov}: 股息边际率超出 -20–50% 区间")
    if len(elig) != len(other):
        errs.append(f"{prov}: 股息与普通收入阶数不一致")
    return errs


def js_brackets(arr) -> str:
    items = []
    for b in arr:
        up = "null" if b["upTo"] is None else str(b["upTo"])
        items.append(f'{{upTo:{up},rate:{b["rate"]}}}')
    return "[" + ",".join(items) + "]"


def build_block(year, fetched, other_by_prov, elig_by_prov) -> str:
    def prov_map(d):
        return "\n".join(f"    {p}:{js_brackets(d[p])}" + ("," if p != PROVS[-1] else "")
                         for p in PROVS)
    return (
        "/* TAX_DATA_START — 由 update_rates.py 自动生成，请勿手动修改此块 */\n"
        "const TAX_DATA = {\n"
        f'  year: {year},\n'
        '  source: "taxtips.ca",\n'
        f'  fetched: "{fetched}",\n'
        "  inclusionRate: 0.5,\n"
        "  otherIncome: {\n" + prov_map(other_by_prov) + "\n  },\n"
        "  eligibleDividend: {\n" + prov_map(elig_by_prov) + "\n  }\n"
        "};\n"
        "/* TAX_DATA_END */"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=datetime.date.today().year)
    ap.add_argument("--file", default="investment_tax_calculator.html")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    other_by_prov, elig_by_prov, all_errs = {}, {}, []
    for p in PROVS:
        try:
            html = fetch(p)
            other, elig = parse_province(html, args.year)
        except Exception as e:                       # noqa: BLE001
            print(f"[抓取/解析失败] {p}: {e}")
            sys.exit(2)
        errs = validate(p, other, elig)
        all_errs += errs
        other_by_prov[p], elig_by_prov[p] = other, elig
        print(f"\n=== {p} ({args.year}) 普通收入 ===")
        for b in other:
            print(f"  ≤{b['upTo'] if b['upTo'] is not None else '∞':>9}  {b['rate']:>6}%")
        print(f"--- {p} 合资格股息 ---")
        for b in elig:
            print(f"  ≤{b['upTo'] if b['upTo'] is not None else '∞':>9}  {b['rate']:>6}%")

    if all_errs:
        print("\n[校验失败，未改写文件]")
        for e in all_errs:
            print("  - " + e)
        sys.exit(3)
    print("\n[校验通过]")

    fetched = datetime.date.today().isoformat()
    block = build_block(args.year, fetched, other_by_prov, elig_by_prov)

    if args.dry_run:
        print("\n--- DRY RUN: 将写入的数据块 ---\n")
        print(block)
        return

    with open(args.file, encoding="utf-8") as f:
        content = f.read()
    pattern = re.compile(r"/\* TAX_DATA_START.*?TAX_DATA_END \*/", re.S)
    if not pattern.search(content):
        print(f"[错误] 在 {args.file} 未找到 TAX_DATA_START/END 标记")
        sys.exit(4)
    shutil.copy(args.file, args.file + ".bak")
    new_content = pattern.sub(lambda _: block.replace("\\", "\\\\"), content)
    with open(args.file, "w", encoding="utf-8") as f:
        f.write(new_content)
    print(f"[已更新] {args.file} (备份: {args.file}.bak) — 年度 {args.year}, 抓取日 {fetched}")


if __name__ == "__main__":
    main()
