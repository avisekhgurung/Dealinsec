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

export const dealTypeOptions = [
  "Creator",
  "Freelance",
  "Consulting",
  "Service Vendor",
  "Custom",
] as const;

export type DealType = (typeof dealTypeOptions)[number];

export const dealTypeMeta: Record<DealType, { label: string; description: string; emoji: string; tint: string }> = {
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
  Custom: {
    label: "Custom",
    description: "Anything else — free-form deal not covered above.",
    emoji: "⚙️",
    tint: "slate",
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

export const TAXONOMY: Record<DealType, TaxonomyEntry> = {
  Creator: creatorTaxonomy,
  Freelance: freelanceTaxonomy,
  Consulting: consultingTaxonomy,
  "Service Vendor": serviceVendorTaxonomy,
  Custom: customTaxonomy,
};

/** Flat list of all category options for a given dealType (for searchable dropdowns). */
export function getCategoryOptions(dealType: DealType): { group: string; option: string }[] {
  const entry = TAXONOMY[dealType];
  const flat: { group: string; option: string }[] = [];
  for (const g of entry.categories) {
    for (const opt of g.options) {
      flat.push({ group: g.group, option: opt });
    }
  }
  return flat;
}

/** Flat list of all output options for a given dealType. */
export function getOutputOptions(dealType: DealType): { group: string; option: string }[] {
  const entry = TAXONOMY[dealType];
  const flat: { group: string; option: string }[] = [];
  for (const g of entry.outputs) {
    for (const opt of g.options) {
      flat.push({ group: g.group, option: opt });
    }
  }
  return flat;
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
