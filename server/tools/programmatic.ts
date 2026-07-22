/**
 * Programmatic long-tail SEO pages: "{Profession} Invoice Format".
 *
 * One page per profession, each carrying REAL India-specific value (correct SAC
 * code, GST rate, profession-specific sample line items and FAQ) so they are
 * genuine destinations, not thin doorway pages. Each funnels into the GST
 * Invoice Generator, pre-seeded with that profession's typical line items.
 *
 * PROFESSION_SPECS is generated + SAC-fact-checked by a workflow.
 */
import type { Express } from "express";
import { renderToolPage, SITE_ORIGIN, esc } from "./layout";

export interface ProfessionSpec {
  slug: string;
  name: string; // "Photography"
  who: string; // "a photographer / photography studio"
  sacCode: string;
  sacDescription: string;
  gstRate: number;
  intro: string;
  sampleItems: { desc: string; unit: string; typicalRate: number }[];
  paymentNorm: string;
  faq: { q: string; a: string }[];
  metaDescription: string;
}

const PATH_PREFIX = "/tools/invoice-format/for-";

// Filled from the generate+verify workflow (SAC codes fact-checked).
export const PROFESSION_SPECS: ProfessionSpec[] = [
  {
    "slug": "photographers",
    "name": "Photography",
    "who": "a photographer / photography studio",
    "sacCode": "998383",
    "sacDescription": "Event photography & videography services",
    "gstRate": 18,
    "intro": "A photographer's invoice in India should clearly list the shoot (wedding, event, portrait, product) with the SAC code 998383 for event photography and videography, so clients and their accountants can claim input tax credit. Because most bookings run on an advance-plus-balance model, your invoice must show the advance already received, the balance due, and 18% GST split as CGST+SGST (same state) or IGST (out-of-state client). Itemising deliverables like edited photos, albums and drone coverage separately keeps the bill transparent and reduces disputes at delivery.",
    "sampleItems": [
      {
        "desc": "Wedding day photography coverage (full day, 2 photographers)",
        "unit": "per day",
        "typicalRate": 35000
      },
      {
        "desc": "Candid + traditional videography with edited highlight film",
        "unit": "per day",
        "typicalRate": 40000
      },
      {
        "desc": "Pre-wedding / engagement shoot (half day, one location)",
        "unit": "per project",
        "typicalRate": 20000
      },
      {
        "desc": "Premium printed photo album (30 sheets, leather cover)",
        "unit": "per album",
        "typicalRate": 12000
      },
      {
        "desc": "Drone / aerial coverage add-on",
        "unit": "per day",
        "typicalRate": 10000
      },
      {
        "desc": "Product / e-commerce studio photography",
        "unit": "per image",
        "typicalRate": 250
      }
    ],
    "paymentNorm": "Photographers typically collect a 30-50% non-refundable advance to block the date, with the balance due before final delivery of edited photos, albums and films; wedding bookings are often confirmed months ahead against this advance.",
    "faq": [
      {
        "q": "Which SAC code should a wedding or event photographer use on the invoice?",
        "a": "Use SAC 998383, 'Event photography and event videography services', which covers weddings, functions and event shoots. Portrait/studio work falls under 998381, advertising shoots under 998382, and photo/video processing under 998386 - but for wedding and event bookings, 998383 is the correct code and all of them are taxed at 18% GST."
      },
      {
        "q": "Do I need to charge GST on the advance/booking amount I take to block a date?",
        "a": "Yes. Under GST, tax is payable on advances received for services. When you collect a booking advance you should issue a receipt voucher and pay 18% GST on that advance in the same month; the final invoice then shows the total, the GST, and adjusts the advance already received against the balance."
      },
      {
        "q": "Should I show CGST+SGST or IGST when a client is from another state?",
        "a": "For photography the place of supply is usually where the service is performed. If your studio and the client are in the same state, split the 18% as 9% CGST + 9% SGST. If you travel to shoot an event in another state or bill an out-of-state client, charge 18% IGST instead - getting this wrong is the most common mistake on photographers' invoices."
      },
      {
        "q": "Do I need GST registration as a freelance photographer?",
        "a": "GST registration is mandatory once your annual turnover crosses Rs. 20 lakh (Rs. 10 lakh in some special-category states). Below that you can invoice without charging GST, but many corporate and wedding-planner clients prefer a GST invoice so they can claim input tax credit, so voluntary registration is common for full-time photographers."
      }
    ],
    "metaDescription": "Photography invoice format for India with the correct SAC code 998383, 18% GST, advance/booking terms, and real sample line items for wedding, event and studio shoots."
  },
  {
    "slug": "graphic-designers",
    "name": "Graphic Design",
    "who": "a freelance graphic designer",
    "sacCode": "998391",
    "sacDescription": "Specialty design services including interior design, fashion design, industrial design, graphic design and other specialty design services",
    "gstRate": 18,
    "intro": "A graphic designer's invoice in India should clearly list each deliverable (logo, brand kit, social media creatives, etc.), the number of revisions or concepts included, and — if you are GST-registered — the SAC code 998391 with 18% GST split as CGST+SGST (same state) or IGST (other state / export). Since most design work starts with an advance, your invoice should also show any advance already received and the balance due. Even if you are below the ₹20 lakh registration threshold and cannot charge GST, a well-structured invoice with clear scope and revision limits protects you from unpaid scope-creep.",
    "sampleItems": [
      {
        "desc": "Logo design (3 initial concepts, 2 revisions)",
        "unit": "per project",
        "typicalRate": 8000
      },
      {
        "desc": "Complete brand identity kit (logo, colours, typography, guidelines)",
        "unit": "per project",
        "typicalRate": 30000
      },
      {
        "desc": "Social media creative pack (set of 12 posts)",
        "unit": "per pack",
        "typicalRate": 6000
      },
      {
        "desc": "Brochure / catalogue design",
        "unit": "per page",
        "typicalRate": 1200
      },
      {
        "desc": "Packaging / label design",
        "unit": "per SKU",
        "typicalRate": 5000
      },
      {
        "desc": "Additional revision beyond included rounds",
        "unit": "per revision",
        "typicalRate": 750
      }
    ],
    "paymentNorm": "Freelance designers typically take a 40-50% advance before starting and the balance on delivery of final files; monthly retainers for social media creatives are usually invoiced in advance at the start of each month.",
    "faq": [
      {
        "q": "Which SAC code should a graphic designer put on a GST invoice?",
        "a": "Use SAC 998391 — Specialty design services including graphic design — which attracts 18% GST. You only need to print a SAC code once you are GST-registered (turnover above ₹20 lakh, or ₹10 lakh in special-category states); below that you raise a plain bill of supply without GST or SAC."
      },
      {
        "q": "Do I charge GST when the final output is just a digital file like a PNG or PDF?",
        "a": "Yes. GST applies to the design service you provide, not to the format of the deliverable. Whether you hand over an editable AI file, a print-ready PDF or a PNG, the 18% GST under SAC 998391 is the same if you are registered."
      },
      {
        "q": "How do I show the advance I already collected on the final invoice?",
        "a": "List the full value of the work, apply 18% GST on it, then show the advance received as a deduction so only the balance is payable. If you issued a GST receipt voucher when taking the advance, reference it so the tax is not double-counted."
      },
      {
        "q": "A foreign client hired me — do I add 18% GST?",
        "a": "Exports of design services are zero-rated. If you are registered and file a LUT (Letter of Undertaking), you can invoice the overseas client without charging GST; without a LUT you must pay IGST and claim a refund. Mention 'Export of services under LUT — GST not charged' on the invoice."
      }
    ],
    "metaDescription": "Free graphic designer invoice format for India with the correct SAC code 998391, 18% GST, sample line items, advance/revision handling and India-specific FAQs."
  },
  {
    "slug": "web-developers",
    "name": "Web Development",
    "who": "a freelance web / software developer",
    "sacCode": "998314",
    "sacDescription": "Information technology (IT) design and development services",
    "gstRate": 18,
    "intro": "A web developer's invoice in India should clearly list each service (design, front-end/back-end development, integrations, maintenance) under SAC code 998314 so clients can claim input tax credit, and add 18% GST split as CGST+SGST for same-state clients or IGST for out-of-state ones. Because most projects run on milestones, your invoice should also show any advance already received and the balance due, along with your PAN and GSTIN (mandatory once turnover crosses the registration threshold). For overseas clients, a developer registered under GST can raise a zero-rated export invoice under LUT without charging GST.",
    "sampleItems": [
      {
        "desc": "UI/UX design and responsive front-end development (landing + inner pages)",
        "unit": "per project",
        "typicalRate": 35000
      },
      {
        "desc": "Custom web application / back-end development",
        "unit": "per day",
        "typicalRate": 6000
      },
      {
        "desc": "WordPress / CMS website setup and theme customization",
        "unit": "per project",
        "typicalRate": 25000
      },
      {
        "desc": "Third-party & payment gateway API integration",
        "unit": "per integration",
        "typicalRate": 8000
      },
      {
        "desc": "Bug fixing and feature enhancement (hourly)",
        "unit": "per hour",
        "typicalRate": 900
      },
      {
        "desc": "Annual maintenance, updates and security patching (AMC)",
        "unit": "per year",
        "typicalRate": 18000
      }
    ],
    "paymentNorm": "Most Indian web developers work on milestones — commonly a 40-50% advance before starting, a stage payment at design/development sign-off, and the balance on delivery, with net 7-15 day terms on the final invoice.",
    "faq": [
      {
        "q": "Which SAC code should a web developer use on the invoice?",
        "a": "Use SAC 998314 — Information technology (IT) design and development services — for website and web-application design, coding and development work. Pure ongoing hosting or support may fall under 998315/998316, but for build-and-develop projects 998314 is the correct code, taxed at 18% GST."
      },
      {
        "q": "Do I have to charge GST if my income is below the threshold?",
        "a": "No. GST registration is only mandatory once your annual turnover from services crosses 20 lakh (10 lakh in special-category states). Below that you can invoice without GST, but you also cannot collect it or pass on input tax credit — many developers still register voluntarily so business clients can claim ITC."
      },
      {
        "q": "How do I invoice a foreign client for web development?",
        "a": "Software/IT development for an overseas client generally qualifies as an export of services. If you are GST-registered, file a Letter of Undertaking (LUT) and raise a zero-rated invoice with no GST charged, mentioning 'Export of service under LUT'. Keep FIRC/bank realization proof, as payment must be received in convertible foreign exchange."
      },
      {
        "q": "How should advances and milestone payments show on the invoice?",
        "a": "GST is payable when you receive an advance for services, so issue a receipt voucher on the advance and adjust it in the final tax invoice. Show gross project value, less advance already received, and the balance due — this keeps your GST filings clean and avoids double-charging tax on the milestone."
      }
    ],
    "metaDescription": "Web developer invoice format for India with correct GST SAC code 998314, 18% GST, sample line items, milestone payment terms and export-invoice FAQs."
  },
  {
    "slug": "content-writers",
    "name": "Content Writing",
    "who": "a freelance content writer / copywriter",
    "sacCode": "998399",
    "sacDescription": "Other professional, technical and business services n.e.c.",
    "gstRate": 18,
    "intro": "A content writer's invoice should clearly list each deliverable (articles, web pages, blogs) with per-word or per-piece rates, plus your SAC code and GST breakup if you are registered. There is no SAC named \"content writing,\" so most freelance writers bill under SAC 998399 (Other professional, technical and business services n.e.c.) at 18% GST — copywriting tied to ad campaigns can alternatively sit under 998361 (Advertising services). If you earn under Rs 20 lakh a year (Rs 10 lakh in special-category states) you are below the GST threshold and can invoice without charging GST, but you still need a clean, numbered invoice for the client's records and your ITR.",
    "sampleItems": [
      {
        "desc": "SEO blog article (900-1200 words, researched, 1 revision)",
        "unit": "per article",
        "typicalRate": 1500
      },
      {
        "desc": "Website / landing page copy",
        "unit": "per page",
        "typicalRate": 2500
      },
      {
        "desc": "Long-form content writing (per word)",
        "unit": "per word",
        "typicalRate": 2
      },
      {
        "desc": "Social media captions pack (Instagram / LinkedIn)",
        "unit": "per 10 posts",
        "typicalRate": 3500
      },
      {
        "desc": "Monthly content retainer (8 blogs + editing)",
        "unit": "per month",
        "typicalRate": 20000
      },
      {
        "desc": "Editing & proofreading of existing copy",
        "unit": "per 1000 words",
        "typicalRate": 500
      }
    ],
    "paymentNorm": "Freelance writers commonly take 30-50% advance before starting and the balance on delivery; retainer clients are usually billed monthly with Net 15-30 day terms.",
    "faq": [
      {
        "q": "Which SAC code should a freelance content writer put on a GST invoice?",
        "a": "There is no SAC literally called \"content writing.\" Most writers use SAC 998399 — \"Other professional, technical and business services n.e.c.\" — at 18% GST. If your work is copywriting for advertising campaigns, 998361 (Advertising services) also applies. When unsure, confirm the code with your CA, as a wrong SAC can affect your client's input tax credit."
      },
      {
        "q": "Do I need GST to invoice as a content writer in India?",
        "a": "Only if your annual turnover crosses Rs 20 lakh (Rs 10 lakh in special-category states) or you supply services to clients in other states through certain platforms. Below that you can raise a plain invoice with no GST — just number it, date it, and mention that GST is not applicable as you are below the registration threshold."
      },
      {
        "q": "How do I handle the advance payment on my invoice?",
        "a": "If you are GST-registered and collect an advance for services, GST is payable on the advance at the time you receive it, so raise a receipt voucher. On the final invoice, show the full value, the GST, then deduct the advance already received to arrive at the balance due."
      },
      {
        "q": "Should I bill international clients GST?",
        "a": "Writing for a client outside India is typically an export of service (zero-rated). You do not charge 18% GST if it qualifies, but you must be GST-registered and either file a LUT to export without tax or claim a refund. Mention it is an export of service on the invoice and collect payment in convertible foreign exchange."
      }
    ],
    "metaDescription": "Content writer invoice format for India: correct SAC code (998399), 18% GST, sample line items with realistic rates, advance-payment rules and freelancer FAQs."
  },
  {
    "slug": "digital-marketing-agencies",
    "name": "Digital Marketing",
    "who": "a digital marketing agency / freelancer",
    "sacCode": "998361",
    "sacDescription": "Advertising Services (full-service advertising and marketing: campaign planning, creative development, media strategy and digital campaign execution)",
    "gstRate": 18,
    "intro": "A digital marketing invoice in India should clearly separate your agency retainer/service fees from any ad spend (media budget) you pass through, because GST treatment differs for each. List SAC code 998361 (Advertising Services) with 18% GST on your service fees, add both your and the client's GSTIN, and show a HSN/SAC-wise tax summary. Since most agencies work on monthly retainers with an advance, mark clearly whether the invoice is an advance/proforma or a final tax invoice.",
    "sampleItems": [
      {
        "desc": "Monthly SEO retainer (on-page, technical, link building & reporting)",
        "unit": "per month",
        "typicalRate": 25000
      },
      {
        "desc": "Social media management (content calendar, 12-15 posts + engagement) — per platform",
        "unit": "per month",
        "typicalRate": 18000
      },
      {
        "desc": "Google Ads / Meta Ads campaign management fee",
        "unit": "per month",
        "typicalRate": 20000
      },
      {
        "desc": "Ad spend / media budget (pass-through, billed separately)",
        "unit": "per month",
        "typicalRate": 50000
      },
      {
        "desc": "Website landing page design & development",
        "unit": "per project",
        "typicalRate": 35000
      },
      {
        "desc": "Content writing / blog articles (SEO-optimised)",
        "unit": "per article",
        "typicalRate": 1500
      }
    ],
    "paymentNorm": "Most agencies work on monthly retainers billed in advance, typically taking 50% advance to start a project and the balance on delivery, with retainers invoiced at the start of each month and Net 7-15 day terms.",
    "faq": [
      {
        "q": "Should I show ad spend (Google/Meta budget) on the same invoice as my service fee?",
        "a": "Best practice is to separate them. Your management/service fee is your taxable supply under SAC 998361 at 18% GST. If you merely pass through the client's ad budget, keep it as a distinct line (ideally a pure agent/reimbursement or a separate invoice); if you bill the ad spend as part of your own supply, 18% GST applies to the full value. Keep the platform's billing receipts as backup."
      },
      {
        "q": "What SAC code and GST rate do I put on a digital marketing invoice?",
        "a": "Use SAC 998361 (Advertising Services) for full-service agency work — strategy, creative, campaign setup, optimisation and reporting — at 18% GST. If you are only reselling internet ad inventory/space, that falls under SAC 998365 (still 18%). Most agencies bill under 998361."
      },
      {
        "q": "How do I invoice foreign clients paying in USD — do I charge GST?",
        "a": "If it qualifies as export of service (recipient outside India, payment in convertible foreign exchange, and place of supply outside India), you can invoice with 0% GST under an LUT (Letter of Undertaking) without paying IGST, or pay IGST and claim a refund. Mention 'Supply meant for export under LUT without payment of IGST' on the invoice and keep your FIRC/bank realisation proof."
      },
      {
        "q": "Do I need to raise a proforma invoice for the advance retainer?",
        "a": "For an advance, issue a proforma or advance-receipt voucher — it is not a tax invoice and does not let the client claim ITC. Once the service is delivered (or the month is billed), raise the final GST tax invoice so the client can claim input tax credit. Never label a proforma as 'Tax Invoice'."
      }
    ],
    "metaDescription": "Digital marketing invoice format for Indian agencies & freelancers — correct SAC code 998361, 18% GST, sample line items, retainer & ad-spend billing, and export-invoice FAQs."
  },
  {
    "slug": "interior-designers",
    "name": "Interior Design",
    "who": "an interior designer",
    "sacCode": "998391",
    "sacDescription": "Specialty design services including interior design, fashion design, industrial design and other specialty design services",
    "gstRate": 18,
    "intro": "An interior designer's invoice in India should clearly separate professional design fees from any furniture, materials, or execution charges, because they can attract different treatment under GST. Design and consultancy services fall under SAC 998391 and are taxed at 18% GST, and your invoice must carry your GSTIN, the SAC code, and a clear tax break-up so business clients can claim input tax credit. Since interior projects run over months, most designers bill in stages against an advance, so a good invoice also states the milestone and adjusts any retainer already received.",
    "sampleItems": [
      {
        "desc": "Interior design consultancy & concept development",
        "unit": "per project",
        "typicalRate": 75000
      },
      {
        "desc": "2D layout & working drawings",
        "unit": "per sq ft",
        "typicalRate": 45
      },
      {
        "desc": "3D visualisation / photorealistic renders",
        "unit": "per view",
        "typicalRate": 3500
      },
      {
        "desc": "Site visits & execution supervision",
        "unit": "per visit",
        "typicalRate": 4000
      },
      {
        "desc": "Turnkey design & fit-out fee",
        "unit": "per sq ft",
        "typicalRate": 350
      },
      {
        "desc": "Design retainer / consultation",
        "unit": "per hour",
        "typicalRate": 2500
      }
    ],
    "paymentNorm": "Interior projects are typically billed in milestones — commonly a 30-50% advance to lock the booking, further stages on design sign-off and mid-execution, and the balance (often a 5-10% retention) released after final handover.",
    "faq": [
      {
        "q": "What SAC code and GST rate should an interior designer use on invoices?",
        "a": "Pure design, consultancy and drawing services fall under SAC 998391 (Specialty design services including interior design) and attract 18% GST. Mention the SAC code and the 18% break-up on every invoice so business clients can claim input tax credit."
      },
      {
        "q": "I do turnkey projects with furniture and civil work — is it still 18%?",
        "a": "When you supply materials and execute the fit-out, it is treated as a works contract, not pure design, and is billed under SAC 9954 (works contract services) at 18%. Many designers keep the design fee (998391) and the execution/works-contract portion as separate line items so the tax treatment is clean."
      },
      {
        "q": "How do I show the advance I collected on the final invoice?",
        "a": "If you were unregistered when you took the advance, no GST applied then; if registered, GST is due on advances for services. On the final milestone invoice, list the total fee, charge 18% GST, then deduct the advance already received (and its GST) so the client pays only the balance."
      },
      {
        "q": "Do I charge GST if the client is an individual homeowner, not a business?",
        "a": "Yes. Once your turnover crosses the 20 lakh threshold (10 lakh in special-category states) you must register and charge 18% GST to everyone, including individual homeowners. A homeowner cannot claim input tax credit, but you are still legally required to collect and deposit the tax."
      }
    ],
    "metaDescription": "Interior design invoice format for India with the correct SAC code 998391, 18% GST break-up, sample line items with realistic rates, and milestone payment terms."
  },
  {
    "slug": "consultants",
    "name": "Consulting",
    "who": "a management / business consultant",
    "sacCode": "998311",
    "sacDescription": "Management consulting and management services including financial, strategic, human resources, marketing, operations and supply chain management",
    "gstRate": 18,
    "intro": "A management consultant's invoice in India should clearly state your services under SAC code 998311 (management consulting and management services), which attracts 18% GST. Because consulting is often billed on retainers, milestones, or success fees, spell out the engagement type, the period covered, and any advance already received so both sides can reconcile easily and your client can claim input tax credit. If you invoice a client in another state, charge IGST at 18%; within your own state, split it as CGST 9% + SGST 9%.",
    "sampleItems": [
      {
        "desc": "Strategy & management consulting retainer (monthly)",
        "unit": "per month",
        "typicalRate": 75000
      },
      {
        "desc": "Business advisory / diagnostic engagement",
        "unit": "per project",
        "typicalRate": 250000
      },
      {
        "desc": "Senior consultant advisory time",
        "unit": "per hour",
        "typicalRate": 4000
      },
      {
        "desc": "Process improvement / operations review",
        "unit": "per project",
        "typicalRate": 180000
      },
      {
        "desc": "Board / leadership workshop facilitation",
        "unit": "per day",
        "typicalRate": 40000
      },
      {
        "desc": "Market entry / feasibility study report",
        "unit": "per report",
        "typicalRate": 150000
      }
    ],
    "paymentNorm": "Consultants typically take a 30-50% advance to start an engagement, bill retainers at the beginning of each month, and settle project milestones on Net 15-30 terms.",
    "faq": [
      {
        "q": "Which SAC code and GST rate should a management consultant use?",
        "a": "Use SAC 998311 (management consulting and management services including financial, strategic, HR, marketing and operations). Almost all consulting engagements attract 18% GST — charged as IGST 18% for out-of-state clients, or CGST 9% + SGST 9% within your state."
      },
      {
        "q": "Do I need GST registration to raise a consulting invoice?",
        "a": "GST registration becomes mandatory once your annual consulting revenue crosses ₹20 lakh (₹10 lakh in special-category north-eastern and hill states). Below that you can invoice without GST, but many corporate clients prefer a GST invoice so they can claim input tax credit."
      },
      {
        "q": "How do I show a retainer or advance on the invoice?",
        "a": "GST is payable when you receive an advance or retainer, so raise a receipt voucher or tax invoice at the point of receipt and charge 18% on it. On the final invoice, list the total fee, apply GST, then deduct the advance already billed so only the balance is payable."
      },
      {
        "q": "Will TDS be deducted from my consulting fees?",
        "a": "Yes. Business clients usually deduct TDS at 10% under Section 194J on professional/consultancy fees (on the fee amount, not the GST). Show your PAN clearly so they can deposit it correctly — you claim that TDS as credit when filing your income tax return."
      }
    ],
    "metaDescription": "Consulting invoice format for Indian management & business consultants: correct SAC code 998311, 18% GST, sample line items, retainer/advance handling, TDS and payment norms."
  },
  {
    "slug": "video-editors",
    "name": "Video Editing",
    "who": "a freelance video editor / videographer",
    "sacCode": "998386 / 998383",
    "sacDescription": "998386 (Photographic and videographic processing services) correctly covers only the post-production/editing work — video editing, colour grading, for",
    "gstRate": 18,
    "intro": "A video editor's invoice in India should clearly list each deliverable (edited film, reels, colour grade, motion graphics), state SAC code 998386 for videographic processing services, and apply 18% GST if you are GST-registered. Because most editing work is quoted per project or per finished minute — often with a 40-50% advance and revision limits — spell out the scope, number of included revisions, and rate for extra changes so scope-creep doesn't eat your margin. Always add your PAN and, for clients who deduct TDS, note that editing falls under Section 194J professional/technical services.",
    "sampleItems": [
      {
        "desc": "Long-form video editing (corporate/YouTube), per finished minute",
        "unit": "per finished minute",
        "typicalRate": 1500
      },
      {
        "desc": "Short-form vertical edit for Instagram Reels / YouTube Shorts",
        "unit": "per reel",
        "typicalRate": 1200
      },
      {
        "desc": "Wedding highlight / cinematic film edit",
        "unit": "per project",
        "typicalRate": 25000
      },
      {
        "desc": "Colour grading & correction",
        "unit": "per project",
        "typicalRate": 8000
      },
      {
        "desc": "Motion graphics / animated intro & lower-thirds",
        "unit": "per project",
        "typicalRate": 5000
      },
      {
        "desc": "Additional revision beyond included rounds",
        "unit": "per revision",
        "typicalRate": 1500
      }
    ],
    "paymentNorm": "A 40-50% advance before work begins with the balance on final delivery is standard; most freelance editors bill per project or per finished minute, include 2-3 revision rounds in the base price, and set net-7 to net-15 terms for the balance.",
    "faq": [
      {
        "q": "Which SAC code should a freelance video editor use on a GST invoice?",
        "a": "Use SAC 998386 (Photographic and videographic processing services), which the GST tariff explicitly covers for video editing, colour grading and post-production processing. It is taxed at 18% GST. Pure animation or standalone motion-graphics work can alternatively fall under 998391 (specialty design), but for cutting, grading and finishing footage, 998386 is the correct code."
      },
      {
        "q": "Do I have to charge 18% GST on my editing work?",
        "a": "Only if you are GST-registered. Registration is mandatory once your annual turnover crosses Rs 20 lakh (Rs 10 lakh in special-category states). Below that you can invoice without GST, but you must not collect it. Once registered, charge CGST+SGST (9%+9%) for clients in your own state and IGST (18%) for clients in other states or exports."
      },
      {
        "q": "How should I handle the advance payment on my invoice?",
        "a": "If you are GST-registered, an advance for a service is taxable when received, so raise a receipt voucher and pay GST on the advance in that month. When you deliver, issue the final tax invoice for the full value and adjust the advance already taxed so you don't pay GST twice. If you are not registered, simply show the advance received and the balance due."
      },
      {
        "q": "Will clients deduct TDS from my editing payments?",
        "a": "Yes. Business and production-house clients typically treat editing as professional/technical services under Section 194J and deduct 10% TDS if your annual billing to them exceeds Rs 30,000. Put your PAN on every invoice, show GST separately (TDS is computed on the pre-GST amount), and claim the deducted TDS back when you file your income-tax return."
      }
    ],
    "metaDescription": "Video editing invoice format for India with correct SAC code 998386, 18% GST, sample per-minute and per-reel line items, advance-payment norms, and editor-specific FAQs."
  },
  {
    "slug": "social-media-managers",
    "name": "Social Media Management",
    "who": "a social media manager / freelancer",
    "sacCode": "998361",
    "sacDescription": "Advertising Services — planning, concept development and execution of the full range of services for an advertising campaign, including content creati",
    "gstRate": 18,
    "intro": "A social media manager's invoice in India should clearly separate your service fee from any ad spend you pass on to the client, and quote SAC 998361 (Advertising Services) with 18% GST if you are GST-registered. Because most SMMs work on monthly retainers with an upfront advance, your invoice should show the billing period, the platforms/deliverables covered, any advance already collected, and your GSTIN — so clients can claim input tax credit and you stay audit-ready.",
    "sampleItems": [
      {
        "desc": "Monthly social media management retainer (per platform — content, scheduling, community management)",
        "unit": "per platform / month",
        "typicalRate": 20000
      },
      {
        "desc": "Reel / short-form video editing (shooting brief, edit, captions, hooks)",
        "unit": "per reel",
        "typicalRate": 1500
      },
      {
        "desc": "Static post / carousel creative design",
        "unit": "per post",
        "typicalRate": 500
      },
      {
        "desc": "Monthly content strategy & content calendar",
        "unit": "per month",
        "typicalRate": 8000
      },
      {
        "desc": "Paid ad campaign management fee (Meta / Google Ads setup & optimisation)",
        "unit": "per month (or 15% of ad spend)",
        "typicalRate": 12000
      },
      {
        "desc": "Monthly analytics & performance report",
        "unit": "per report",
        "typicalRate": 3000
      }
    ],
    "paymentNorm": "Most social media managers work on a monthly retainer billed in advance, commonly 50-100% upfront before the month begins, with the balance and any variable deliverables invoiced at month-end (Net 7-15 days). Ad spend is usually billed or reimbursed separately from your management fee.",
    "faq": [
      {
        "q": "Should I include the client's Meta/Google ad spend in my invoice, and does it attract 18% GST?",
        "a": "If you pay the platforms yourself and recharge the client, that ad spend generally becomes part of your taxable value and GST applies on the whole amount — unless you bill it as a 'pure agent' (client's name on the platform invoice, exact reimbursement, shown as a separate line). The cleanest approach is to keep your management fee and ad-spend reimbursement on separate lines so GST is charged correctly and the client can see what went to the platforms versus what is your fee."
      },
      {
        "q": "Which SAC code should I use — 998361 or 998365?",
        "a": "Use 998361 (Advertising Services) for managing accounts, creating content and running campaigns for clients — this is the standard code for social media management. 998365 (Sale of internet advertising space) is meant for reselling ad space, not for the creative and management work most SMMs do. Both are taxed at 18%."
      },
      {
        "q": "I earn under ₹20 lakh a year — do I still need a GSTIN and to charge GST on my invoices?",
        "a": "No. GST registration is mandatory only once your annual turnover crosses ₹20 lakh (₹10 lakh in some special-category states). Below that you can issue a simple invoice with no GST and no GSTIN. But if you serve agencies or larger brands, many will ask for a GSTIN so they can claim input tax credit — voluntary registration can win you those clients."
      },
      {
        "q": "I collect a retainer advance before the month starts — when do I charge GST on it?",
        "a": "For services, GST is due on advances the moment you receive them. If you're GST-registered, issue a receipt voucher for the advance and pay GST in that month, then adjust it against the final tax invoice for the completed work. This is why many SMMs simply issue the full tax invoice at the start of the retainer period once the advance is received."
      }
    ],
    "metaDescription": "Social media manager invoice format for India: correct SAC code 998361, 18% GST, sample line items with real rates, retainer & advance norms, and SMM-specific FAQs."
  },
  {
    "slug": "freelancers",
    "name": "Freelance",
    "who": "a freelancer (generic services)",
    "sacCode": "998399",
    "sacDescription": "Other professional, technical and business services n.e.c",
    "gstRate": 18,
    "intro": "A freelancer's invoice should clearly list each service you delivered, your rate, and the total — plus your GSTIN and the SAC code 998399 (\"other professional services\") with 18% GST if you're registered. Using 998399 as a residual code is fine only when no more specific SAC (like 998314 for IT/software or 998361 for advertising) describes your work. A clean, Rule 46-compliant invoice with your PAN also helps clients deduct the right TDS and pay you faster.",
    "sampleItems": [
      {
        "desc": "Professional services / consulting retainer (monthly)",
        "unit": "per month",
        "typicalRate": 40000
      },
      {
        "desc": "Project-based deliverable (fixed scope)",
        "unit": "per project",
        "typicalRate": 25000
      },
      {
        "desc": "Hourly professional work",
        "unit": "per hour",
        "typicalRate": 1200
      },
      {
        "desc": "Day rate for on-site / dedicated work",
        "unit": "per day",
        "typicalRate": 8000
      },
      {
        "desc": "Revisions / additional scope beyond agreement",
        "unit": "per revision",
        "typicalRate": 2000
      },
      {
        "desc": "Rush / priority delivery surcharge",
        "unit": "per project",
        "typicalRate": 5000
      }
    ],
    "paymentNorm": "Freelancers in India typically ask for a 30-50% advance before starting, with the balance due on delivery or within 15-30 days (Net 15/Net 30); a late-payment note of 1.5-2% per month is common on larger projects.",
    "faq": [
      {
        "q": "Which SAC code should I put on my freelance invoice?",
        "a": "Use the specific SAC that matches your work first — e.g. 998314 for software/IT development, 998361 for advertising/design, 999293 for content and training. Only fall back to 998399 (\"other professional, technical and business services\") when no specific code fits. All of these attract 18% GST."
      },
      {
        "q": "Do I need to charge GST if I earn under the registration threshold?",
        "a": "If your annual turnover is below Rs 20 lakh (Rs 10 lakh in special-category states) you are not required to register or charge GST. Once you cross the threshold — or if you export services and want to claim refunds — you must register, add your GSTIN, and charge 18% on domestic invoices."
      },
      {
        "q": "How do I invoice a foreign client — do I add 18% GST?",
        "a": "Service exports are zero-rated. If you're GST-registered, you can invoice without charging GST by filing a LUT (Letter of Undertaking); mention \"Export of service under LUT, GST not charged\" on the invoice. Bill in the foreign currency and keep FIRC/bank realisation proof for your records."
      },
      {
        "q": "Why do clients deduct TDS from my payment, and how does it show on the invoice?",
        "a": "Business clients deduct 10% TDS under Section 194J on professional/technical fees (2% for some technical services) if annual payments exceed Rs 30,000. Show your full invoice value plus GST; the client pays you net of TDS and you claim that TDS as credit when filing your income tax return, so always put your PAN on the invoice."
      }
    ],
    "metaDescription": "Free freelancer invoice format for India with the correct SAC code 998399, 18% GST, sample line items, advance/payment terms, and TDS and export-invoice FAQs."
  },
  {
    "slug": "event-planners",
    "name": "Event Management",
    "who": "an event planner / event management company",
    "sacCode": "998596",
    "sacDescription": "Events, Exhibitions, Conventions and Trade Shows organisation and assistance services",
    "gstRate": 18,
    "intro": "An event management invoice in India should clearly separate your professional service fee from pass-through vendor costs (catering, venue, decor, sound), because both usually attract 18% GST under SAC 998596. Since weddings, corporate offsites and exhibitions involve large advances, your invoice must show the booking advance received, the balance due and the milestone it is tied to. Listing the SAC code, GST breakup (CGST+SGST or IGST) and a clear cancellation clause protects you when clients dispute costs after the event.",
    "sampleItems": [
      {
        "desc": "Event planning & coordination fee (full-service wedding/corporate)",
        "unit": "per event",
        "typicalRate": 150000
      },
      {
        "desc": "On-site event manager & crew",
        "unit": "per day",
        "typicalRate": 12000
      },
      {
        "desc": "Stage, decor & floral setup",
        "unit": "per event",
        "typicalRate": 200000
      },
      {
        "desc": "Sound, lighting & AV rental",
        "unit": "per day",
        "typicalRate": 45000
      },
      {
        "desc": "Catering coordination (buffet)",
        "unit": "per plate",
        "typicalRate": 850
      },
      {
        "desc": "Venue booking & liaison charge",
        "unit": "per venue",
        "typicalRate": 25000
      }
    ],
    "paymentNorm": "Typically 40-50% advance to block the date, 30-40% one week before the event, and the balance on the event day or within 7 days; vendor pass-through costs are often billed at actuals against receipts.",
    "faq": [
      {
        "q": "What SAC code and GST rate do I use on an event management invoice?",
        "a": "Use SAC 998596 (Events, exhibitions, conventions and trade shows organisation and assistance services), which attracts 18% GST. Charge CGST 9% + SGST 9% when the client is in your state, or IGST 18% for out-of-state clients."
      },
      {
        "q": "How do I show the advance/booking amount on the invoice?",
        "a": "Raise a receipt voucher (or advance invoice) when you collect the booking advance and charge 18% GST on it at that point. In the final invoice, list the total, subtract the GST-paid advance already received, and show only the balance as payable."
      },
      {
        "q": "Should vendor costs like catering and decor be on my invoice or billed separately?",
        "a": "If you procure catering, venue and decor in your own name and re-bill the client, add them as line items and charge 18% GST on the full value (you can claim Input Tax Credit on those vendor bills). Only genuine reimbursements paid on the client's behalf as a pure agent, with supporting bills, can be excluded from GST."
      },
      {
        "q": "What happens to GST if the client cancels the event after paying an advance?",
        "a": "If you retain the advance as a cancellation charge, GST still applies because it is treated as consideration for agreeing to tolerate the cancellation. Issue a credit note or refund voucher for any amount you return, and keep your cancellation slab (e.g. non-refundable within 30 days) written on the invoice."
      }
    ],
    "metaDescription": "Event management invoice format for India with the correct SAC code 998596, 18% GST breakup, advance/booking terms, sample line items and event-planner FAQs."
  },
  {
    "slug": "tutors",
    "name": "Tutoring & Coaching",
    "who": "a private tutor / coaching business",
    "sacCode": "999293",
    "sacDescription": "Commercial training and coaching services",
    "gstRate": 18,
    "intro": "A tutoring or coaching invoice in India should clearly state the subject/course, the period or number of sessions, the fee per session or per month, and any advance already collected. Private coaching and commercial training fall under SAC code 999293 and attract 18% GST — but only if your annual coaching income crosses ₹20 lakh and you are GST-registered; smaller home tutors below the threshold bill without GST. Since most parents and students pay monthly or per-batch in advance, a clean invoice showing the billing month, sessions covered, and advance adjusted avoids disputes and doubles as a fee receipt for reimbursement.",
    "sampleItems": [
      {
        "desc": "Monthly tuition fee — one subject (2-3 sessions/week)",
        "unit": "per month",
        "typicalRate": 3000
      },
      {
        "desc": "One-on-one home/online tutoring",
        "unit": "per hour",
        "typicalRate": 600
      },
      {
        "desc": "Competitive exam coaching (JEE/NEET/UPSC) — batch",
        "unit": "per month",
        "typicalRate": 8000
      },
      {
        "desc": "Group / batch tuition (per student)",
        "unit": "per month",
        "typicalRate": 1500
      },
      {
        "desc": "Registration / admission fee (one-time)",
        "unit": "per student",
        "typicalRate": 1000
      },
      {
        "desc": "Study material, notes & test series",
        "unit": "per module",
        "typicalRate": 1200
      }
    ],
    "paymentNorm": "Fees are almost always collected monthly in advance (before the start of the teaching month), with many coaching institutes taking a one-time admission fee plus quarterly or full-course advance; late fees typically apply after a 5-7 day grace period.",
    "faq": [
      {
        "q": "Do I have to charge GST on my tuition fees?",
        "a": "Only if you are GST-registered, which becomes mandatory once your total coaching income crosses ₹20 lakh in a financial year (₹10 lakh in some special-category states). Private home tutors and small coaching setups below this threshold neither register nor charge GST — their invoices simply show the fee with no tax. Above the threshold, private coaching and commercial training are taxable at 18% under SAC 999293; unlike recognised schools and colleges, coaching centres do not get the education exemption."
      },
      {
        "q": "What SAC code should I put on a coaching invoice?",
        "a": "Use SAC 999293 — 'Commercial training and coaching services'. This covers school subject tuition, JEE/NEET/UPSC/CA and other competitive-exam coaching, language classes, and skill or hobby courses. It falls under the broader 9992 education-services group and carries an 18% GST rate for registered coaches."
      },
      {
        "q": "How do I invoice advance or monthly fees paid upfront?",
        "a": "Show the billing period clearly (e.g. 'Tuition — August 2026'), list the sessions or subjects covered, and put the fee as the line amount. If a student paid an admission advance or a lump-sum for a term, add it as a separate line and adjust it against the current month with a note like 'Less: advance received ₹X'. For GST-registered coaches collecting fees before the class month, GST is due on the advance in the month it is received."
      },
      {
        "q": "Should study material and test series be billed separately from tuition?",
        "a": "It is cleaner to list them as separate line items, because printed books can attract different GST treatment (many books are exempt or zero-rated) while your coaching service is 18%. Bundling everything as one 'course fee' means the whole amount is taxed at the service rate, so itemising material, test series and tuition separately can be both more accurate and more tax-efficient."
      }
    ],
    "metaDescription": "Free tutoring & coaching invoice format for India with the correct SAC code 999293, 18% GST, sample fee line items, advance/monthly billing norms and tutor GST FAQs."
  }
];

