/**
 * DealInSec — Deal Type Taxonomy
 *
 * Comprehensive catalog of deal categories and output/content types for
 * every type of service business in India. Each dealType has a list of
 * categories grouped by domain, and each category has a list of typical
 * output/type options. Every dropdown also supports an "Other (specify)"
 * free-text fallback, so users are never stuck.
 *
 * Used by:
 *  - shared/schema.ts (validation)
 *  - client/src/pages/create-deal.tsx & edit-deal.tsx (UI dropdowns)
 *  - client/src/pages/deal-details.tsx & deals.tsx (display)
 */

// Phase-1 ICP: B2B service sectors. These are the ONLY selectable types for
// new deals. Legacy types (Creator/Freelance/Consulting/Service Vendor) are no
// longer offered but stay fully supported for existing deals — display,
// editing, quotes and agreement PDFs all keep their original wording.
export const dealTypeOptions = [
  "Real Estate",
  "Interior Design",
  "Architecture",
  "Agency",
  "Construction",
  "Custom",
] as const;

export const legacyDealTypeOptions = [
  "Creator",
  "Freelance",
  "Consulting",
  "Service Vendor",
] as const;

export type DealType = (typeof dealTypeOptions)[number];
export type LegacyDealType = (typeof legacyDealTypeOptions)[number];
export type AnyDealType = DealType | LegacyDealType;

export const dealTypeMeta: Record<AnyDealType, { label: string; description: string; emoji: string; tint: string }> = {
  "Real Estate": {
    label: "Real Estate",
    description: "Sales, rentals, leasing & property services — brokerage and advisory.",
    emoji: "🏢",
    tint: "emerald",
  },
  "Interior Design": {
    label: "Interior Design",
    description: "Home & commercial interiors, modular kitchens, turnkey fit-outs.",
    emoji: "🛋️",
    tint: "teal",
  },
  Architecture: {
    label: "Architecture",
    description: "Building design, drawings, approvals, supervision & PMC.",
    emoji: "📐",
    tint: "indigo",
  },
  Agency: {
    label: "Agency",
    description: "Marketing, creative, digital & web services for client brands.",
    emoji: "🚀",
    tint: "amber",
  },
  Construction: {
    label: "Construction",
    description: "Civil work, turnkey contracting, renovation & trade contracts.",
    emoji: "🏗️",
    tint: "slate",
  },
  Custom: {
    label: "Custom",
    description: "Anything else — free-form deal not covered above.",
    emoji: "⚙️",
    tint: "slate",
  },
  // ── Legacy types (existing deals only, not selectable) ──
  Creator: {
    label: "Creator",
    description: "Brand deals, sponsored content, paid posts on social platforms.",
    emoji: "🎬",
    tint: "emerald",
  },
  Freelance: {
    label: "Freelance",
    description: "Project-based digital work — design, dev, writing, marketing.",
    emoji: "💼",
    tint: "teal",
  },
  Consulting: {
    label: "Consulting",
    description: "Hourly, retainer, coaching, advisory, strategy work.",
    emoji: "💡",
    tint: "indigo",
  },
  "Service Vendor": {
    label: "Service Vendor",
    description: "Event-based, on-site services — photography, training, wellness, home services.",
    emoji: "🎯",
    tint: "amber",
  },
};

// ───────────────────────────────────────────────────────────────────────
// Taxonomy structure: per dealType, groups of categories with sub-options
// ───────────────────────────────────────────────────────────────────────

export interface CategoryGroup {
  group: string;
  options: string[];
}

export interface TaxonomyEntry {
  /** Categories shown in the first deliverable dropdown */
  categories: CategoryGroup[];
  /** Output / content types shown in the second dropdown */
  outputs: CategoryGroup[];
  /** Frequency options specific to this deal type (overrides default if present) */
  frequencies?: string[];
}

export const OTHER_OPTION = "Other (specify)";

// ===================================================================
// CREATOR
// ===================================================================
const creatorTaxonomy: TaxonomyEntry = {
  categories: [
    {
      group: "Global platforms",
      options: [
        "Instagram",
        "YouTube",
        "Twitter (X)",
        "Facebook",
        "LinkedIn",
        "Threads",
        "Pinterest",
        "Snapchat",
        "TikTok",
      ],
    },
    {
      group: "India-first platforms",
      options: ["ShareChat", "Moj", "Josh", "Roposo", "Chingari", "Koo"],
    },
    {
      group: "Audio / Podcast",
      options: ["Spotify", "JioSaavn", "Apple Podcasts", "Amazon Music", "KuKu FM", "Pocket FM"],
    },
    {
      group: "Streaming / Live",
      options: ["Twitch", "YouTube Live", "Instagram Live", "Discord Stage"],
    },
    {
      group: "Newsletter / Writing",
      options: ["Substack", "Beehiiv", "Revue", "Medium", "Personal blog"],
    },
    {
      group: "Messaging / Community",
      options: ["Telegram channel", "WhatsApp Channel", "Discord server"],
    },
  ],
  outputs: [
    {
      group: "Short-form",
      options: ["Reel", "Short", "Story", "Carousel", "Post", "Tweet / Thread"],
    },
    {
      group: "Long-form video",
      options: ["YouTube video", "IGTV / Long Reel", "Stream session", "Webinar"],
    },
    {
      group: "Audio",
      options: ["Podcast episode", "Audio clip", "Music track", "Cover song", "Voiceover"],
    },
    {
      group: "Written",
      options: ["Blog post", "LinkedIn article", "Newsletter issue", "Thread series"],
    },
    {
      group: "Live & Interactive",
      options: ["Live session", "AMA", "Workshop", "Watch party"],
    },
    {
      group: "Other formats",
      options: ["Highlight", "Channel post", "Status update", "Pinned content", "Custom format"],
    },
  ],
};

