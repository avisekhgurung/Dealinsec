/**
 * Seeds the PDF test scenarios into the LOCAL test database.
 *
 * LOCAL ONLY — refuses to run unless DATABASE_URL points at localhost. Dev and
 * production share one Neon database, and this script deletes and inserts rows
 * by fixed ids, so it must never see `.env`.
 *
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/pdf-scenarios.mts
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/pdf-scenarios.mts clean
 *
 * One org, one owner (with signature + seal + full billing identity), and the
 * scenario matrix from the PDF-redesign spec:
 *   deal A: simple 1-deliverable quotation
 *   deal B: 10 deliverables, long client name, long custom terms → quotation + agreement (signed, e-stamp) + itemised invoice
 *   deal C: short agreement awaiting counterparty signature, minimal optionals (no bank details on invoice path)
 *
 * Every amount is written in MINOR units (paise), including estamp_amount,
 * which contract-pdf.tsx prints through the same formatter as the contract
 * value. Invoice lines use the stored `rateMinor`/`amountMinor` keys. Seeding
 * requires the local database to be migrated first; `clean` does not.
 *
 * Prints JSON ids for the shot harness.
 */
import pg from "pg";
import bcrypt from "bcrypt";
import { INDIA_LOCALE, inr, requireLocalDatabaseUrl, requireMinorUnitMoney } from "./local-db-guard.ts";

const SCRIPT = "pdf-scenarios.mts";

const ORG = "00000000-0000-4000-8000-00000000pdf1".replace("pdf1", "0d01");
const UID = "00000000-0000-4000-8000-00000000pdf2".replace("pdf2", "0d02");
const EMAIL = "pdf-smoke@dealinsec.invalid";

// 1×1 px PNGs — enough to exercise image layout without binary fixtures.
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SEAL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const LONG_CLIENT = "Shree Balaji Infra Developers & Estates Private Limited (Salt Lake Sector V Division)";
const LONG_TERMS = [
  "Advance of 50% is payable before work begins; the remaining 50% is due within 7 days of final deliverable approval.",
  "Two rounds of revisions are included; further revisions are billed at ₹2,500 per round.",
  "Client-side delays beyond 14 days pause the delivery schedule without penalty to the provider.",
  "All third-party costs (stock imagery, fonts, plugins, hosting) are billed at actuals with prior approval.",
  "Site visits beyond the two included visits are billed at ₹1,500 per visit including local travel.",
  "The provider may reference the completed work in their portfolio unless the client opts out in writing.",
].join("\n");

/** One invoice line in the stored shape. quantity is a count, never scaled. */
const line = (description: string, quantity: number, rateRupees: number, hsnSac?: string) => ({
  description,
  ...(hsnSac ? { hsnSac } : {}),
  quantity,
  rateMinor: inr(rateRupees),
  amountMinor: inr(rateRupees * quantity),
});