function inr(n: number): string {
  return "₹" + Number(n || 0).toLocaleString("en-IN");
}

const STYLE = `<style>
  .kv{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}
  @media(max-width:560px){.kv{grid-template-columns:1fr}}
  .kv>div{display:flex;flex-direction:column;gap:2px;padding:12px 14px;background:var(--accent-bg);border:1px solid var(--accent-line);border-radius:12px}
  .kv .k{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700}
  .kv .v{font-size:22px;font-weight:800;color:var(--green-d);letter-spacing:-.01em}
  .kv .kd{font-size:12px;color:var(--muted)}
  table.samp{width:100%;border-collapse:collapse;font-size:14px;min-width:420px}
  table.samp th{text-align:left;padding:8px 10px;border-bottom:2px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  table.samp td{padding:9px 10px;border-bottom:1px solid var(--card-line)}
  table.samp tr:last-child td{border-bottom:none}
</style>`;

function professionInvoicePage(s: ProfessionSpec): string {
  const path = PATH_PREFIX + s.slug;
  const title = `${s.name} Invoice Format in Word, Excel & PDF — Free GST Download | DealInSec`;
  const lower = s.name.toLowerCase();

  const itemsRows = s.sampleItems
    .map(
      (it) =>
        `<tr><td>${esc(it.desc)}</td><td>${esc(it.unit)}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${inr(it.typicalRate)}</td></tr>`,
    )
    .join("");

  const faqHtml = s.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("\n");

  // Seed the invoice tool's draft with this profession's line items on CTA click.
  const seed = JSON.stringify({
    items: s.sampleItems.map((it) => ({ desc: it.desc, qty: 1, rate: it.typicalRate })),
    gstRate: String(s.gstRate),
    taxType: "cgst_sgst",
  });

  const body = `
  <div class="hero"><div class="wrap">
    <h1>${esc(s.name)} Invoice Format</h1>
    <p class="sub">A GST-ready invoice format for ${esc(s.who)} in India — with the correct SAC code, the right GST rate, and the line items you actually bill. Fill it in and download a PDF, free and no sign-up.</p>
    <div class="chips">
      <span class="chip">100% free</span>
      <span class="chip">No sign-up</span>
      <span class="chip">SAC ${esc(s.sacCode)}</span>
      <span class="chip">GST-ready</span>
    </div>
  </div></div>

  <section><div class="wrap">
    <div class="card">
      <p style="margin:0">${esc(s.intro)}</p>
      <div class="kv">
        <div><span class="k">SAC code</span><span class="v">${esc(s.sacCode)}</span><span class="kd">${esc(s.sacDescription)}</span></div>
        <div><span class="k">GST rate</span><span class="v">${esc(String(s.gstRate))}%</span><span class="kd">CGST + SGST within state · IGST inter-state</span></div>
      </div>
    </div>
  </div></section>

  <section><div class="wrap">
    <h2>What ${esc(s.who)} typically bills for</h2>
    <div class="card" style="overflow-x:auto">
      <table class="samp"><thead><tr><th>Item / service</th><th>Billed</th><th style="text-align:right">Typical rate</th></tr></thead>
      <tbody>${itemsRows}</tbody></table>
      <p class="muted" style="font-size:12.5px;margin-top:10px">Indicative market rates — set your own. Add these as line items and the invoice totals GST for you.</p>
    </div>
    <div style="text-align:center;margin-top:22px">
      <button class="btn" id="make-invoice" type="button">Create a ${esc(s.name)} invoice free →</button>
      <p class="muted" style="font-size:12.5px;margin-top:8px">Opens the free GST invoice generator, pre-filled with these items.</p>
    </div>
  </div></section>

  <section id="how"><div class="wrap">
    <h2>How to make a ${esc(lower)} invoice</h2>
    <div class="steps">
      <div class="step"><div class="n">1</div><b>Add your details</b><p class="muted">Your name / business, GSTIN if registered, and the client's details.</p></div>
      <div class="step"><div class="n">2</div><b>Add your work</b><p class="muted">List what you delivered — use the items above as a starting point — under SAC ${esc(s.sacCode)}.</p></div>
      <div class="step"><div class="n">3</div><b>Set GST &amp; download</b><p class="muted">Pick ${esc(String(s.gstRate))}% GST, choose CGST+SGST or IGST, and download the PDF.</p></div>
    </div>
  </div></section>

  <section><div class="wrap">
    <div class="card">
      <h2>What a GST-compliant ${esc(lower)} invoice must include</h2>
      <p class="muted">A GST tax invoice should carry: your name, address and GSTIN; a unique invoice number and date; the client's name, address and GSTIN (if registered); a description of the service with its SAC code (${esc(s.sacCode)} for ${esc(lower)}); the taxable value; the GST rate and amount split as CGST + SGST (same state) or IGST (inter-state); the total in words; and your signature. ${esc(s.paymentNorm)}</p>
    </div>
  </div></section>

  ${professionLinksSection(s.slug)}

  <section id="faq"><div class="wrap faq">
    <h2>${esc(s.name)} invoice — frequently asked questions</h2>
    ${faqHtml}
  </div></section>
  `;

  const jsonLd = [
    { "@context": "https://schema.org", "@type": "WebPage", name: title, url: SITE_ORIGIN + path, description: s.metaDescription },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: s.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Free Tools", item: SITE_ORIGIN + "/tools" },
        { "@type": "ListItem", position: 2, name: s.name + " Invoice Format", item: SITE_ORIGIN + path },
      ],
    },
  ];

  const script =
    `<script>(function(){var b=document.getElementById('make-invoice');if(b)b.addEventListener('click',function(){try{localStorage.setItem('dis_gst_invoice_v1',JSON.stringify(` +
    seed +
    `));}catch(e){}window.location.href='/tools/gst-invoice-generator';});})();</script>`;

  return renderToolPage({
    title,
    description: s.metaDescription,
    canonicalPath: path,
    jsonLd,
    headExtra: STYLE,
    bodyHtml: body,
    bodyEndScripts: script,
  });
}

