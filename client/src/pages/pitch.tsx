import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Download, 
  TrendingUp, 
  FileText, 
  Receipt, 
  Shield, 
  CheckCircle,
  Star,
  Zap,
  Clock,
  ArrowRight
} from "lucide-react";
import { SiInstagram, SiYoutube, SiTiktok } from "react-icons/si";

export default function PitchPage() {
  const handleExportPDF = () => {
    window.print();
  };

  return (
    <>
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 print:bg-white">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border print:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-4 max-w-6xl mx-auto">
            <h1 className="text-xl font-bold">InfluDeal Pitch</h1>
            <Button onClick={handleExportPDF} data-testid="button-export-pdf">
              <Download className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
          </div>
        </header>

        <main className="px-4 py-8 max-w-6xl mx-auto space-y-12 print:py-4 print:space-y-8">
          
          <section className="text-center py-8 print:py-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-4">
              <Zap className="w-4 h-4" />
              <span className="text-sm font-medium">For Professional Influencers</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4 print:text-3xl">
              InfluDeal
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto print:text-base">
              Manage your brand deals, contracts, and billing like a pro. 
              Get paid faster, stay organized, and grow your influencer business.
            </p>
          </section>

          <section className="grid md:grid-cols-4 gap-4 print:gap-2">
            <Card className="text-center p-4">
              <CardContent className="p-0">
                <TrendingUp className="w-8 h-8 mx-auto mb-2 text-emerald-600" />
                <p className="font-bold text-2xl">Track Deals</p>
                <p className="text-sm text-muted-foreground">All partnerships in one place</p>
              </CardContent>
            </Card>
            <Card className="text-center p-4">
              <CardContent className="p-0">
                <FileText className="w-8 h-8 mx-auto mb-2 text-blue-600" />
                <p className="font-bold text-2xl">Sign Contracts</p>
                <p className="text-sm text-muted-foreground">Professional agreements</p>
              </CardContent>
            </Card>
            <Card className="text-center p-4">
              <CardContent className="p-0">
                <Receipt className="w-8 h-8 mx-auto mb-2 text-violet-600" />
                <p className="font-bold text-2xl">Send Invoices</p>
                <p className="text-sm text-muted-foreground">Get paid on time</p>
              </CardContent>
            </Card>
            <Card className="text-center p-4">
              <CardContent className="p-0">
                <Shield className="w-8 h-8 mx-auto mb-2 text-amber-600" />
                <p className="font-bold text-2xl">Stay Protected</p>
                <p className="text-sm text-muted-foreground">Legal documentation</p>
              </CardContent>
            </Card>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-center mb-8 print:text-xl print:mb-4">
              How InfluDeal Works
            </h2>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 print:gap-3">
              
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold">1</div>
                  <h3 className="font-bold">Dashboard</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">InfluDeal</span>
                  </div>
                  <div className="p-3 space-y-3">
                    <div className="text-center py-2">
                      <p className="text-xs text-muted-foreground">Total Earnings</p>
                      <p className="text-2xl font-bold text-emerald-600">₹2,45,000</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-muted/50 rounded-lg p-2 text-center">
                        <p className="text-lg font-bold">12</p>
                        <p className="text-xs text-muted-foreground">Active Deals</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-2 text-center">
                        <p className="text-lg font-bold">8</p>
                        <p className="text-xs text-muted-foreground">Contracts</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        <span className="text-xs">Payment received: ₹50,000</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold">2</div>
                  <h3 className="font-bold">Track Deals</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">My Deals</span>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Nike Campaign</span>
                        <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700">Active</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <SiInstagram className="w-3 h-3" />
                        <span>3 Reels</span>
                        <span>₹75,000</span>
                      </div>
                    </div>
                    <div className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Spotify Promo</span>
                        <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">Pending</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <SiYoutube className="w-3 h-3" />
                        <span>1 Video</span>
                        <span>₹1,20,000</span>
                      </div>
                    </div>
                    <div className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Myntra Collab</span>
                        <Badge variant="secondary" className="text-xs bg-violet-100 text-violet-700">Exclusive</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <SiTiktok className="w-3 h-3" />
                        <span>5 Posts</span>
                        <span>₹50,000</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold">3</div>
                  <h3 className="font-bold">Sign Contracts</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">Contracts</span>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Nike Agreement</span>
                        <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700">Signed</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">Jan 1 - Mar 31, 2025</p>
                      <div className="flex items-center gap-1 mt-1">
                        <CheckCircle className="w-3 h-3 text-emerald-600" />
                        <span className="text-xs text-emerald-600">Brand approved</span>
                      </div>
                    </div>
                    <div className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Spotify Contract</span>
                        <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700">Pending</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">Feb 1 - Apr 30, 2025</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3 text-amber-600" />
                        <span className="text-xs text-amber-600">Awaiting signature</span>
                      </div>
                    </div>
                    <div className="p-2 bg-muted/30 rounded-lg text-center">
                      <FileText className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
                      <p className="text-xs text-muted-foreground">Export as PDF</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold">4</div>
                  <h3 className="font-bold">Get Paid</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">Billing</span>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">INV-2025-001</span>
                        <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700">Paid</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">Nike Campaign</p>
                      <p className="text-sm font-bold text-emerald-600 mt-1">₹75,000</p>
                    </div>
                    <div className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">INV-2025-002</span>
                        <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700">Pending</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">Spotify Promo</p>
                      <p className="text-sm font-bold mt-1">₹1,20,000</p>
                    </div>
                    <Button size="sm" className="w-full text-xs">
                      <Receipt className="w-3 h-3 mr-1" />
                      Generate Invoice
                    </Button>
                  </div>
                </div>
              </div>

            </div>
          </section>

          <section className="py-8 print:py-4">
            <h2 className="text-2xl font-bold text-center mb-6 print:text-xl">
              Why Influencers Choose InfluDeal
            </h2>
            <div className="grid md:grid-cols-3 gap-6 print:gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                  <Star className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-bold mb-1">Professional Image</h3>
                  <p className="text-sm text-muted-foreground">
                    Send professional contracts and invoices that brands respect. Stand out from other creators.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-bold mb-1">Save Time</h3>
                  <p className="text-sm text-muted-foreground">
                    No more spreadsheets or messy notes. Everything organized in one mobile-friendly app.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <h3 className="font-bold mb-1">Legal Protection</h3>
                  <p className="text-sm text-muted-foreground">
                    Professional contracts protect your work. Clear terms, deliverables, and payment schedules.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="text-center py-8 bg-muted/30 rounded-2xl print:py-4">
            <h2 className="text-2xl font-bold mb-2 print:text-xl">Ready to Level Up Your Influencer Business?</h2>
            <p className="text-muted-foreground mb-6 print:mb-4">
              Join thousands of creators who manage their brand deals professionally with InfluDeal.
            </p>
            <div className="flex items-center justify-center gap-4 flex-wrap print:hidden">
              <Button size="lg">
                Get Started Free
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
            <div className="hidden print:block">
              <p className="font-bold text-lg">www.infludeal.com</p>
            </div>
          </section>

          <footer className="text-center py-6 text-sm text-muted-foreground border-t print:py-2">
            <p>InfluDeal - Professional Deal Management for Influencers</p>
            <p className="mt-1">Track Deals. Sign Contracts. Get Paid.</p>
          </footer>

        </main>
      </div>

      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          main, main * {
            visibility: visible;
          }
          main {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          @page {
            margin: 0.5cm;
            size: A4;
          }
        }
      `}</style>
    </>
  );
}