// ===================================================================
// FREELANCE
// ===================================================================
const freelanceTaxonomy: TaxonomyEntry = {
  categories: [
    {
      group: "Design",
      options: [
        "Graphic design",
        "UI / UX design",
        "Brand identity",
        "Logo design",
        "Motion design",
        "Illustration",
        "Print / Packaging",
        "Web design",
        "Presentation / Pitch design",
        "Social media creatives",
      ],
    },
    {
      group: "Development",
      options: [
        "Web development",
        "Mobile app (iOS / Android)",
        "Backend / API",
        "Frontend",
        "Full-stack",
        "DevOps / Cloud",
        "Data engineering",
        "AI / ML / LLM",
        "Blockchain / Web3",
        "Game development",
        "WordPress / Shopify",
        "Automation (Zapier / Make)",
      ],
    },
    {
      group: "Writing",
      options: [
        "Copywriting",
        "Long-form content",
        "Blog / SEO writing",
        "Technical writing",
        "Ghostwriting",
        "Scriptwriting",
        "Newsletter writing",
        "Resume / LinkedIn writing",
        "Translation",
      ],
    },
    {
      group: "Marketing",
      options: [
        "SEO",
        "Performance marketing",
        "Social media management",
        "Email marketing",
        "Influencer marketing",
        "Brand strategy",
        "Content marketing",
        "PR / Communications",
        "Community management",
      ],
    },
    {
      group: "Video & Audio",
      options: [
        "Video editing — Reels / Shorts",
        "Video editing — YouTube",
        "Wedding video editing",
        "Motion graphics",
        "VFX",
        "Color grading",
        "Sound design",
        "Music production",
        "Voiceover / Dubbing",
        "Animation — 2D",
        "Animation — 3D",
        "Animation — Whiteboard / Explainer",
      ],
    },
    {
      group: "Visual",
      options: [
        "Product photography (freelance)",
        "Event photography",
        "Portrait photography",
        "3D modeling / CAD",
        "Architecture visualization",
        "Interior render",
      ],
    },
    {
      group: "Business support",
      options: [
        "Virtual assistance",
        "Data entry / Research",
        "Lead generation",
        "Customer support",
        "Bookkeeping",
        "Accounting / Tax filing",
        "Legal drafting",
        "HR / Recruitment",
        "Project management",
      ],
    },
    {
      group: "Education / Training",
      options: ["Course creation", "Curriculum design", "Online tutoring", "Language teaching"],
    },
  ],
  outputs: [
    {
      group: "Project-based",
      options: ["One-time project", "Fixed scope deliverable", "Milestone-based", "Phased rollout"],
    },
    {
      group: "Time-based",
      options: ["Hourly", "Daily rate", "Weekly", "Monthly retainer"],
    },
    {
      group: "Sprint / Iterative",
      options: ["Sprint (1 week)", "Sprint (2 weeks)", "Per feature", "Per module"],
    },
    {
      group: "Volume-based",
      options: ["Per word", "Per article", "Per asset", "Per page", "Per design"],
    },
  ],
};

// ===================================================================
// CONSULTING
// ===================================================================
const consultingTaxonomy: TaxonomyEntry = {
  categories: [
    {
      group: "Business & Strategy",
      options: [
        "Business strategy",
        "Operations consulting",
        "Growth / Go-to-market",
        "Product management",
        "Sales strategy",
        "Business turnaround",
        "Mergers & acquisitions",
      ],
    },
    {
      group: "Marketing & Brand",
      options: ["Marketing strategy", "Brand consulting", "PR / Communications", "SEO audit", "Funnel audit"],
    },
    {
      group: "Tech & Product",
      options: ["Tech architecture", "Engineering management", "Product strategy", "DevOps consulting", "AI strategy", "Cybersecurity advisory"],
    },
    {
      group: "Finance & Legal",
      options: [
        "CA / Tax advisory",
        "GST consultation",
        "Bookkeeping advisory",
        "Investment advisory (SEBI-registered)",
        "Wealth management",
        "Legal counsel",
        "Compliance / Regulatory",
        "Contract review",
      ],
    },
    {
      group: "People & Culture",
      options: ["HR consulting", "Talent acquisition", "Org design", "Compensation design", "Performance management"],
    },
    {
      group: "Coaching",
      options: [
        "Executive / Leadership coaching",
        "Career coaching",
        "Life coaching",
        "Sales coaching",
        "Public speaking coaching",
        "Interview prep",
      ],
    },
    {
      group: "Education & Mentorship",
      options: ["Academic mentorship", "Research advisory", "Curriculum consulting", "Study abroad counseling"],
    },
    {
      group: "Health & Wellness",
      options: ["Nutrition consulting", "Mental wellness counseling", "Therapy", "Sports performance"],
    },
    {
      group: "Industry-specific",
      options: ["Real estate advisory", "Healthcare consulting", "Hospitality consulting", "Manufacturing / Supply chain"],
    },
  ],
  outputs: [
    {
      group: "Time-based",
      options: ["Hourly call", "Half-day", "Full day", "Weekly retainer", "Monthly retainer", "Quarterly retainer"],
    },
    {
      group: "Session-based",
      options: ["1-on-1 session", "Group session", "Mastermind", "Workshop", "Webinar", "Bootcamp"],
    },
    {
      group: "Deliverable-based",
      options: ["Audit report", "Strategy document", "Roadmap", "Action plan", "Implementation plan", "Diagnostic"],
    },
    {
      group: "Long-term",
      options: ["Project engagement (1-3 months)", "Long-term engagement (3-12 months)", "Embedded advisor"],
    },
  ],
};

