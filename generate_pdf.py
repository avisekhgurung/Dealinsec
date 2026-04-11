from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.units import inch, mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER
import os

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "InfluDeal_Product_Overview.pdf")

# Colors
PRIMARY = HexColor("#1a1a2e")
ACCENT = HexColor("#e94560")
LIGHT_BG = HexColor("#f5f5f5")
WHITE = HexColor("#ffffff")
DARK_TEXT = HexColor("#222222")
GRAY_TEXT = HexColor("#666666")
TABLE_HEADER_BG = HexColor("#1a1a2e")
TABLE_ALT_BG = HexColor("#f0f0f5")

def build_pdf():
    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=A4,
        rightMargin=50,
        leftMargin=50,
        topMargin=50,
        bottomMargin=50,
    )

    styles = getSampleStyleSheet()

    # Custom styles
    styles.add(ParagraphStyle(
        name="DocTitle",
        fontSize=28,
        leading=34,
        textColor=PRIMARY,
        fontName="Helvetica-Bold",
        alignment=TA_CENTER,
        spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name="DocSubtitle",
        fontSize=13,
        leading=18,
        textColor=GRAY_TEXT,
        fontName="Helvetica",
        alignment=TA_CENTER,
        spaceAfter=30,
    ))
    styles.add(ParagraphStyle(
        name="SectionHead",
        fontSize=18,
        leading=24,
        textColor=ACCENT,
        fontName="Helvetica-Bold",
        spaceBefore=24,
        spaceAfter=10,
    ))
    styles.add(ParagraphStyle(
        name="SubHead",
        fontSize=13,
        leading=18,
        textColor=PRIMARY,
        fontName="Helvetica-Bold",
        spaceBefore=14,
        spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name="Body",
        fontSize=10.5,
        leading=16,
        textColor=DARK_TEXT,
        fontName="Helvetica",
        spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name="BulletItem",
        fontSize=10.5,
        leading=16,
        textColor=DARK_TEXT,
        fontName="Helvetica",
        leftIndent=20,
        spaceAfter=4,
        bulletIndent=8,
    ))
    styles.add(ParagraphStyle(
        name="SmallNote",
        fontSize=9,
        leading=13,
        textColor=GRAY_TEXT,
        fontName="Helvetica-Oblique",
        spaceAfter=4,
    ))

    story = []

    # ---- TITLE ----
    story.append(Spacer(1, 60))
    story.append(Paragraph("InfluDeal", styles["DocTitle"]))
    story.append(Paragraph("Deal &amp; Contract Management Platform for Influencers &amp; Brands", styles["DocSubtitle"]))
    story.append(HRFlowable(width="60%", thickness=2, color=ACCENT, spaceAfter=20, spaceBefore=10))
    story.append(Paragraph("Product Overview Document", styles["Body"]))
    story.append(Spacer(1, 10))
    story.append(Paragraph("Built for the Indian Creator Economy", styles["SmallNote"]))
    story.append(PageBreak())

    # ---- WHAT IS INFLUDEAL ----
    story.append(Paragraph("What is InfluDeal?", styles["SectionHead"]))
    story.append(Paragraph(
        "InfluDeal is a professional deal and contract management platform designed for "
        "influencers and brands in India. It enables influencers to create, track, and manage "
        "brand deals with legally-binding exclusive contracts, handle payments through an automated "
        "invoice system, and purchase contract credits via PayU integration.",
        styles["Body"]
    ))
    story.append(Paragraph(
        "Brands can view deals assigned to them by influencers, upload proof of contract signing, "
        "generate their own invoices, and export professional contract PDFs.",
        styles["Body"]
    ))
    story.append(Spacer(1, 10))

    # Key highlights
    story.append(Paragraph("Key Highlights", styles["SubHead"]))
    highlights = [
        "Two-sided marketplace: Influencers and Brands",
        "Exclusive contract management with digital signatures",
        "Automated invoice generation with platform fees",
        "Credit-based system for contract creation",
        "Indian tax compliance (PAN, GST, INR)",
        "Mobile-first responsive design",
    ]
    for h in highlights:
        story.append(Paragraph(f"<bullet>&bull;</bullet> {h}", styles["BulletItem"]))

    # ---- TWO ROLES ----
    story.append(Spacer(1, 10))
    story.append(Paragraph("User Roles", styles["SectionHead"]))
    story.append(Paragraph(
        "The platform supports two distinct user roles, each with a different set of capabilities:",
        styles["Body"]
    ))

    role_data = [
        ["Feature", "Influencer (Default)", "Brand"],
        ["Signs up as", "Default on signup", "Selected during onboarding"],
        ["Can create deals", "Yes", "No"],
        ["Can sign contracts", "Yes (spends 1 credit)", "Yes (uploads proof)"],
        ["Invoice creation", "Auto-generated", "Can create brand invoices"],
        ["Pays platform fee", "Yes (Rs.999/contract)", "No"],
        ["Starting credits", "3 free credits", "N/A"],
    ]
    role_table = Table(role_data, colWidths=[140, 170, 170])
    role_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("LEADING", (0, 0), (-1, -1), 14),
        ("BACKGROUND", (0, 1), (-1, -1), WHITE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, TABLE_ALT_BG]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cccccc")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(role_table)

    # ---- INFLUENCER JOURNEY ----
    story.append(PageBreak())
    story.append(Paragraph("Influencer Journey", styles["SectionHead"]))

    # Step 1
    story.append(Paragraph("Step 1: Signup &amp; Onboarding", styles["SubHead"]))
    story.append(Paragraph(
        "New users sign up with email and password. Every new account receives 3 free contract credits. "
        "After signup, the onboarding flow collects:",
        styles["Body"]
    ))
    onboard_items = [
        "Full Name and Phone Number (Indian 10-digit validation)",
        "PAN Number (mandatory, format: ABCDE1234F)",
        "GST Number (optional)",
        "Digital Signature (image upload - JPG/PNG, required for contracts)",
    ]
    for item in onboard_items:
        story.append(Paragraph(f"<bullet>&bull;</bullet> {item}", styles["BulletItem"]))

    # Step 2
    story.append(Paragraph("Step 2: Dashboard", styles["SubHead"]))
    story.append(Paragraph(
        "The influencer dashboard shows three key stats: Active Deals count, Signed Contracts count, "
        "and Paid Invoices count. It also displays recent deals and a floating 'Create Deal' button.",
        styles["Body"]
    ))

    # Step 3
    story.append(Paragraph("Step 3: Create a Deal", styles["SubHead"]))
    story.append(Paragraph("The influencer fills out a deal form with:", styles["Body"]))
    deal_items = [
        "Brand Name, Deal Title, and Deal Amount (in Rs.)",
        "Start Date and End Date",
        "Optional: Assign a registered Brand user to the deal",
        "One or more Deliverables, each specifying:",
    ]
    for item in deal_items:
        story.append(Paragraph(f"<bullet>&bull;</bullet> {item}", styles["BulletItem"]))

    deliverable_fields = [
        "Platform: Instagram / YouTube / Twitter",
        "Content Type: Reel / Video / Story / Post",
        "Quantity and Frequency: Per Week / Per Month / One-time",
    ]
    for item in deliverable_fields:
        story.append(Paragraph(f"<bullet>  -</bullet> {item}", styles["BulletItem"]))

    # Step 4
    story.append(Paragraph("Step 4: Sign Contract (Costs 1 Credit)", styles["SubHead"]))
    story.append(Paragraph(
        "When the influencer is ready, they confirm the deal and sign an exclusive contract. "
        "This requires at least 1 contract credit. The system automatically:",
        styles["Body"]
    ))
    sign_items = [
        "Creates a Contract record (signed by influencer, status: Signed)",
        "Generates an Invoice (Rs.499 contract fee + Rs.500 platform fee = Rs.999 total)",
        "Deducts 1 credit from the influencer's balance",
    ]
    for item in sign_items:
        story.append(Paragraph(f"<bullet>&bull;</bullet> {item}", styles["BulletItem"]))
    story.append(Paragraph(
        "If the influencer has no credits, they are directed to the Pricing page to purchase more.",
        styles["SmallNote"]
    ))

    # Step 5
    story.append(Paragraph("Step 5: Pay Invoice via Stripe", styles["SubHead"]))
    story.append(Paragraph(
        "Each contract generates a Rs.999 invoice. The influencer pays via Stripe Checkout. "
        "On successful payment, the invoice status changes to 'Paid' and the contract becomes 'Active'.",
        styles["Body"]
    ))

    # Step 6
    story.append(Paragraph("Step 6: Contract PDF Export", styles["SubHead"]))
    story.append(Paragraph(
        "A professional 'Influencer Marketing Agreement' PDF can be generated for any contract. "
        "It includes both parties' details, deliverables, compensation terms, exclusivity clauses, "
        "and effective dates. Exported using browser print-to-PDF.",
        styles["Body"]
    ))

    # ---- BRAND JOURNEY ----
    story.append(PageBreak())
    story.append(Paragraph("Brand Journey", styles["SectionHead"]))

    brand_steps = [
        ("1. Get Assigned to a Deal",
         "When an influencer creates a deal and selects a brand user, the deal appears on the brand's dashboard."),
        ("2. View Dashboard",
         "Brand dashboard shows Active Deals and Active Contracts stats, plus recent deals assigned by influencers."),
        ("3. View Deal Details",
         "Brand can see full deal info including deliverables, amount, dates - but cannot edit or create deals."),
        ("4. Upload Contract Proof",
         "Brand uploads a signed contract document (PDF/JPG/PNG, max 5MB) as proof of agreement."),
        ("5. Create Brand Invoice",
         "Brand can generate their own invoices (BINV-xxx format) for record-keeping and sending to influencers."),
        ("6. Export Contract PDF",
         "Brand can export the same professional agreement document for their records."),
    ]
    for title, desc in brand_steps:
        story.append(Paragraph(title, styles["SubHead"]))
        story.append(Paragraph(desc, styles["Body"]))

    # ---- CREDIT SYSTEM ----
    story.append(Spacer(1, 10))
    story.append(Paragraph("Credit System &amp; Payments", styles["SectionHead"]))

    credit_data = [
        ["Item", "Price", "Payment Method"],
        ["Signing a contract", "1 credit", "Deducted from balance"],
        ["Starting credits (on signup)", "3 free", "Automatic"],
        ["Buy more credits", "Rs.299 / credit", "PayU gateway"],
        ["Platform fee per contract", "Rs.999", "Stripe Checkout"],
    ]
    credit_table = Table(credit_data, colWidths=[180, 130, 170])
    credit_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("LEADING", (0, 0), (-1, -1), 14),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, TABLE_ALT_BG]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cccccc")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(credit_table)

    story.append(Spacer(1, 10))
    story.append(Paragraph("Credit Transaction Types", styles["SubHead"]))
    tx_types = [
        "<b>grant</b> - Free credits given on signup (3 credits)",
        "<b>purchase</b> - Credits bought via PayU payment",
        "<b>usage</b> - Credit spent when signing a contract (-1)",
        "<b>refund</b> - Credit returned (if applicable)",
    ]
    for t in tx_types:
        story.append(Paragraph(f"<bullet>&bull;</bullet> {t}", styles["BulletItem"]))

    # ---- DATA FLOW ----
    story.append(Spacer(1, 10))
    story.append(Paragraph("Data Flow", styles["SectionHead"]))
    story.append(Paragraph(
        "The core data relationship flows as follows:",
        styles["Body"]
    ))

    flow_data = [
        ["Entity", "Created By", "Key Fields"],
        ["Deal", "Influencer", "Brand name, title, amount, dates, deliverables"],
        ["Contract", "System (on signing)", "Linked to deal, exclusive terms, signatures"],
        ["Invoice (INV-xxx)", "System (auto)", "Rs.999 platform fee, paid via Stripe"],
        ["Brand Invoice (BINV-xxx)", "Brand", "Deal amount, for brand's records"],
        ["Credit Transaction", "System", "Tracks all credit changes (+/-)"],
        ["PayU Order", "System", "Tracks credit purchase payments"],
    ]
    flow_table = Table(flow_data, colWidths=[130, 110, 240])
    flow_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("LEADING", (0, 0), (-1, -1), 14),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, TABLE_ALT_BG]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cccccc")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(flow_table)

    story.append(Spacer(1, 10))
    story.append(Paragraph("Simplified Flow:", styles["SubHead"]))
    story.append(Paragraph(
        "Deal (by influencer) --> Contract (signed by both) --> Invoice (Rs.999, paid via Stripe) "
        "+ Brand Invoice (by brand for their records)",
        styles["Body"]
    ))

    # ---- INDIA FEATURES ----
    story.append(PageBreak())
    story.append(Paragraph("India-Specific Features", styles["SectionHead"]))
    india_items = [
        "<b>PAN Number</b> - Required during onboarding for tax invoicing (format: ABCDE1234F)",
        "<b>GST Number</b> - Optional but supported for businesses (max 15 chars)",
        "<b>All amounts in INR (Rs.)</b> - Platform fees, deal amounts, credit prices",
        "<b>PayU Integration</b> - Indian payment gateway for purchasing credits",
        "<b>Indian Phone Validation</b> - 10-digit mobile number format",
        "<b>Date Format</b> - DD MMM YYYY (Indian standard)",
    ]
    for item in india_items:
        story.append(Paragraph(f"<bullet>&bull;</bullet> {item}", styles["BulletItem"]))

    # ---- TECH STACK ----
    story.append(Spacer(1, 10))
    story.append(Paragraph("Tech Stack", styles["SectionHead"]))

    tech_data = [
        ["Layer", "Technology"],
        ["Frontend", "React 18 + TypeScript + Vite"],
        ["UI Library", "shadcn/ui + Tailwind CSS + Radix UI"],
        ["Routing", "Wouter (lightweight React router)"],
        ["State Management", "TanStack React Query"],
        ["Backend", "Express.js + TypeScript"],
        ["Database", "PostgreSQL (hosted on Neon)"],
        ["ORM", "Drizzle ORM + Drizzle Kit"],
        ["Auth", "Email/Password + bcrypt + express-session"],
        ["Payments", "Stripe (invoices) + PayU (credits)"],
        ["File Uploads", "Multer (signatures, contract proofs)"],
        ["Animations", "Framer Motion"],
        ["Design", "Mobile-first, bottom navigation"],
    ]
    tech_table = Table(tech_data, colWidths=[140, 340])
    tech_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("LEADING", (0, 0), (-1, -1), 14),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, TABLE_ALT_BG]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cccccc")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(tech_table)

    # ---- API ENDPOINTS ----
    story.append(Spacer(1, 10))
    story.append(Paragraph("API Endpoints Summary", styles["SectionHead"]))

    api_data = [
        ["Category", "Endpoints"],
        ["Auth", "POST /api/auth/signup, /login, /logout\nGET /api/auth/user"],
        ["Deals", "GET /api/deals, /api/deals/:id\nPOST /api/deals\nGET /api/brand/deals"],
        ["Contracts", "GET /api/contracts, /api/contracts/:id\nPOST /api/contracts\nPOST /api/contracts/:id/proof\nGET /api/brand/contracts"],
        ["Invoices", "GET /api/invoices, /api/invoices/:id\nPOST /api/invoices/:id/pay\nPOST /api/invoices/:id/confirm-payment"],
        ["Brand Invoices", "GET/POST /api/brand-invoices\nGET/PATCH /api/brand-invoices/:id"],
        ["Profile", "PATCH /api/profile\nPOST /api/profile/signature"],
        ["Credits", "GET /api/credits/balance"],
        ["Payments", "POST /api/payments/create\nPOST /api/payments/success, /failure"],
    ]
    api_table = Table(api_data, colWidths=[100, 380])
    api_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("LEADING", (0, 0), (-1, -1), 13),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, TABLE_ALT_BG]),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cccccc")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(api_table)

    # ---- FOOTER ----
    story.append(Spacer(1, 30))
    story.append(HRFlowable(width="100%", thickness=1, color=HexColor("#cccccc"), spaceAfter=10))
    story.append(Paragraph(
        "InfluDeal - Product Overview | Confidential",
        styles["SmallNote"]
    ))

    # Build
    doc.build(story)
    print(f"PDF generated: {OUTPUT_PATH}")

if __name__ == "__main__":
    build_pdf()
