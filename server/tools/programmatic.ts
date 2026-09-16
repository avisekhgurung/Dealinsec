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
  who: string; // "a freelance photographer"
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
    "sacDescription": "Photographic and videographic processing services (post-production, editing and colour grading)",
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
  },
  {
    "slug": "chartered-accountants",
    "name": "CA & Accounting",
    "who": "a chartered accountant / accounting firm",
    "sacCode": "998222",
    "sacDescription": "Accounting and bookkeeping services",
    "gstRate": 18,
    "intro": "For a chartered accountant or accounting firm in India, a compliant invoice is more than a bill — it doubles as a professional record that clients rely on to claim input tax credit (ITC). Accounting, bookkeeping and auditing services fall under SAC heading 9982 and attract 18% GST, so every tax invoice you raise must carry your GSTIN, the correct SAC code, and a clear CGST/SGST or IGST split. Since your clients are usually GST-registered businesses, accuracy on the SAC and place-of-supply directly affects whether they can reclaim the tax you charge.",
    "sampleItems": [
      {
        "desc": "Monthly bookkeeping & accounts maintenance (retainer)",
        "unit": "per month",
        "typicalRate": 8000
      },
      {
        "desc": "GST return filing (GSTR-1 & GSTR-3B)",
        "unit": "per month",
        "typicalRate": 2500
      },
      {
        "desc": "Income tax return filing — individual/proprietor",
        "unit": "per return",
        "typicalRate": 3000
      },
      {
        "desc": "Statutory / tax audit under the Income Tax Act",
        "unit": "per audit",
        "typicalRate": 25000
      },
      {
        "desc": "Company annual ROC filing & compliance (MCA)",
        "unit": "per year",
        "typicalRate": 12000
      },
      {
        "desc": "TDS return filing (quarterly)",
        "unit": "per quarter",
        "typicalRate": 2000
      }
    ],
    "paymentNorm": "Retainer/compliance work is usually billed monthly or on completion, with net 7-15 day terms; audit and project engagements are commonly split into an advance (30-50%) on engagement and the balance on delivery of the signed report.",
    "faq": [
      {
        "q": "Which SAC code should a CA put on the invoice — 998222 or 998221?",
        "a": "Use 998222 for accounting and bookkeeping work, and 998221 for financial and statutory auditing. Both sit under heading 9982 and are taxed at 18%. If a single invoice mixes both, list each service line with its own SAC so your client can map the ITC correctly."
      },
      {
        "q": "Do CA services attract reverse charge (RCM) like advocate/legal services?",
        "a": "No. Unlike an advocate or a firm of advocates (whose fees to business clients fall under reverse charge), a chartered accountant charges GST on a forward-charge basis. You collect 18% GST from the client and deposit it yourself — the client does not pay tax under RCM for your CA services."
      },
      {
        "q": "Do I need to register for GST and charge 18% on every invoice?",
        "a": "GST registration is mandatory once your aggregate turnover crosses Rs. 20 lakh (Rs. 10 lakh in special-category states). Below that you can invoice without GST as an unregistered supplier. Once registered, you must issue a tax invoice with your GSTIN and charge 18% — CAs cannot opt for the composition scheme, as it is not available to service providers of this kind."
      },
      {
        "q": "Is it CGST+SGST or IGST on my invoice?",
        "a": "It depends on place of supply. If your client is in the same state as your firm, split the 18% as 9% CGST + 9% SGST. If the client is registered in another state, charge 18% IGST instead. Always capture the client's GSTIN and state so the split — and their input tax credit — is correct."
      }
    ],
    "metaDescription": "Free CA & accounting invoice format for India with the correct SAC code (998222), 18% GST, sample line items, payment terms and FAQs on RCM, ITC and CGST/SGST split."
  },
  {
    "slug": "lawyers",
    "name": "Legal",
    "who": "a lawyer / advocate / law firm",
    "sacCode": "998212",
    "sacDescription": "Legal advisory and representation services (other fields of law)",
    "gstRate": 18,
    "intro": "In India, legal services supplied by an individual advocate or a firm of advocates to a business entity are almost always taxed under the Reverse Charge Mechanism (RCM) — meaning your business client pays the 18% GST directly to the government, not you. Your invoice therefore usually shows the fee only and carries the note \"GST payable by recipient under reverse charge (RCM).\" Services to individuals/non-business clients, and to business entities with turnover below the GST registration threshold, are exempt.",
    "sampleItems": [
      {
        "desc": "Legal consultation / opinion (per hour)",
        "unit": "hour",
        "typicalRate": 3000
      },
      {
        "desc": "Drafting of agreement, contract or legal notice",
        "unit": "document",
        "typicalRate": 5000
      },
      {
        "desc": "Court appearance / representation (per hearing)",
        "unit": "appearance",
        "typicalRate": 10000
      },
      {
        "desc": "Retainer fee (monthly)",
        "unit": "month",
        "typicalRate": 25000
      },
      {
        "desc": "Case handling / litigation (lump-sum brief fee)",
        "unit": "case",
        "typicalRate": 50000
      },
      {
        "desc": "Due diligence / legal vetting report",
        "unit": "report",
        "typicalRate": 15000
      }
    ],
    "paymentNorm": "Advocates commonly bill a retainer or advance up front, with the balance on hearing dates or case milestones; retainer clients are invoiced monthly. Net 15-30 days is typical for corporate clients, and out-of-pocket disbursements (court fees, stamp duty, travel) are billed at actuals.",
    "faq": [
      {
        "q": "Do I charge GST on my invoice as an advocate?",
        "a": "Usually no. Legal services from an individual advocate or firm of advocates to a business entity fall under Reverse Charge Mechanism (RCM), so the client pays the 18% GST directly to the government. You raise the invoice for your fee only and add the note: 'Tax payable on reverse charge basis by the recipient.' You do not collect the tax yourself."
      },
      {
        "q": "When are my legal services fully exempt from GST?",
        "a": "Services to an individual/non-business client are exempt, as are services to a business entity whose aggregate turnover in the preceding year was below the GST registration threshold (Rs. 20 lakh, or Rs. 10 lakh in special-category states). Representation before any court or tribunal is also exempt. In these cases no GST applies under RCM or otherwise."
      },
      {
        "q": "Do I even need GST registration as a lawyer?",
        "a": "Often not. Because most of your outward supplies are covered by RCM (client pays) or are exempt, many advocates and law firms are not required to register for GST. Register only if you cross the threshold on non-RCM taxable supplies or opt in voluntarily. If unregistered, simply omit any GSTIN and issue a plain professional fee invoice with the RCM note."
      },
      {
        "q": "What SAC code and rate should I mention?",
        "a": "Use SAC 998212 for legal advisory and representation services (998211 for criminal-law matters). The applicable rate is 18%. Even when the tax is paid by the client under RCM, quoting the SAC code and the 18% RCM note on your invoice keeps it compliant and audit-ready."
      }
    ],
    "metaDescription": "Free legal invoice format for Indian advocates, lawyers and law firms. Correct SAC code 998212, 18% GST under reverse charge (RCM), sample fee items and billing FAQs."
  },
  {
    "slug": "translators",
    "name": "Translation",
    "who": "a freelance translator",
    "sacCode": "998395",
    "sacDescription": "Translation and interpretation services",
    "gstRate": 18,
    "intro": "Freelance translators and interpreters in India bill under SAC 998395 (\"Translation and interpretation services\"), taxed at 18% GST once your turnover crosses the Rs. 20 lakh registration threshold (Rs. 10 lakh in special-category states). A big share of translation work is for overseas clients, and here the invoice rules change: when you translate for a client abroad and are paid in convertible foreign currency, it counts as an export of service (zero-rated) — you charge no GST but must invoice under a LUT or claim a refund. This page gives you a clean, GST-ready translation invoice for both domestic and export work.",
    "sampleItems": [
      {
        "desc": "Document translation (general), English to Hindi — per word of source text",
        "unit": "per word",
        "typicalRate": 1.5
      },
      {
        "desc": "Technical/legal/medical translation (specialised) — per word of source text",
        "unit": "per word",
        "typicalRate": 3
      },
      {
        "desc": "Certified translation with translator's declaration/stamp (per standard page ~250 words)",
        "unit": "per page",
        "typicalRate": 600
      },
      {
        "desc": "Proofreading & editing of existing translation — per word",
        "unit": "per word",
        "typicalRate": 0.75
      },
      {
        "desc": "Consecutive interpretation (conference/court/business meeting)",
        "unit": "per day",
        "typicalRate": 8000
      },
      {
        "desc": "Urgent / same-day turnaround surcharge",
        "unit": "percentage",
        "typicalRate": 25
      }
    ],
    "paymentNorm": "Domestic clients typically pay Net 15-30 days from invoice; agencies often run 30-45 day cycles. For direct and overseas clients, a 30-50% advance before starting a large project is standard, with the balance on delivery. Foreign-client payments arrive via bank wire, Wise, or PayPal in foreign currency — retain the FIRC/FIRA as proof of export.",
    "faq": [
      {
        "q": "What GST rate and SAC code do I put on a translation invoice?",
        "a": "Use SAC 998395 (Translation and interpretation services) and charge 18% GST — split as 9% CGST + 9% SGST when the client is in your state, or 18% IGST when the client is in another state. This same rate covers document translation, subtitling, and interpretation."
      },
      {
        "q": "Do I charge GST when I translate for a client outside India?",
        "a": "No — if the client is located abroad and you are paid in convertible foreign currency, it is an export of service and is zero-rated (0% GST). You can either invoice under a Letter of Undertaking (LUT) without charging GST, or pay IGST and claim a refund. Keep the FIRC/bank realisation certificate as export proof, and still show SAC 998395 on the invoice."
      },
      {
        "q": "Do I even need GST registration as a freelance translator?",
        "a": "Only once your aggregate turnover crosses Rs. 20 lakh in a financial year (Rs. 10 lakh in special-category/North-Eastern states). Below that you can invoice without GST. Note: export of services counts toward turnover, and many translators register voluntarily to file LUTs and claim input-tax refunds on export work."
      },
      {
        "q": "Should I bill per word, per page, or per hour?",
        "a": "Per word of the source text is the industry standard for translation (typically Rs. 1-3/word depending on language pair and subject), while certified work is often per standard page and interpretation is charged per hour or per day. Always state the rate basis and word/page count on the invoice so the client can verify the total."
      }
    ],
    "metaDescription": "Free GST-ready translation invoice format for Indian freelance translators & interpreters. Correct SAC code 998395, 18% GST, export-of-service (zero-rated) rules, sample per-word rates and payment terms."
  },
  {
    "slug": "makeup-artists",
    "name": "Makeup Artistry",
    "who": "a freelance makeup artist",
    "sacCode": "999729",
    "sacDescription": "Other beauty treatment services n.e.c. (under Group 99972 - Beauty and physical well-being services)",
    "gstRate": 5,
    "intro": "As a freelance makeup artist in India, a clean invoice does more than get you paid — it locks in bridal dates with an advance, itemises trials, draping and outstation travel, and keeps you GST-ready. Since the GST 2.0 reforms of 22 September 2025, beauty and personal-care services (including makeup) attract just 5% GST without input tax credit, down from the earlier 18%. Use this format to bill weddings, shoots and events professionally and transparently.",
    "sampleItems": [
      {
        "desc": "Bridal makeup (HD / airbrush) with hairstyling — wedding day",
        "unit": "per event",
        "typicalRate": 20000
      },
      {
        "desc": "Engagement / reception makeup look",
        "unit": "per event",
        "typicalRate": 10000
      },
      {
        "desc": "Party or family-member guest makeup",
        "unit": "per person",
        "typicalRate": 3000
      },
      {
        "desc": "Pre-wedding / editorial shoot makeup",
        "unit": "per look",
        "typicalRate": 6000
      },
      {
        "desc": "Trial makeup session (bridal)",
        "unit": "per session",
        "typicalRate": 3500
      },
      {
        "desc": "Outstation / travel & accommodation charges",
        "unit": "per day",
        "typicalRate": 2500
      }
    ],
    "paymentNorm": "A non-refundable booking advance of 30–50% is standard to block the date, with the balance due on or before the event day. Peak-season and outstation weddings are usually paid fully in advance; UPI and bank transfer are the norm.",
    "faq": [
      {
        "q": "What GST rate do I charge on makeup services?",
        "a": "Since 22 September 2025, makeup and beauty services are taxed at 5% GST without input tax credit (ITC) — down from the earlier 18%. The trade-off is that you can no longer claim ITC on the GST you pay for kit, cosmetics, rent or utilities, so factor those costs into your service rate rather than expecting to offset them."
      },
      {
        "q": "Do I even need to register for GST as a freelance makeup artist?",
        "a": "Only if your annual service turnover crosses ₹20 lakh (₹10 lakh in special-category states). Below that you invoice without GST and simply don't add any tax line. Many freelance artists operate under this threshold, but once you're registered you must charge 5% and quote SAC code 999721 on every invoice."
      },
      {
        "q": "How do I show the advance / booking deposit on the invoice?",
        "a": "Raise a receipt-cum-invoice for the advance when you take it, charging GST on that amount at the time of receipt (advances for services are taxable). On the final invoice, list the full service value, apply 5% GST, then deduct the advance already received to show the balance payable — this keeps your date-blocking deposit fully accounted for."
      },
      {
        "q": "Can I bill trials, draping and outstation travel separately?",
        "a": "Yes — trial sessions, saree/dupatta draping, extra guest looks and outstation travel or stay are best shown as separate line items rather than bundled into one 'bridal package' figure. It makes your pricing transparent for the client and, if you're GST-registered, the same 5% rate applies uniformly across all these beauty-service line items."
      }
    ],
    "metaDescription": "Free Makeup Artistry Invoice Format for Indian freelance makeup artists — correct GST SAC code 999721, the new 5% GST rate, bridal & event sample line items, advance-payment norms and FAQs."
  },
  {
    "slug": "fitness-trainers",
    "name": "Fitness Training",
    "who": "a personal trainer / fitness coach",
    "sacCode": "999723",
    "sacDescription": "Physical well-being services including health club and fitness centre",
    "gstRate": 18,
    "intro": "As a personal trainer or fitness coach in India, your services fall under SAC 999723 (\"physical well-being services including health club and fitness centre\") and attract 18% GST. Unlike medical or healthcare services (which are GST-exempt), fitness coaching is fully taxable, so once your annual turnover crosses Rs. 20 lakh (Rs. 10 lakh in special-category states) you must register for GST and charge it on every invoice. A clean, GST-ready invoice with your SAC code, session details, and clear payment terms keeps your training practice audit-ready.",
    "sampleItems": [
      {
        "desc": "Personal training session (1-on-1, 60 min)",
        "unit": "per session",
        "typicalRate": 800
      },
      {
        "desc": "Monthly personal training package (12 sessions)",
        "unit": "per month",
        "typicalRate": 8000
      },
      {
        "desc": "Online / virtual coaching (monthly)",
        "unit": "per month",
        "typicalRate": 4000
      },
      {
        "desc": "Customised diet and nutrition plan",
        "unit": "per plan",
        "typicalRate": 2500
      },
      {
        "desc": "Group fitness / bootcamp class",
        "unit": "per person / month",
        "typicalRate": 3000
      },
      {
        "desc": "Fitness assessment and goal-setting consultation",
        "unit": "per session",
        "typicalRate": 1000
      }
    ],
    "paymentNorm": "Personal training is almost always billed upfront — clients pay for a monthly package or a block of sessions before training begins, typically via UPI, bank transfer, or in-app payment. One-off sessions are usually collected on the day. Package fees are commonly non-refundable for unused sessions unless your policy states otherwise, so spell this out on the invoice.",
    "faq": [
      {
        "q": "What GST rate and SAC code do I use as a personal trainer?",
        "a": "Fitness and personal training services fall under SAC 999723 (\"physical well-being services including health club and fitness centre\") and are taxed at 18% GST (9% CGST + 9% SGST within a state, or 18% IGST across states). This is a standard-rated service, not exempt."
      },
      {
        "q": "Is fitness coaching GST-exempt like healthcare or yoga?",
        "a": "No. Only clinical healthcare by recognised medical practitioners is exempt, and charitable yoga by registered entities gets a separate exemption. Commercial personal training, gym coaching, and paid fitness classes are fully taxable at 18% — do not mark them exempt on your invoice."
      },
      {
        "q": "Do I have to register for GST as an independent trainer?",
        "a": "Only once your aggregate annual turnover exceeds Rs. 20 lakh (Rs. 10 lakh in special-category states). Below that you can invoice without charging GST, but you must not show a GSTIN or collect tax. Once registered, charge 18% and quote your GSTIN and SAC 999723 on every invoice."
      },
      {
        "q": "How should I invoice a multi-session package versus single sessions?",
        "a": "For packages, describe the block clearly (e.g. \"12 personal training sessions - valid 30 days\") with the total fee, then apply 18% GST on that amount. Issue the tax invoice when payment is received. For pay-as-you-go clients, raise a separate invoice per session or a monthly consolidated invoice listing each session date."
      }
    ],
    "metaDescription": "Free GST-ready fitness training invoice format for Indian personal trainers and coaches. Includes SAC code 999723, correct 18% GST rate, sample line items, and rates."
  },
  {
    "slug": "astrologers",
    "name": "Astrology",
    "who": "an astrologer / astrology consultant",
    "sacCode": "999799",
    "sacDescription": "Other services nowhere else classified",
    "gstRate": 18,
    "intro": "Whether you consult on kundli matching, muhurat selection, or run monthly gemstone and remedy sessions, a clean invoice keeps your astrology practice professional and audit-ready. In India, astrology and consultation services attract 18% GST under SAC 999799, and unlike healthcare or education there is no exemption — so if you are registered, you must charge it. This format is built for Indian astrologers billing individual clients and corporate/event bookings alike.",
    "sampleItems": [
      {
        "desc": "Detailed birth chart (kundli) analysis with written report",
        "unit": "per report",
        "typicalRate": 1500
      },
      {
        "desc": "Kundli matching / horoscope compatibility (guna milan)",
        "unit": "per pair",
        "typicalRate": 2100
      },
      {
        "desc": "Personal consultation call (astrology reading)",
        "unit": "per 45-min session",
        "typicalRate": 1100
      },
      {
        "desc": "Muhurat / auspicious date selection",
        "unit": "per event",
        "typicalRate": 1100
      },
      {
        "desc": "Gemstone & remedy recommendation report",
        "unit": "per report",
        "typicalRate": 900
      },
      {
        "desc": "Annual varshphal (yearly prediction) report",
        "unit": "per report",
        "typicalRate": 2500
      }
    ],
    "paymentNorm": "Astrology consultations are almost always prepaid — full payment is collected before the session or before a written report is delivered, typically via UPI, bank transfer, or a payment link. Corporate, wedding, and event muhurat bookings may run on 50% advance with the balance on delivery. Since the service is delivered instantly, credit terms are rare.",
    "faq": [
      {
        "q": "What GST rate and SAC code apply to astrology services?",
        "a": "Astrology and consultation services fall under SAC 999799 (\"Other services nowhere else classified\") and attract 18% GST. Some practitioners also use SAC 998399 (other professional/technical services) — both carry 18%. There is no exemption for astrology, so if you are GST-registered you must charge 18% on every invoice."
      },
      {
        "q": "Do I even need to register for GST as an astrologer?",
        "a": "Only if your annual turnover crosses the service threshold of ₹20 lakh (₹10 lakh in special-category states). Below that you are not required to register and should not charge GST. If you sell online across state borders through an e-commerce or aggregator platform, registration may be required regardless of turnover — check with a CA."
      },
      {
        "q": "How do I invoice foreign clients who pay in dollars?",
        "a": "Services to a client located outside India, paid in convertible foreign exchange, generally qualify as an export of services and are zero-rated under GST — meaning no 18% is charged. You must still raise a proper invoice, mention it is an export of service, and ideally file a LUT (Letter of Undertaking) so you can export without paying tax. Confirm eligibility with your accountant."
      },
      {
        "q": "Do I need to charge GST on gemstones I sell alongside a reading?",
        "a": "Yes, but separately. A consultation is a service (SAC 999799, 18%), while a physical gemstone is goods with its own HSN code and GST rate. List them as distinct line items so the correct rate applies to each — do not bundle the stone into the consultation charge."
      }
    ],
    "metaDescription": "Free astrology invoice format for Indian astrologers and consultants. Correct GST (18%, SAC 999799), sample line items, payment norms, and FAQs on export of services."
  },
  {
    "slug": "dj-services",
    "name": "DJ & Events",
    "who": "a DJ / event entertainment service",
    "sacCode": "999631",
    "sacDescription": "Services of performing artists including musicians, singers, band players, DJs and entertainers",
    "gstRate": 18,
    "intro": "DJs and event entertainment providers in India bill their gigs under SAC 998596, which covers organisation and support services for events, functions and shows, and attracts GST at 18%. Because most bookings mix a service fee with hired equipment, sound, and lighting, a clear itemised invoice — with your GSTIN, the SAC code, and an advance-vs-balance breakup — protects both you and the client. Use the format below to bill weddings, corporate parties, club nights and private events cleanly.",
    "sampleItems": [
      {
        "desc": "DJ performance (per event / up to 4 hours)",
        "unit": "event",
        "typicalRate": 25000
      },
      {
        "desc": "Additional performance hours beyond package",
        "unit": "hour",
        "typicalRate": 4000
      },
      {
        "desc": "Sound system & speakers rental (per day)",
        "unit": "day",
        "typicalRate": 15000
      },
      {
        "desc": "DJ console, mixer & lighting / LED setup",
        "unit": "day",
        "typicalRate": 12000
      },
      {
        "desc": "Smoke machine, effects & special FX",
        "unit": "unit",
        "typicalRate": 3500
      },
      {
        "desc": "Technician / setup & teardown crew",
        "unit": "person",
        "typicalRate": 2000
      }
    ],
    "paymentNorm": "Most DJs take a 40-50% non-refundable advance to block the date at the time of booking, with the balance due on or before the event day (commonly before the set starts). Peak wedding-season and weekend dates are usually locked only against advance. Overtime beyond the agreed hours is billed at the per-hour rate on the invoice.",
    "faq": [
      {
        "q": "What SAC code and GST rate should a DJ put on an invoice?",
        "a": "Use SAC 998596 (event organisation and support services) with GST at 18% — split as 9% CGST + 9% SGST for a client in your own state, or 18% IGST for an out-of-state client. Registration is only mandatory once your annual turnover crosses Rs 20 lakh (Rs 10 lakh in special-category states); below that you can invoice without charging GST."
      },
      {
        "q": "Should equipment rental and the DJ fee be billed at the same GST rate?",
        "a": "When you offer sound, lighting and DJ performance together as one booking, it is treated as a composite/bundled event service and the whole invoice is taxed at 18% under SAC 998596 — the equipment does not need a separate goods-rental rate. Keep the line items itemised for transparency, but apply one 18% GST on the total."
      },
      {
        "q": "Do I need to charge GST on the advance I collect for a booking?",
        "a": "Yes. For services, GST is payable on advances at the time you receive them, so raise a receipt voucher and account for 18% GST on the booking advance. Adjust it against the final tax invoice on the event date; if a booking is cancelled you can issue a refund voucher for the tax."
      },
      {
        "q": "Can a company deduct TDS on my DJ booking payment?",
        "a": "Yes — corporate and business clients often deduct TDS at 2% under Section 194C (contractor/entertainment services) if the single payment exceeds Rs 30,000 or annual payments cross Rs 1 lakh. This TDS is on the base amount, is separate from GST, and you can claim it back against your income tax. Give the client your PAN so they don't deduct at the higher 20% rate."
      }
    ],
    "metaDescription": "Free DJ & event entertainment invoice format for India with the correct SAC code 998596, 18% GST, sample line items, booking-advance norms and DJ-specific tax FAQs."
  },
  {
    "slug": "voice-over-artists",
    "name": "Voice-over",
    "who": "a freelance voice-over artist",
    "sacCode": "999631",
    "sacDescription": "Services of performing artists (including readers/narrators)",
    "gstRate": 18,
    "intro": "As a freelance voice-over artist in India, your work falls under SAC 999631 — \"services of performing artists,\" which explicitly covers readers and narrators — and is taxed at 18% GST once you cross the ₹20 lakh registration threshold (₹10 lakh in special-category states). A clear voice-over invoice should separate the recording fee from usage/broadcast rights and spell out how retakes and pickups are billed, since production houses and ad agencies routinely deduct 10% TDS under Section 194J before paying you.",
    "sampleItems": [
      {
        "desc": "Corporate/explainer video narration (finished audio)",
        "unit": "per finished minute",
        "typicalRate": 1200
      },
      {
        "desc": "E-learning / instructional module narration",
        "unit": "per finished minute",
        "typicalRate": 800
      },
      {
        "desc": "TV/radio commercial voice-over (up to 30 sec spot)",
        "unit": "per spot",
        "typicalRate": 5000
      },
      {
        "desc": "IVR / on-hold phone prompts",
        "unit": "per prompt/line",
        "typicalRate": 250
      },
      {
        "desc": "Audiobook / long-form narration",
        "unit": "per finished hour",
        "typicalRate": 3500
      },
      {
        "desc": "Broadcast/digital usage (buyout) rights",
        "unit": "per campaign",
        "typicalRate": 8000
      }
    ],
    "paymentNorm": "Standard practice is 50% advance to lock studio dates and 50% on delivery of final approved audio; agencies and production houses usually pay net 30–45 days and deduct 10% TDS under Section 194J. Include one or two rounds of minor retakes in the base fee and bill additional pickups or script changes separately.",
    "faq": [
      {
        "q": "What GST rate and SAC code do I put on a voice-over invoice?",
        "a": "Use SAC 999631 (services of performing artists, which covers readers/narrators) and charge 18% GST. Split it as 9% CGST + 9% SGST for clients in your own state, or 18% IGST for out-of-state and export clients. You only need to register and charge GST once your annual turnover crosses ₹20 lakh (₹10 lakh in special-category states)."
      },
      {
        "q": "Should I charge separately for usage or broadcast rights?",
        "a": "Yes. The recording fee pays for your time in the booth; usage/buyout is a separate line for where and how long the audio airs (TV, radio, digital, or in-perpetuity). A voice for a national ad campaign commands a much higher usage fee than an internal training video, so list the recording fee and the usage/rights fee as distinct line items — both attract 18% GST under 999631."
      },
      {
        "q": "How do I bill retakes, pickups and script changes?",
        "a": "State clearly on the invoice what is included — typically one or two rounds of minor corrections. Charge pickups caused by client-side script edits, added lines, or a change of tone/pace as a separate line item (often a per-word, per-line, or half-session studio rate), so scope creep does not eat into your original quote."
      },
      {
        "q": "Why is 10% TDS deducted from my payment, and can I recover it?",
        "a": "Voice-over is treated as a professional service, so companies deduct 10% TDS under Section 194J on the fee (they deduct on the base amount, not the GST). It is not a loss — it is credited against your income tax. Reconcile it in your Form 26AS/AIS and claim it when filing your return; mentioning your PAN on the invoice ensures the credit reaches you."
      }
    ],
    "metaDescription": "Free voice-over artist invoice format for India with the correct GST SAC code (999631, 18%), sample line items with realistic rates, usage-rights billing, TDS guidance, and FAQs."
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
    <p class="muted" style="font-size:14px;margin-top:6px">Billing from outside India? The <a href="/tools/bill-generator">invoice generator</a> works in any country and currency.</p>
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
      <p class="muted" style="font-size:12.5px;margin-top:8px">Opens the free GST invoice generator, pre-filled with these line items — swap in your own rates, add your GSTIN, and download the PDF.</p>
    </div>
  </div></section>

  <section id="how"><div class="wrap">
    <h2>How to make a ${esc(lower)} invoice</h2>
    <div class="steps">
      <div class="step"><div class="n">1</div><b>Add your details</b><p class="muted">Your name (or the name you freelance under), your GSTIN if you're registered, and the client's details.</p></div>
      <div class="step"><div class="n">2</div><b>Add your work</b><p class="muted">List what you delivered — use the items above as a starting point — under SAC ${esc(s.sacCode)}.</p></div>
      <div class="step"><div class="n">3</div><b>Set GST &amp; download</b><p class="muted">Pick ${esc(String(s.gstRate))}% GST, choose CGST+SGST or IGST, and download the PDF.</p></div>
    </div>
  </div></section>

  <section><div class="wrap">
    <div class="card">
      <h2>What a GST-ready ${esc(lower)} invoice must include</h2>
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