// ===================================================================
// SERVICE VENDOR — biggest list, covers Indian service economy
// ===================================================================
const serviceVendorTaxonomy: TaxonomyEntry = {
  categories: [
    {
      group: "Wedding",
      options: [
        "Wedding photography",
        "Wedding videography (cinematography)",
        "Wedding planning",
        "Wedding decoration",
        "Mandap setup",
        "Bridal makeup",
        "Groom makeup / styling",
        "Mehendi artist",
        "Wedding catering",
        "Wedding music / DJ",
        "Live band / Sangeet",
        "Pandit / Officiant",
        "Pre-wedding shoot",
        "Wedding invitation design",
      ],
    },
    {
      group: "Events & Corporate",
      options: [
        "Corporate event management",
        "Conference / Summit management",
        "Product launch",
        "Birthday party planning",
        "Anniversary planning",
        "Baby shower / Naming ceremony",
        "Engagement / Reception",
        "Festival / Cultural event",
        "House warming",
      ],
    },
    {
      group: "Photography studio",
      options: [
        "Maternity shoot",
        "Newborn shoot",
        "Family portrait",
        "Fashion shoot",
        "Real estate photography",
        "Food / Restaurant photography",
        "Pet photography",
        "Product photography",
        "Headshots",
      ],
    },
    {
      group: "Videography",
      options: [
        "Corporate video",
        "Music video",
        "Short film",
        "Documentary",
        "Reels / Brand content",
        "YouTube video shoot",
        "Drone videography",
      ],
    },
    {
      group: "Beauty & Personal care",
      options: [
        "Bridal makeup artist",
        "Party makeup",
        "Photoshoot makeup",
        "Hair styling",
        "Hair coloring",
        "Salon services",
        "Nail art",
        "Spa & massage",
        "Mehendi (party / bridal)",
        "Pre-wedding grooming",
      ],
    },
    {
      group: "Fitness & Sports",
      options: [
        "Personal training",
        "Yoga instructor",
        "Zumba / Dance fitness",
        "Pilates",
        "Sports coaching (cricket, football, etc.)",
        "Swimming coach",
        "Martial arts trainer",
        "Calisthenics",
      ],
    },
    {
      group: "Tutoring & Coaching",
      options: [
        "Academic tutoring (school)",
        "JEE / NEET coaching",
        "CA / CS / Banking coaching",
        "IELTS / TOEFL / GRE prep",
        "Language teaching",
        "Music lessons (vocal / instrumental)",
        "Dance classes",
        "Art / Craft classes",
        "Coding for kids",
        "Public speaking",
      ],
    },
    {
      group: "Wellness & Therapy",
      options: [
        "Massage therapy",
        "Spa treatment",
        "Reiki / Energy healing",
        "Sound healing",
        "Pranic healing",
        "Psychotherapy / Counseling",
        "Naturopathy",
        "Ayurveda consultation",
        "Acupressure / Acupuncture",
      ],
    },
    {
      group: "Home services",
      options: [
        "Deep cleaning",
        "Regular housekeeping",
        "Painting",
        "Plumbing",
        "Electrical work",
        "Carpentry",
        "Pest control",
        "Appliance repair (AC, fridge, etc.)",
        "Home renovation",
        "Modular kitchen / Wardrobe",
      ],
    },
    {
      group: "Auto services",
      options: ["Car detailing", "Car repair", "Bike service", "Vinyl wrapping", "Modifications", "Driving school"],
    },
    {
      group: "Tech repair",
      options: ["Phone repair", "Laptop repair", "AC / Refrigerator repair", "TV / Home theatre", "Computer setup"],
    },
    {
      group: "Pet services",
      options: ["Pet grooming", "Pet boarding", "Pet walking", "Pet training", "Veterinary house visit"],
    },
    {
      group: "Care services",
      options: ["Babysitting / Nanny", "Daycare", "Elder care", "Patient care", "Postnatal care"],
    },
    {
      group: "Travel & Tourism",
      options: ["Tour guide", "Custom itinerary planning", "Travel booking agent", "Adventure activities", "Trek guide"],
    },
    {
      group: "Catering & Food",
      options: ["Wedding catering", "Tiffin service", "Home chef", "Corporate catering", "Live counter (chaat / dosa)", "Cake / Bakery custom orders"],
    },
    {
      group: "Decoration & Floristry",
      options: ["Floral decoration", "Stage decoration", "Mandap / Pandal", "Birthday balloon decor", "Anniversary surprise setup"],
    },
    {
      group: "Wardrobe & Styling",
      options: ["Personal styling", "Wardrobe consulting", "Fashion stylist (shoots)", "Personal shopping"],
    },
    {
      group: "Driving & Mobility",
      options: ["Chauffeur (city)", "Outstation driver", "Self-drive rental coordination"],
    },
    {
      group: "Religious & Spiritual",
      options: ["Pandit (puja)", "Priest (church)", "Maulana / Imam services", "Pujari (temple)", "Funeral services", "Religious ceremony planning"],
    },
    {
      group: "Astrology & Vastu",
      options: ["Astrology consultation", "Tarot reading", "Vastu consultation", "Numerology", "Palmistry"],
    },
    {
      group: "Real estate & Interior",
      options: ["Real estate brokerage", "Property consultation", "Interior design", "Architecture services", "Home staging"],
    },
    {
      group: "Translation & Language services",
      options: ["Verbal translation / Interpreter", "Document translation", "Sign language interpreter"],
    },
    {
      group: "Performance & Entertainment",
      options: ["Stand-up comedian", "Musician (live)", "Anchor / Emcee", "Magician", "Dancer (event)", "Singer for events"],
    },
  ],
  outputs: [
    {
      group: "Event-based",
      options: ["Per event", "Per shoot", "Per session", "Per day", "Per half-day", "Per booking"],
    },
    {
      group: "Subscription / Recurring",
      options: ["Monthly retainer", "Quarterly", "Annual", "Per week"],
    },
    {
      group: "Package-based",
      options: ["Basic package", "Standard package", "Premium package", "Custom package"],
    },
    {
      group: "Time-based",
      options: ["Hourly", "Per class", "Per visit", "Per appointment"],
    },
    {
      group: "Output-based",
      options: ["Per delivered photo album", "Per video edit", "Per setup", "Per service unit"],
    },
  ],
};