async function main(clean: boolean) {
  // Before the pool exists: a refused URL must never open a connection.
  const url = requireLocalDatabaseUrl(SCRIPT);
  const pool = new pg.Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    if (clean) {
      for (const q of [
        `DELETE FROM brand_invoices WHERE user_id=$1`,
        `DELETE FROM contracts WHERE user_id=$1`,
        `DELETE FROM quotes WHERE user_id=$1`,
        `DELETE FROM deals WHERE user_id=$1`,
        `DELETE FROM feedback WHERE user_id=$1`,
        `DELETE FROM invitations WHERE invited_by=$1`,
      ]) await c.query(q, [UID]).catch(() => {});
      await c.query(`DELETE FROM activity_logs WHERE user_id=$1 OR organization_id=$2`, [UID, ORG]).catch(() => {});
      await c.query(`DELETE FROM invoice_counters WHERE organization_id=$1`, [ORG]).catch(() => {});
      await c.query(`DELETE FROM users WHERE id=$1`, [UID]);
      await c.query(`DELETE FROM org_roles WHERE organization_id=$1`, [ORG]).catch(() => {});
      await c.query(`DELETE FROM organizations WHERE id=$1`, [ORG]);
      const left = await c.query(`SELECT (SELECT count(*)::int FROM users) users, (SELECT count(*)::int FROM users WHERE email LIKE '%invalid') leftover`);
      console.log("cleaned:", left.rows[0]);
      return;
    }

    await requireMinorUnitMoney(c, SCRIPT);

    // The locale columns are re-pinned to India on conflict: every amount below
    // is INR paise, and an org left on another currency would misprint them all.
    const pw = await bcrypt.hash("SmokeTest#2026", 10);
    const loc = [INDIA_LOCALE.country, INDIA_LOCALE.currency, INDIA_LOCALE.locale, INDIA_LOCALE.timezone];
    await c.query(
      `INSERT INTO organizations (id,name,country,currency,locale,timezone) VALUES ($1,'PDF Studio',$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET country=EXCLUDED.country, currency=EXCLUDED.currency, locale=EXCLUDED.locale, timezone=EXCLUDED.timezone`,
      [ORG, ...loc],
    );
    await c.query(
      `INSERT INTO users (id,email,email_canonical,password,first_name,last_name,organization_id,org_role,plan,plan_expires_at,onboarding_complete,
        phone,pan_number,gst_number,billing_address,digital_signature,company_seal,
        account_holder_name,account_number,ifsc_code,bank_name,country,currency,locale,timezone)
       VALUES ($1,$2,$2,$3,'Anaya','Deshpande',$4,'OWNER','pro',now()+interval '30 days',true,
        '9876543210','ABCDE1234F','19ABCDE1234F1Z5','2nd Floor, Laxmi Niwas, Hill Cart Road, Darjeeling, West Bengal 734101',$5,$6,
        'Anaya Deshpande','50100123456789','HDFC0001234','HDFC Bank, Darjeeling Branch',$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET country=EXCLUDED.country, currency=EXCLUDED.currency, locale=EXCLUDED.locale, timezone=EXCLUDED.timezone`,
      [UID, EMAIL, pw, ORG, SIG, SEAL, ...loc],
    );

    const mkDeliv = (n: number) =>
      JSON.stringify(
        Array.from({ length: n }, (_, i) => ({
          id: `d${i + 1}`,
          platform: ["Site", "Design", "Supervision", "Procurement"][i % 4],
          contentType: [
            "Concept & mood boards",
            "Detailed working drawings (AutoCAD)",
            "3D visualisation — living & dining",
            "Modular kitchen design & BOQ",
            "False ceiling layout with lighting plan",
            "Material & finishes selection assistance",
            "Vendor coordination & quality checks",
            "Weekly site supervision visit",
            "Snag list & handover documentation",
            "As-built drawings post completion",
          ][i % 10],
          quantity: (i % 3) + 1,
          frequency: i % 2 ? "One-time" : "Monthly",
          notes: i % 3 === 0 ? "Includes two revision rounds and client walkthrough at each milestone" : "",
        })),
      );

    // Deal A — simple
    const a = await c.query(
      `INSERT INTO deals (user_id,organization_id,brand_name,deal_title,deal_amount,start_date,end_date,status,deal_type,deliverables,custom_terms)
       VALUES ($1,$2,'Verma Residence','2BHK interior styling',$4,CURRENT_DATE,CURRENT_DATE+45,'Pending','service',$3::jsonb,NULL) RETURNING id`,
      [UID, ORG, mkDeliv(1), inr(90000)],
    );
    await c.query(
      `INSERT INTO quotes (user_id,organization_id,deal_id,version,status) VALUES ($1,$2,$3,1,'draft')
       ON CONFLICT DO NOTHING`,
      [UID, ORG, a.rows[0].id],
    ).catch(() => {});

    // Deal B — heavy
    const b = await c.query(
      `INSERT INTO deals (user_id,organization_id,brand_name,deal_title,deal_amount,start_date,end_date,status,deal_type,deliverables,custom_terms)
       VALUES ($1,$2,$3,'Full home interior — 4BHK duplex, Salt Lake',$6,CURRENT_DATE,CURRENT_DATE+120,'Signed','service',$4::jsonb,$5) RETURNING id`,
      [UID, ORG, LONG_CLIENT, mkDeliv(10), LONG_TERMS, inr(940000)],
    );
    const dealB = b.rows[0].id;
    await c.query(
      `INSERT INTO quotes (user_id,organization_id,deal_id,version,status) VALUES ($1,$2,$3,2,'draft') ON CONFLICT DO NOTHING`,
      [UID, ORG, dealB],
    ).catch(() => {});
    const cb = await c.query(
      `INSERT INTO contracts (user_id,organization_id,deal_id,brand_name,contract_name,contract_value,start_date,end_date,status,
         signed_date,signed_by_brand,signer_user_id,signer_name,signature_url,seal_url,
         estamp_certificate_no,estamp_date,estamp_amount,estamp_authority,exclusive)
       VALUES ($1,$2,$3,$4,$5,$8,CURRENT_DATE,CURRENT_DATE+120,'Signed',
         CURRENT_DATE,true,$1,'Anaya Deshpande',$6,$7,
         'IN-WB98765432109876K',CURRENT_DATE::text,$9,'SHCIL',true) RETURNING id`,
      [UID, ORG, dealB, LONG_CLIENT, `${LONG_CLIENT} — Full home interior`, SIG, SEAL, inr(940000), inr(1000)],
    );
    const contractB = cb.rows[0].id;
    // Lines sum to the invoice total (₹4,70,000), exactly as the server requires
    // of a composed invoice: 3,20,000 + 85,000 + 4 × 12,500 + 15,000.
    const linesB = [
      line("Design fee — concept, drawings & 3D views (50% advance)", 1, 320000, "998391"),
      line("Modular kitchen — design & BOQ preparation", 1, 85000, "9954"),
      line("Site supervision retainer", 4, 12500, "9954"),
      line("Documentation & handover set", 1, 15000),
    ];
    const totalB = inr(470000);
    if (linesB.reduce((sum, l) => sum + l.amountMinor, 0) !== totalB) {
      throw new Error("pdf-scenarios: invoice B lines no longer add up to its total");
    }
    const inv = await c.query(
      `INSERT INTO brand_invoices (user_id,organization_id,invoice_number,invoice_date,due_date,deal_id,contract_id,brand_name,influencer_name,influencer_email,deal_amount,invoice_type,notes,line_items,status)
       VALUES ($1,$2,'INV-2627-0042',CURRENT_DATE,CURRENT_DATE+15,$3,$4,$5,'Anaya Deshpande',$6,$8,'advance',
        'Advance for phase 1 as per agreement. Please quote the invoice number in the transfer reference.',
        $7::jsonb,'Unpaid') RETURNING id`,
      [UID, ORG, dealB, contractB, LONG_CLIENT, EMAIL, JSON.stringify(linesB), totalB],
    );

    // Deal C — minimal agreement awaiting signature (no proof, not signedByBrand)
    const cD = await c.query(
      `INSERT INTO deals (user_id,organization_id,brand_name,deal_title,deal_amount,start_date,end_date,status,deal_type,deliverables)
       VALUES ($1,$2,'Rai & Co','Brand refresh — logo and stationery',$4,CURRENT_DATE,CURRENT_DATE+30,'Active','service',$3::jsonb) RETURNING id`,
      [UID, ORG, mkDeliv(2), inr(60000)],
    );
    const cc = await c.query(
      `INSERT INTO contracts (user_id,organization_id,deal_id,brand_name,contract_name,contract_value,start_date,end_date,status,signer_user_id,signer_name)
       VALUES ($1,$2,$3,'Rai & Co','Rai & Co — Brand refresh',$4,CURRENT_DATE,CURRENT_DATE+30,'Pending',$1,'Anaya Deshpande') RETURNING id`,
      [UID, ORG, cD.rows[0].id, inr(60000)],
    );

    console.log(JSON.stringify({
      email: EMAIL, password: "SmokeTest#2026",
      dealA: a.rows[0].id, dealB, contractB, invoiceB: inv.rows[0].id,
      dealC: cD.rows[0].id, contractC: cc.rows[0].id,
    }));
  } finally {
    c.release();
    await pool.end();
  }
}

main(process.argv[2] === "clean").catch((e) => { console.error(e); process.exit(1); });
