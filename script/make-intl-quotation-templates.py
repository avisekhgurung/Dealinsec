#!/usr/bin/env python3
"""
Builds the international quotation templates from the Indian ones.

    python3 script/make-intl-quotation-templates.py

client/public/templates/ holds India-shaped downloads (₹, GSTIN, lakh
grouping, "Rupees … Only"). The international copies keep every style, table
and formula and change only the words: no currency symbol baked in, a
"Currency" line instead of amount in words, a generic tax row (VAT, GST or
sales tax) and a postcode/country address. The GST template has no
international twin — it is an Indian document by design.

Standard library only (the .docx/.xlsx are zip files of XML). Every
replacement must match exactly the number of times listed, so a template
edited upstream fails loudly here instead of shipping half-converted.
"""
import os
import sys
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "client", "public", "templates")

COMMON_DOCX = [
    ("[Address line, City, State, PIN]", "[Street address, City, Postcode, Country]", 1),
    ("Date: [DD/MM/YYYY]", "Date: [date]", 1),
    ("Valid until: [DD/MM/YYYY]", "Valid until: [date]", 1),
    ("Rate (₹)", "Rate", 1),
    ("Amount (₹)", "Amount", 1),
    ("Amount in words: ", "Currency: ", 1),
    ("[Rupees ______________________________ Only]", "[e.g. USD — US Dollars]", 1),
    ("Authorised Signatory", "Signature &amp; date", 1),
]

JOBS = {
    "quotation-format-simple.docx": (
        "quotation-format-simple-intl.docx",
        {
            "word/document.xml": COMMON_DOCX + [
                (">1,05,000<", ">105,000<", 1),
                ("₹ 1,05,000", "105,000", 1),
                (
                    "Prices are exclusive of GST and of any work not listed above.",
                    "Prices exclude applicable taxes (VAT, GST or sales tax) and any work not listed above.",
                    1,
                ),
            ],
        },
    ),
    "quotation-format-freelancer.docx": (
        "quotation-format-freelancer-intl.docx",
        {
            "word/document.xml": COMMON_DOCX + [
                ("₹ 65,000", "65,000", 1),
                ("[₹___]", "[amount]", 1),
            ],
        },
    ),
    "quotation-format-excel.xlsx": (
        "quotation-format-excel-intl.xlsx",
        {
            "xl/worksheets/sheet1.xml": [
                ("[Address, City, State, PIN]", "[Address, City, Postcode, Country]", 1),
                (
                    "GSTIN: [Your GSTIN — remove this row if not registered]",
                    "Tax ID: [VAT / GST / tax number — remove this row if not registered]",
                    1,
                ),
                ("Date: [DD/MM/YYYY]", "Date: [date]", 1),
                ("Valid until: [DD/MM/YYYY]", "Valid until: [date]", 1),
                ("Rate (₹)", "Rate", 1),
                ("Amount (₹)", "Amount", 1),
                ("GST rate (0 if not applicable)", "Tax rate — VAT, GST or sales tax (0 if none)", 1),
                ("GST amount", "Tax amount", 1),
                (
                    "Amount in words: [Rupees ______________________________ Only]",
                    "Currency: [e.g. USD, GBP, EUR]",
                    1,
                ),
                (
                    "4. GST as applicable — the tax invoice raised on completion is the tax document.",
                    "4. Tax as applicable — the invoice raised on completion is the tax document.",
                    1,
                ),
                ("Authorised Signatory", "Signature &amp; date", 1),
                # India's 18% GST was pre-filled. Nobody else's rate is known
                # to us, so the international sheet starts with no tax.
                ('<c r="E20" s="14" t="n"><v>0.18</v></c>', '<c r="E20" s="14" t="n"><v>0</v></c>', 1),
            ],
            # The amount cells carried a rupee number format.
            "xl/styles.xml": [('formatCode="₹ #,##0.00"', 'formatCode="#,##0.00"', 1)],
        },
    ),
}

# Nothing India-only may survive in a converted part.
FORBIDDEN = ["₹", "GSTIN", "Rupees", "PIN]", "DD/MM/YYYY", "Authorised Signatory"]


def convert(src_name, dst_name, edits):
    src = os.path.join(ROOT, src_name)
    dst = os.path.join(ROOT, dst_name)
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename in edits:
                text = data.decode("utf-8")
                for old, new, count in edits[info.filename]:
                    found = text.count(old)
                    if found != count:
                        sys.exit(f"{src_name}:{info.filename}: expected {count}× {old!r}, found {found}")
                    text = text.replace(old, new)
                for bad in FORBIDDEN:
                    if bad in text:
                        sys.exit(f"{dst_name}:{info.filename}: still contains {bad!r}")
                data = text.encode("utf-8")
            # Same entry order and compression as the source, so Word and Excel
            # read the copy exactly as they read the original.
            zout.writestr(info, data, compress_type=info.compress_type)
    print(f"wrote {os.path.relpath(dst)}")


if __name__ == "__main__":
    for src_name, (dst_name, edits) in JOBS.items():
        convert(src_name, dst_name, edits)