// ===================================================================
// REAL ESTATE — Phase 1
// ===================================================================
const realEstateTaxonomy: TaxonomyEntry = {
  categories: [
    {
      group: "Residential",
      options: [
        "Flat / Apartment sale",
        "Independent house / Villa sale",
        "Residential rental / lease",
        "Plot / Land sale",
        "Farmhouse / Second home",
        "Resale transaction",
      ],
    },
    {
      group: "Commercial",
      options: [
        "Office space sale",
        "Office leasing",
        "Retail / Shop leasing",
        "Warehouse / Industrial",
        "Co-working space",
        "Land for development",
      ],
    },
    {
      group: "Services",
      options: [
        "Property management",
        "Tenant sourcing",
        "Property valuation",
        "Home staging",
        "Title / Documentation assistance",
        "Home loan assistance",
        "Society transfer / Registration support",
        "Vastu consultation",
      ],
    },
  ],
  outputs: [
    {
      group: "Brokerage",
      options: [
        "Brokerage — % of sale value",
        "Brokerage — 1 month rent",
        "Brokerage — 2 months rent",
        "Fixed brokerage fee",
      ],
    },
    {
      group: "Retainers",
      options: ["Monthly property management fee", "Annual maintenance contract"],
    },
    {
      group: "Per-service",
      options: ["Consultation fee", "Per valuation report", "Per documentation service", "Per site visit"],
    },
  ],
};

// ===================================================================
// INTERIOR DESIGN — Phase 1
// ===================================================================
const interiorDesignTaxonomy: TaxonomyEntry = {
  categories: [
    {
      group: "Residential",
      options: [
        "Full home interiors",
        "Modular kitchen",
        "Wardrobes / Storage",
        "Living room",
        "Bedroom",
        "Bathroom renovation",
        "Balcony / Terrace",
        "Pooja room",
      ],
    },
    {
      group: "Commercial",
      options: [
        "Office interiors",
        "Retail store design",
        "Restaurant / Café design",
        "Clinic / Hospital interiors",
        "Salon / Spa design",
        "Showroom design",
        "Hotel / Hospitality",
      ],
    },
    {
      group: "Services",
      options: [
        "Turnkey execution",
        "Design consultation",
        "3D visualization / Renders",
        "Space planning",
        "Custom furniture design",
        "Decor & styling",
        "Lighting design",
        "False ceiling",
        "Painting & wall finishes",
        "Civil + interior renovation",
      ],
    },
  ],
  outputs: [
    {
      group: "Area-based",
      options: ["Per sq ft — design only", "Per sq ft — with execution"],
    },
    {
      group: "Project-based",
      options: ["Lump-sum project fee", "Turnkey package", "Room-wise package", "Milestone-based"],
    },
    {
      group: "Service-based",
      options: ["Design consultation fee", "Per 3D render", "Monthly retainer", "Per supervision visit"],
    },
  ],
};

