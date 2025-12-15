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
  ArrowRight,
  Plus,
  Calendar,
  User,
  Upload,
  Eye,
  Send,
  CreditCard,
  Building2,
  Mail,
  Phone,
  MapPin,
  Printer,
  ChevronRight,
  Edit,
  Trash2,
  Copy,
  AlertCircle
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
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">Jan 1 - Mar 31, 2025</p>
                      <div className="flex gap-2">
                        <div className="flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-emerald-600" />
                          <span className="text-xs text-emerald-600">You: Signed</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-emerald-600" />
                          <span className="text-xs text-emerald-600">Brand: Signed</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Spotify Contract</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">Feb 1 - Apr 30, 2025</p>
                      <div className="flex gap-2">
                        <div className="flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-emerald-600" />
                          <span className="text-xs text-emerald-600">You: Signed</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-600" />
                          <span className="text-xs text-amber-600">Brand: Pending</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-2 bg-muted/30 rounded-lg text-center">
                      <FileText className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
                      <p className="text-xs text-muted-foreground">Export PDF & Send to Brand</p>
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

          {/* Detailed Workflow Screens */}
          <section className="print:break-before-page">
            <h2 className="text-2xl font-bold text-center mb-2 print:text-xl">
              Complete Workflow Details
            </h2>
            <p className="text-muted-foreground text-center mb-8 print:mb-4">
              Every step of managing your influencer business, simplified
            </p>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 print:gap-4">
              
              {/* Create New Deal Screen */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white">
                    <Plus className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold">Create New Deal</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">New Deal</span>
                  </div>
                  <div className="p-3 space-y-3">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 p-2 border rounded-lg">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                        <div className="flex-1">
                          <p className="text-xs text-muted-foreground">Brand Name</p>
                          <p className="text-sm font-medium">Nike India</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 p-2 border rounded-lg">
                        <SiInstagram className="w-4 h-4 text-pink-500" />
                        <div className="flex-1">
                          <p className="text-xs text-muted-foreground">Platform</p>
                          <p className="text-sm font-medium">Instagram</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 border rounded-lg">
                          <p className="text-xs text-muted-foreground">Content Type</p>
                          <p className="text-sm font-medium">Reels</p>
                        </div>
                        <div className="p-2 border rounded-lg">
                          <p className="text-xs text-muted-foreground">Quantity</p>
                          <p className="text-sm font-medium">3 Posts</p>
                        </div>
                      </div>
                      <div className="p-2 border rounded-lg">
                        <p className="text-xs text-muted-foreground">Deal Value</p>
                        <p className="text-lg font-bold text-emerald-600">₹75,000</p>
                      </div>
                    </div>
                    <Button size="sm" className="w-full text-xs" data-testid="button-mockup-create-deal">
                      <Plus className="w-3 h-3 mr-1" />
                      Create Deal
                    </Button>
                  </div>
                </div>
              </div>

              {/* Deal Details Screen */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white">
                    <Eye className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold">Deal Details</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">Nike Campaign</span>
                  </div>
                  <div className="p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold">Nike India</p>
                        <p className="text-xs text-muted-foreground">Sports & Fitness</p>
                      </div>
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Active</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 bg-muted/50 rounded-lg">
                        <SiInstagram className="w-4 h-4 mx-auto mb-1 text-pink-500" />
                        <p className="text-xs text-muted-foreground">Platform</p>
                      </div>
                      <div className="p-2 bg-muted/50 rounded-lg">
                        <p className="text-sm font-bold">3</p>
                        <p className="text-xs text-muted-foreground">Reels</p>
                      </div>
                      <div className="p-2 bg-muted/50 rounded-lg">
                        <p className="text-sm font-bold text-emerald-600">₹75K</p>
                        <p className="text-xs text-muted-foreground">Value</p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium">Deliverables Progress</p>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div className="bg-emerald-600 h-2 rounded-full" style={{width: '66%'}}></div>
                      </div>
                      <p className="text-xs text-muted-foreground">2 of 3 completed</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1 text-xs" data-testid="button-mockup-edit-deal">
                        <Edit className="w-3 h-3 mr-1" />
                        Edit
                      </Button>
                      <Button size="sm" className="flex-1 text-xs" data-testid="button-mockup-deal-contract">
                        <FileText className="w-3 h-3 mr-1" />
                        Contract
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contract Details Screen */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-white">
                    <FileText className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold">Contract Details</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">Contract View</span>
                  </div>
                  <div className="p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-sm">Nike Agreement</p>
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-xs">Signed</Badge>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <Calendar className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Jan 1 - Mar 31, 2025</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <User className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Contact: Rahul Sharma</span>
                      </div>
                    </div>
                    <div className="p-2 border rounded-lg bg-muted/30">
                      <p className="text-xs font-medium mb-2">Signature Status</p>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">You (Influencer)</span>
                          <div className="flex items-center gap-1">
                            <CheckCircle className="w-3 h-3 text-emerald-600" />
                            <span className="text-xs text-emerald-600">Signed</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Brand (Nike)</span>
                          <div className="flex items-center gap-1">
                            <CheckCircle className="w-3 h-3 text-emerald-600" />
                            <span className="text-xs text-emerald-600">Signed</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1 text-xs" data-testid="button-mockup-view-pdf">
                        <Eye className="w-3 h-3 mr-1" />
                        View PDF
                      </Button>
                      <Button size="sm" className="flex-1 text-xs" data-testid="button-mockup-download-contract">
                        <Send className="w-3 h-3 mr-1" />
                        Send to Brand
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Upload Contract Proof Screen */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-amber-600 flex items-center justify-center text-white">
                    <Upload className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold">Upload Signed Proof</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">Upload Proof</span>
                  </div>
                  <div className="p-3 space-y-3">
                    <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-4 text-center">
                      <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground mb-2">
                        Upload brand-signed contract
                      </p>
                      <p className="text-xs text-muted-foreground">
                        PDF, JPG, PNG up to 10MB
                      </p>
                    </div>
                    <div className="p-2 border rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-emerald-600" />
                        <div className="flex-1">
                          <p className="text-xs font-medium">Nike_Brand_Signed.pdf</p>
                          <p className="text-xs text-muted-foreground">2.3 MB</p>
                        </div>
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                      </div>
                    </div>
                    <Button size="sm" className="w-full text-xs" data-testid="button-mockup-upload-proof">
                      <Upload className="w-3 h-3 mr-1" />
                      Upload Brand Signature
                    </Button>
                  </div>
                </div>
              </div>

              {/* Invoice Details Screen */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-pink-600 flex items-center justify-center text-white">
                    <Receipt className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold">Invoice Details</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">INV-2025-001</span>
                  </div>
                  <div className="p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-sm">Nike India</p>
                        <p className="text-xs text-muted-foreground">Nike Campaign</p>
                      </div>
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-xs">Paid</Badge>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Deal Amount</span>
                        <span>₹75,000</span>
                      </div>
                      <div className="border-t pt-1 flex justify-between font-bold">
                        <span>Total Amount</span>
                        <span className="text-emerald-600">₹75,000</span>
                      </div>
                    </div>
                    <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        <div>
                          <p className="text-xs font-medium text-emerald-700">Payment Received</p>
                          <p className="text-xs text-emerald-600">Dec 10, 2025</p>
                        </div>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="w-full text-xs" data-testid="button-mockup-print-invoice">
                      <Printer className="w-3 h-3 mr-1" />
                      Print Invoice
                    </Button>
                  </div>
                </div>
              </div>

              {/* Generate Invoice Screen */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white">
                    <Send className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold">Generate Invoice</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">New Invoice</span>
                  </div>
                  <div className="p-3 space-y-3">
                    <div className="p-2 border rounded-lg">
                      <p className="text-xs text-muted-foreground">Select Deal</p>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-sm font-medium">Spotify Promo</p>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 p-2 border rounded-lg">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <input className="text-sm bg-transparent flex-1 outline-none" placeholder="Brand email" defaultValue="billing@spotify.com" readOnly />
                      </div>
                      <div className="flex items-center gap-2 p-2 border rounded-lg">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <input className="text-sm bg-transparent flex-1 outline-none" placeholder="Due date" defaultValue="Jan 15, 2025" readOnly />
                      </div>
                    </div>
                    <div className="p-2 bg-muted/30 rounded-lg">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Total Amount</span>
                        <span className="font-bold">₹1,20,000</span>
                      </div>
                    </div>
                    <Button size="sm" className="w-full text-xs" data-testid="button-mockup-generate-invoice">
                      <Send className="w-3 h-3 mr-1" />
                      Generate & Send
                    </Button>
                  </div>
                </div>
              </div>

            </div>
          </section>

          {/* Payment & Settings Screens */}
          <section className="print:break-before-page">
            <h2 className="text-2xl font-bold text-center mb-2 print:text-xl">
              Payments & Account
            </h2>
            <p className="text-muted-foreground text-center mb-8 print:mb-4">
              Manage payments and customize your profile
            </p>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 print:gap-4">
              
              {/* Payment History Screen */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold">Payment History</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">Payments</span>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Nike India</span>
                        <span className="text-sm font-bold text-emerald-600">+₹71,250</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Dec 10, 2025</p>
                    </div>
                    <div className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Myntra</span>
                        <span className="text-sm font-bold text-emerald-600">+₹47,500</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Dec 5, 2025</p>
                    </div>
                    <div className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Boat Audio</span>
                        <span className="text-sm font-bold text-emerald-600">+₹28,500</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Nov 28, 2025</p>
                    </div>
                    <div className="text-center py-2 border-t">
                      <p className="text-xs text-muted-foreground">Total This Month</p>
                      <p className="text-lg font-bold text-emerald-600">₹1,47,250</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Profile Settings Screen */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white">
                    <User className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold">Profile Settings</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">Profile</span>
                  </div>
                  <div className="p-3 space-y-3">
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500 to-violet-500 mx-auto mb-2 flex items-center justify-center text-white text-xl font-bold">
                        PS
                      </div>
                      <p className="font-bold">Priya Sharma</p>
                      <p className="text-xs text-muted-foreground">@priyasharma</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 p-2 border rounded-lg">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">priya@email.com</span>
                      </div>
                      <div className="flex items-center gap-2 p-2 border rounded-lg">
                        <Phone className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">+91 98765 43210</span>
                      </div>
                      <div className="flex items-center gap-2 p-2 border rounded-lg">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">Mumbai, India</span>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="w-full text-xs" data-testid="button-mockup-edit-profile">
                      <Edit className="w-3 h-3 mr-1" />
                      Edit Profile
                    </Button>
                  </div>
                </div>
              </div>

              {/* Pending Payments Screen */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-amber-600 flex items-center justify-center text-white">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold">Pending Payments</h3>
                </div>
                <div className="border-2 border-border rounded-2xl overflow-hidden bg-background shadow-lg">
                  <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    </div>
                    <span className="text-xs text-muted-foreground">Pending</span>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="p-2 border rounded-lg border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Spotify</span>
                        <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700">Overdue</Badge>
                      </div>
                      <p className="text-sm font-bold">₹1,14,000</p>
                      <p className="text-xs text-amber-600">Due: Dec 1, 2025</p>
                    </div>
                    <div className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Zomato</span>
                        <Badge variant="secondary" className="text-xs">Due Soon</Badge>
                      </div>
                      <p className="text-sm font-bold">₹45,000</p>
                      <p className="text-xs text-muted-foreground">Due: Dec 20, 2025</p>
                    </div>
                    <div className="text-center py-2 border-t">
                      <p className="text-xs text-muted-foreground">Total Pending</p>
                      <p className="text-lg font-bold text-amber-600">₹1,59,000</p>
                    </div>
                    <Button size="sm" className="w-full text-xs" data-testid="button-mockup-send-reminders">
                      <Send className="w-3 h-3 mr-1" />
                      Send Reminders
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