/** "Invoice formats by profession" internal-link block (cross-links the pages +
 *  can be embedded on the GST invoice tool). Reuses the related-tools card style. */
export function professionLinksSection(currentSlug?: string): string {
  const links = PROFESSION_SPECS.filter((s) => s.slug !== currentSlug)
    .map(
      (s) =>
        `<a class="rt-card" href="${PATH_PREFIX}${s.slug}"><span class="rt-label">${esc(s.name)} invoice format</span><span class="rt-go" aria-hidden="true">→</span></a>`,
    )
    .join("");
  if (!links) return "";
  return `<section class="no-print"><div class="wrap">
    <h2 style="font-size:18px;font-weight:800;margin:0 0 14px">Invoice format by profession</h2>
    <div class="rt-grid">${links}</div>
  </div></section>`;
}

/** Public paths for the sitemap. */
export function programmaticSitemapPaths(): string[] {
  return PROFESSION_SPECS.map((s) => PATH_PREFIX + s.slug);
}

/** Register every profession invoice-format page (call before the SPA catch-all). */
export function registerProgrammaticPages(app: Express) {
  for (const s of PROFESSION_SPECS) {
    app.get(PATH_PREFIX + s.slug, (_req, res) => res.type("html").send(professionInvoicePage(s)));
  }
}