// ===================================================================
// ARCHITECTURE — Phase 1
// ===================================================================
const architectureTaxonomy: TaxonomyEntry = {
  categories: [
    {
      group: "Design",
      options: [
        "Residential building design",
        "Commercial building design",
        "Industrial / Warehouse design",
        "Institutional (school / hospital)",
        "Landscape design",
        "Interior architecture",
        "Vastu-compliant design",
      ],
    },
    {
      group: "Drawings & Approvals",
      options: [
        "Concept & schematic design",
        "Working drawings (GFC)",
        "Structural drawings",
        "MEP coordination",
        "Municipal sanction / Liaison",
        "RERA documentation",
        "As-built drawings",
      ],
    },
    {
      group: "Services",
      options: [
        "3D visualization",
        "Site supervision",
        "Project management (PMC)",
        "Renovation / Retrofit design",
        "Estimation & BOQ",
      ],
    },
  ],
  outputs: [
    {
      group: "Fee models",
      options: [
        "% of construction cost",
        "Per sq ft design fee",
        "Lump-sum design fee",
        "Stage-wise / milestone billing",
      ],
    },
    {
      group: "Per-service",
      options: ["Per drawing set", "Per 3D view", "Per site visit", "Monthly PMC retainer"],
    },
  ],
};

// ===================================================================
// AGENCY — Phase 1 (marketing / creative / digital / web)
// ===================================================================
const agencyTaxonomy: TaxonomyEntry = {
  categories: [
    {
      group: "Digital marketing",
      options: [
        "SEO",
        "Performance marketing (Google / Meta ads)",
        "Social media management",
        "Content marketing",
        "Email / WhatsApp marketing",
        "Influencer campaign management",
        "Marketplace management (Amazon / Flipkart)",
      ],
    },
    {
      group: "Creative & Brand",
      options: [
        "Brand identity / Logo",
        "Graphic design",
        "Packaging design",
        "Ad films / Video production",
        "Product photography",
        "Copywriting",
      ],
    },
    {
      group: "Web & Tech",
      options: [
        "Website design & development",
        "E-commerce store",
        "Mobile app development",
        "Landing pages / Funnels",
        "CRM / Automation setup",
        "AI chatbot / Automation",
      ],
    },
    {
      group: "PR & Events",
      options: ["Public relations", "Media buying", "Event marketing", "Exhibition / Trade show"],
    },
  ],
  outputs: [
    {
      group: "Recurring",
      options: ["Monthly retainer", "Quarterly retainer", "% of ad spend"],
    },
    {
      group: "Project-based",
      options: ["Per campaign", "Per project", "Per deliverable / asset", "One-time setup fee"],
    },
    {
      group: "Performance",
      options: ["Per lead", "Per sale / conversion", "Hybrid (retainer + performance)"],
    },
  ],
};

// ===================================================================
// CONSTRUCTION — Phase 1
// ===================================================================
const constructionTaxonomy: TaxonomyEntry = {
  categories: [
    {
      group: "Building",
      options: [
        "New residential construction",
        "Commercial construction",
        "Villa / Bungalow construction",
        "Building renovation",
        "Structure repair / Retrofitting",
        "Extension / Additional floor",
      ],
    },
    {
      group: "Contracting",
      options: [
        "Turnkey (with material)",
        "Labour contract",
        "Item-rate contract",
        "Civil works",
        "RCC / Structural work",
        "Masonry / Plastering",
      ],
    },
    {
      group: "Trades",
      options: [
        "Electrical contracting",
        "Plumbing contracting",
        "Painting",
        "Waterproofing",
        "Flooring / Tiling",
        "Fabrication (MS / SS)",
        "Aluminium / Glass work",
        "Carpentry / Woodwork",
        "POP / False ceiling",
        "Landscaping / Paving",
      ],
    },
  ],
  outputs: [
    {
      group: "Area-based",
      options: ["Per sq ft — with material (turnkey)", "Per sq ft — labour only"],
    },
    {
      group: "Contract-based",
      options: ["Item-rate (BOQ)", "Lump-sum contract", "RA bills / milestone billing"],
    },
    {
      group: "Time & maintenance",
      options: ["Per day labour", "AMC / maintenance contract"],
    },
  ],
};

// ===================================================================
// CUSTOM — free-form
// ===================================================================
const customTaxonomy: TaxonomyEntry = {
  categories: [
    {
      group: "Free-form",
      options: [], // empty → triggers free-text input in UI
    },
  ],
  outputs: [
    {
      group: "Free-form",
      options: [],
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────

export const TAXONOMY: Record<AnyDealType, TaxonomyEntry> = {
  "Real Estate": realEstateTaxonomy,
  "Interior Design": interiorDesignTaxonomy,
  Architecture: architectureTaxonomy,
  Agency: agencyTaxonomy,
  Construction: constructionTaxonomy,
  Custom: customTaxonomy,
  // Legacy (existing deals only)
  Creator: creatorTaxonomy,
  Freelance: freelanceTaxonomy,
  Consulting: consultingTaxonomy,
  "Service Vendor": serviceVendorTaxonomy,
};

/** Flat list of all category options for a given dealType (for searchable dropdowns). */
export function getCategoryOptions(dealType: AnyDealType): { group: string; option: string }[] {
  const entry = TAXONOMY[dealType] ?? TAXONOMY.Custom;
  const flat: { group: string; option: string }[] = [];
  for (const g of entry.categories) {
    for (const opt of g.options) {
      flat.push({ group: g.group, option: opt });
    }
  }
  return flat;
}

/** Flat list of all output options for a given dealType. */
export function getOutputOptions(dealType: AnyDealType): { group: string; option: string }[] {
  const entry = TAXONOMY[dealType] ?? TAXONOMY.Custom;
  const flat: { group: string; option: string }[] = [];
  for (const g of entry.outputs) {
    for (const opt of g.options) {
      flat.push({ group: g.group, option: opt });
    }
  }
  return flat;
}

// ───────────────────────────────────────────────────────────────────────
// Agreement document copy — deal-type-aware language for the generated PDF
// ───────────────────────────────────────────────────────────────────────

export interface AgreementCopy {
  /** Banner title of the agreement PDF */
  title: string;
  /** Party A label (the user) — e.g. "Creator / Influencer", "Service Provider" */
  providerRole: string;
  /** Inline noun for the user, capitalised — e.g. "Creator", "Freelancer" */
  providerNoun: string;
  /** Party B label (the counterparty) */
  clientRole: string;
  /** Inline noun for the counterparty — e.g. "Brand", "Client" */
  clientNoun: string;
  /** Field label used for the counterparty's name in the parties block */
  clientFieldLabel: string;
  /** Phrase describing the services, used in the Scope clause */
  serviceDescription: string;
  /** Compliance sentence tail for the Scope clause */
  complianceNote: string;
  /** Heading for the rights/ownership clause */
  rightsHeading: string;
  /** Full paragraph for the rights/ownership clause */
  rightsText: string;
  /** Exclusivity clause text when the deal is exclusive */
  exclusiveText: string;
  /** Exclusivity clause text when the deal is non-exclusive */
  nonExclusiveText: string;
}

const AGREEMENT_COPY: Record<AnyDealType, AgreementCopy> = {
  "Real Estate": {
    title: "Real Estate Services Agreement",
    providerRole: "Broker / Real Estate Consultant",
    providerNoun: "Consultant",
    clientRole: "Client",
    clientNoun: "Client",
    clientFieldLabel: "Client Name",
    serviceDescription: "real estate brokerage and advisory services",
    complianceNote:
      "All services shall be rendered professionally and in compliance with applicable laws, including the Real Estate (Regulation and Development) Act, 2016 (RERA) where applicable.",
    rightsHeading: "Brokerage & Disclosure",
    rightsText:
      "The brokerage/fee becomes payable as per the agreed billing basis upon successful closure of the transaction or completion of the agreed service. The Consultant shall share property information in good faith based on details available from owners/developers, and does not guarantee closure of any transaction. Each party shall keep the other's commercial information confidential.",
    exclusiveText:
      "This Agreement is EXCLUSIVE. During the Agreement period, the Client shall route the sale, purchase or leasing of the subject property exclusively through the Consultant, and shall not engage another broker or conclude a direct transaction for the same property without the Consultant's prior written consent.",
    nonExclusiveText:
      "This Agreement is NON-EXCLUSIVE. The Client may engage other brokers or channels for the same requirement, and brokerage shall be payable only on a transaction concluded through the Consultant.",
  },
  "Interior Design": {
    title: "Interior Design Services Agreement",
    providerRole: "Interior Designer / Design Studio",
    providerNoun: "Designer",
    clientRole: "Client",
    clientNoun: "Client",
    clientFieldLabel: "Client Name",
    serviceDescription: "interior design and execution services",
    complianceNote:
      "All work shall be executed with professional workmanship, using materials of the agreed specification, and in compliance with applicable safety and quality standards.",
    rightsHeading: "Design Ownership & Usage",
    rightsText:
      "All designs, drawings and renders remain the intellectual property of the Designer until full and final payment, after which the Client receives the right to use them for the subject property. Designs may not be reused on other sites without the Designer's written consent. The Designer may photograph the completed work for portfolio and promotional use unless the Client declines in writing.",
    exclusiveText:
      "This Agreement is EXCLUSIVE for its scope. During the Agreement period, the Client shall not engage another designer or contractor for the same scope of work without the Designer's prior written consent.",
    nonExclusiveText:
      "This Agreement is NON-EXCLUSIVE. The Designer may serve other clients during the period, provided the commitments and timelines under this Agreement are fully honoured.",
  },
  Architecture: {
    title: "Architectural Services Agreement",
    providerRole: "Architect / Architecture Firm",
    providerNoun: "Architect",
    clientRole: "Client",
    clientNoun: "Client",
    clientFieldLabel: "Client Name",
    serviceDescription: "architectural design and consultancy services",
    complianceNote:
      "All designs and drawings shall conform to applicable building bye-laws, the National Building Code, and professional standards; statutory approvals remain subject to the concerned authorities.",
    rightsHeading: "Drawings, IP & Site Decisions",
    rightsText:
      "All drawings, designs and documents remain the intellectual property of the Architect. Upon full payment, the Client receives a license to use them solely for the subject project/site; reuse on any other site requires the Architect's written consent. The Client shall not make structural changes to the design during execution without the Architect's concurrence.",
    exclusiveText:
      "This Agreement is EXCLUSIVE for its scope. During the Agreement period, the Client shall not engage another architect for the same scope without the Architect's prior written consent.",
    nonExclusiveText:
      "This Agreement is NON-EXCLUSIVE. The Architect may take up other projects during the period, provided the commitments under this Agreement are honoured.",
  },
  Agency: {
    title: "Agency Services Agreement",
    providerRole: "Agency / Service Provider",
    providerNoun: "Agency",
    clientRole: "Client / Brand",
    clientNoun: "Client",
    clientFieldLabel: "Client Name",
    serviceDescription: "marketing, creative and digital services",
    complianceNote:
      "All work shall be original, professionally produced, and compliant with applicable advertising standards (including ASCI guidelines) and platform policies.",
    rightsHeading: "Deliverables, IP & Portfolio",
    rightsText:
      "Upon full and final payment, the Agency assigns to the Client the rights to the final deliverables produced under this Agreement. The Agency retains ownership of its pre-existing materials, tools, templates and processes, and the right to showcase the work in its portfolio and award entries unless the Client declines in writing. Third-party costs (ad spend, stock assets, licenses) are billed separately unless agreed otherwise.",
    exclusiveText:
      "This Agreement is EXCLUSIVE for its scope. During the Agreement period, the Agency shall not provide the same services to a direct competitor of the Client in the same category without prior written consent.",
    nonExclusiveText:
      "This Agreement is NON-EXCLUSIVE. The Agency may serve other clients during the period, provided no conflict of interest arises and the commitments under this Agreement are honoured.",
  },
  Construction: {
    title: "Works Contract Agreement",
    providerRole: "Contractor",
    providerNoun: "Contractor",
    clientRole: "Client / Owner",
    clientNoun: "Client",
    clientFieldLabel: "Client Name",
    serviceDescription: "construction and works contract services",
    complianceNote:
      "All work shall be executed as per the agreed drawings/specifications and in compliance with applicable building codes, safety standards and labour laws.",
    rightsHeading: "Materials, Workmanship & Defects",
    rightsText:
      "Materials shall conform to the agreed specifications/BOQ, and workmanship shall be of professional standard. The Contractor shall rectify defects attributable to workmanship reported within the agreed defect-liability period at no extra cost. Extra items or changes in scope shall be executed only against written approval and billed at agreed rates. Site safety during execution is the Contractor's responsibility.",
    exclusiveText:
      "This Agreement is EXCLUSIVE for its scope. The Contractor commits the agreed resources to the work, and the Client shall not engage a parallel contractor for the same scope during the Agreement period without prior written consent.",
    nonExclusiveText:
      "This Agreement is NON-EXCLUSIVE. The Contractor may undertake other projects during the period, provided the agreed manpower, timelines and quality under this Agreement are maintained.",
  },
  Creator: {
    title: "Influencer Marketing Agreement",
    providerRole: "Creator / Influencer",
    providerNoun: "Creator",
    clientRole: "Brand / Client",
    clientNoun: "Brand",
    clientFieldLabel: "Brand Name",
    serviceDescription: "influencer marketing and content creation services",
    complianceNote: "All content shall be original, professionally produced, and compliant with applicable advertising standards and platform policies (including ASCI guidelines).",
    rightsHeading: "Content Rights & Usage",
    rightsText:
      "Upon full payment, the Creator grants the Brand a non-exclusive, worldwide, royalty-free license to use, reproduce, display, and distribute the content for marketing and promotional purposes for 12 months following the Agreement expiry. The Creator retains all ownership rights and may use the content for personal portfolio purposes.",
    exclusiveText:
      "This Agreement is EXCLUSIVE. During the Agreement period, the Creator shall not enter into similar influencer marketing arrangements with direct competitors of the Brand without prior written consent. All brand deals during this period must be registered on the Dealinsec platform.",
    nonExclusiveText:
      "This Agreement is NON-EXCLUSIVE. The Creator may engage with other brands and clients during the Agreement period, provided such engagements do not directly conflict with or diminish the promotional value of this Agreement.",
  },
  Freelance: {
    title: "Freelance Services Agreement",
    providerRole: "Freelancer / Service Provider",
    providerNoun: "Freelancer",
    clientRole: "Client",
    clientNoun: "Client",
    clientFieldLabel: "Client Name",
    serviceDescription: "freelance professional services",
    complianceNote: "All work shall be original, professionally executed, and compliant with applicable laws and industry standards.",
    rightsHeading: "Work Product & Ownership",
    rightsText:
      "Upon full and final payment, the Freelancer assigns to the Client all rights, title, and interest in the final deliverables produced under this Agreement. Until full payment is received, all work product remains the property of the Freelancer. The Freelancer retains the right to display the work in their portfolio unless otherwise agreed in writing.",
    exclusiveText:
      "This Agreement is EXCLUSIVE for its scope. During the Agreement period, the Freelancer shall not provide identical competing deliverables to a direct competitor of the Client for the same project without prior written consent.",
    nonExclusiveText:
      "This Agreement is NON-EXCLUSIVE. The Freelancer may take on other clients and projects during the Agreement period, provided such work does not delay or compromise the deliverables agreed herein.",
  },
  Consulting: {
    title: "Consulting Services Agreement",
    providerRole: "Consultant / Advisor",
    providerNoun: "Consultant",
    clientRole: "Client",
    clientNoun: "Client",
    clientFieldLabel: "Client Name",
    serviceDescription: "professional consulting and advisory services",
    complianceNote: "All advice and deliverables shall be provided professionally and in good faith, in compliance with applicable laws and professional standards.",
    rightsHeading: "Deliverables & Confidentiality",
    rightsText:
      "All reports, recommendations, and deliverables prepared under this Agreement are provided for the Client's internal use upon full payment. Both parties shall keep confidential any proprietary or sensitive information disclosed during the engagement. The Consultant's advice is provided in good faith and does not constitute a guarantee of specific business outcomes.",
    exclusiveText:
      "This Agreement is EXCLUSIVE for its scope. During the Agreement period, the Consultant shall not provide directly competing advisory services to a direct competitor of the Client on the same matter without prior written consent.",
    nonExclusiveText:
      "This Agreement is NON-EXCLUSIVE. The Consultant may advise other clients during the Agreement period, provided no conflict of interest arises and confidentiality is maintained.",
  },
  "Service Vendor": {
    title: "Service Agreement",
    providerRole: "Service Provider",
    providerNoun: "Service Provider",
    clientRole: "Client",
    clientNoun: "Client",
    clientFieldLabel: "Client Name",
    serviceDescription: "the professional services described herein",
    complianceNote: "All services shall be delivered professionally and in compliance with applicable laws and safety standards.",
    rightsHeading: "Deliverables & Usage",
    rightsText:
      "Upon full payment, the Service Provider grants the Client the right to use the delivered work (such as photographs, recordings, or other outputs) for personal or agreed purposes. The Service Provider retains the right to showcase the work as part of their portfolio unless the Client requests otherwise in writing.",
    exclusiveText:
      "This Agreement is EXCLUSIVE for the booked dates and scope. During the booked period, the Service Provider commits the agreed resources solely to the Client for this engagement.",
    nonExclusiveText:
      "This Agreement is NON-EXCLUSIVE. The Service Provider may serve other clients during the period, provided the commitments under this Agreement are fully honoured.",
  },
  Custom: {
    title: "Service Agreement",
    providerRole: "Service Provider",
    providerNoun: "Service Provider",
    clientRole: "Client",
    clientNoun: "Client",
    clientFieldLabel: "Client Name",
    serviceDescription: "the services described herein",
    complianceNote: "All work shall be carried out professionally and in compliance with applicable laws and standards.",
    rightsHeading: "Deliverables & Usage Rights",
    rightsText:
      "Upon full payment, the Service Provider grants the Client the agreed rights to use the deliverables produced under this Agreement. The Service Provider retains ownership of any pre-existing materials and the right to reference the work in their portfolio unless otherwise agreed in writing.",
    exclusiveText:
      "This Agreement is EXCLUSIVE for its scope. During the Agreement period, the Service Provider shall not provide the same deliverables to a direct competitor of the Client without prior written consent.",
    nonExclusiveText:
      "This Agreement is NON-EXCLUSIVE. The Service Provider may engage with other clients during the Agreement period, provided the commitments under this Agreement are honoured.",
  },
};

/**
 * Returns deal-type-appropriate language for the generated agreement PDF.
 * Legacy deal types keep their original wording (existing signed agreements
 * must re-render identically); unknown types get the generic Custom copy.
 */
export function getAgreementCopy(dealType?: string | null): AgreementCopy {
  if (dealType && dealType in AGREEMENT_COPY) {
    return AGREEMENT_COPY[dealType as AnyDealType];
  }
  return AGREEMENT_COPY.Custom;
}

// ───────────────────────────────────────────────────────────────────────
// Deliverable field labels — deal-type-aware names for the two deliverable
// columns/dropdowns and the counterparty name field. Used by deal create/edit
// forms and read-only displays (quote, agreement PDF) so wording is consistent
// everywhere (a wedding photographer sees "Service / Output", not "Platform").
// ───────────────────────────────────────────────────────────────────────

export interface DeliverableLabels {
  /** First field/column — e.g. "Platform", "Category", "Service" */
  category: string;
  /** Second field/column — e.g. "Content Type", "Output", "Format" */
  type: string;
  /** Counterparty name field — e.g. "Brand Name", "Client Name" */
  who: string;
}

const DELIVERABLE_LABELS: Record<AnyDealType, DeliverableLabels> = {
  "Real Estate": { category: "Service", type: "Billing Basis", who: "Client Name" },
  "Interior Design": { category: "Scope / Area", type: "Billing Basis", who: "Client Name" },
  Architecture: { category: "Service", type: "Billing Basis", who: "Client Name" },
  Agency: { category: "Service", type: "Billing Model", who: "Client Name" },
  Construction: { category: "Work / Trade", type: "Billing Basis", who: "Client Name" },
  Custom: { category: "Category", type: "Output", who: "Client / Brand" },
  // Legacy (existing deals only)
  Creator: { category: "Platform", type: "Content Type", who: "Brand Name" },
  Freelance: { category: "Category", type: "Output", who: "Client Name" },
  Consulting: { category: "Practice Area", type: "Format", who: "Client Name" },
  "Service Vendor": { category: "Service", type: "Output", who: "Client Name" },
};

/**
 * Deal-type-aware labels for the deliverable fields. Legacy types keep their
 * original labels; unknown types fall back to the generic Custom labels.
 */
export function getDeliverableLabels(dealType?: string | null): DeliverableLabels {
  if (dealType && dealType in DELIVERABLE_LABELS) {
    return DELIVERABLE_LABELS[dealType as AnyDealType];
  }
  return DELIVERABLE_LABELS.Custom;
}

/** Universal frequency options (applies to all deal types). */
export const frequencyOptions = [
  "One-time",
  "Per week",
  "Per month",
  "Per quarter",
  "Per event",
  "Per session",
  "Per day",
  "Per hour",
] as const;

export type FrequencyOption = (typeof frequencyOptions)[number];
