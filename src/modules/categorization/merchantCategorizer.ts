// Merchant -> spend category classifier. Keyword taxonomy, not ML — deliberately simple and fast,
// tuned against real Indian merchant names seen in SMS/statement data. Mirrored on-device at
// android/.../util/MerchantCategorizer.kt (same dual-mirror pattern as smsRules.ts/SmsRules.kt) —
// keep both in sync if you change this. Category strings match android/.../util/CategoryIcons.kt.
const TAXONOMY: { category: string; keywords: string[] }[] = [
  {
    category: "groceries",
    keywords: [
      "bigbasket", "big basket", "blinkit", "zepto", "swiggy instamart", "dmart", "d mart", "more supermarket",
      "reliance fresh", "reliance smart", "spencers", "nature's basket", "star bazaar", "grofers",
      "jiomart", "vishal mega mart", "big bazaar",
      // Learned from real statement<->SMS pairs: parent/legal entity names -> brand category.
      "instamart", "innovative retail", "supermarket grocery", "blink commerce", "kiranakart", "avenue supermarts", "reliance retail", "jio mart", "vishal mega", "more retail",
  ],
  },
  {
    category: "medical",
    keywords: [
      "apollo", "pharmeasy", "netmeds", "1mg", "tata 1mg", "medplus", "fortis", "max healthcare", "manipal hospital",
      "practo", "diagnostic", "pathlab", "pathology", "clinic", "hospital", "pharmacy", "chemist",
      // Verified via web search against real merchant strings from a real ~17,000-message SMS
      // export: "Cloudnine" (maternity hospital chain), "Wellness Forever" (pharmacy chain).
      // "medical"/"medico"/"healthcare" are generic Indian
      // pharmacy/clinic naming conventions (e.g. "Mauli Medical", "National Medico").
      "cloudnine", "wellness forever", "medical", "medico", "healthcare",
      // Hospital & diagnostic-lab chains that showed up as "Other" in a real spend export
      // ("Ruby Hall Cl", "Upi-jupiter Life Line"). Two-word anchors where a bare word would be
      // too broad ("ruby hall", "life line", "care hospital").
      "ruby hall", "jehangir hospital", "sahyadri hospital", "life line", "lifeline hospital",
      "columbia asia", "narayana health", "medanta", "kokilaben", "lilavati", "hinduja hospital",
      "jaslok", "nanavati", "kims hospital", "yashoda hospital", "aig hospital", "aster hospital",
      "wockhardt hospital", "care hospital", "rainbow hospital", "motherhood hospital", "surya hospital",
      "dr lal", "dr. lal", "lal pathlab", "srl diagnostic", "thyrocare", "metropolis healthcare",
      "redcliffe", "agilus diagnostic", "vijaya diagnostic", "healthians",
      // Learned from real statement<->SMS pairs: parent/legal entity names -> brand category.
      "api holdings", "dadha pharma", "qikwell",
  ],
  },
  {
    category: "fitness",
    keywords: [
      "cult.fit", "cultfit", "cure.fit", "curefit", "gold's gym", "golds gym", "anytime fitness",
      "snap fitness", "fitness first", "gym membership", "crossfit", "gympik", "fitternity",
    ],
  },
  {
    category: "dining",
    keywords: [
      "swiggy", "zomato", "eatsure", "dominos", "domino's", "mcdonald", "mc donald", "kfc", "starbucks",
      "cafe coffee day", "barbeque nation", "pizza hut", "burger king", "subway", "haldiram", "restaurant",
      "eatery",
      // Verified via web search: "Bundl Technologies"/"ToBox Ventures" (GoKhana) are Swiggy's/a
      // corporate-cafeteria food-tech company's registered legal entity names, appearing as the
      // merchant string instead of the consumer brand in real bank SMS.
      "bundl technologies", "tobox", "gokhana", "eazydiner", "dineout", "sweets", "wowmomo", "wow momo",
      "california burrito",
      // Cloud-kitchen brands (Rebel Foods) + café/QSR chains that read as "Other" without them.
      "faasos", "behrouz", "ovenstory", "oven story", "the good bowl", "sweet truth", "biryani blues",
      "paradise biryani", "bikanervala", "chaayos", "chai point", "third wave coffee", "blue tokai",
      "theobroma", "keventers", "baskin robbins", "naturals ice cream", "wendys", "wendy's", "taco bell",
      "smoke house", "farzi cafe", "punjab grill", "mainland china", "absolute barbecue", "copper chimney",
      "social offline", "the beer cafe",
      // Learned from real statement<->SMS pairs: parent/legal entity names -> brand category.
      "jubilant food", "jubilant foodworks", "bundl tech", "eternal limited", "hardcastle", "westlife", "devyani", "sapphire foods", "restaurant brands asia", "tata starbucks", "rebel foods", "sunshine teahouse", "third wave", "cafe coffee", "barista", "culinary brands",
  ],
  },
  {
    category: "transport",
    keywords: [
      "uber", "ola", "rapido", "irctc", "metro", "namma metro", "delhi metro", "meru cab", "blu smart",
      "namma yatri", "quick ride", "quickride", "yulu", "bounce", "chalo", "abhibus", "shuttl",
      // Learned from real statement<->SMS pairs: parent/legal entity names -> brand category.
      "uber india", "ani technologies", "ola cabs", "roppen",
  ],
  },
  {
    category: "travel",
    keywords: [
      "makemytrip", "goibibo", "yatra", "cleartrip", "indigo", "spicejet", "vistara", "air india",
      "oyo", "airbnb", "booking.com", "agoda", "redbus", "irctc air", "akasa air", "easemytrip",
      "treebo", "fabhotels", "lemon tree", "ginger hotel",
      // Learned from real statement<->SMS pairs: parent/legal entity names -> brand category.
      "indian railway catering", "ibibo", "le travenues", "ixigo", "interglobe", "akasa", "oravel", "ritz carlton", "marriott", "taj hotel",
  ],
  },
  {
    category: "tolls",
    keywords: [
      "fastag", "netc", "nhai", "toll plaza", "paytm fastag", "national highway", "toll payment",
      "expressway", "e-way toll", "yamuna expressway", "mumbai pune expressway", "ideal toll",
      "mep infra", "peripheral expressway",
      // Learned from real statement<->SMS pairs: parent/legal entity names -> brand category.
      "parkplus", "park plus", "sai expressway", "toll",
  ],
  },
  {
    category: "fuel",
    keywords: ["hpcl", "bpcl", "iocl", "indian oil", "hp petrol", "bharat petroleum", "shell", "petrol", "diesel", "fuel station", "petrol pump", "reliance petroleum", "nayara energy", "hindustan petroleum", "reliance bp", "nayara", "fuel services"],
  },
  {
    category: "shopping",
    keywords: [
      "amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "tata cliq", "snapdeal", "croma",
      "reliance digital", "decathlon", "ikea", "lifestyle store", "shoppers stop", "pantaloons",
      "jewellers", "jewellery", "firstcry", "hamleys", "libas", "samsung",
      // Fashion / lifestyle / electronics / furniture chains that read as "Other" without them.
      "westside", "max fashion", "reliance trends", "fabindia", "biba", "global desi", "zara",
      "h&m", "uniqlo", "marks & spencer", "adidas", "nike", "puma", "reebok", "titan", "tanishq",
      "kalyan jewellers", "malabar gold", "caratlane", "bluestone", "lenskart", "vijay sales",
      "sangeetha mobiles", "poorvika", "boat lifestyle", "pepperfry", "urban ladder", "wakefit",
      "the sleep company", "nilkamal", "home centre", "chumbak",
      // Learned from real statement<->SMS pairs: parent/legal entity names -> brand category.
      "amazon seller", "amazon retail", "amazon pay in e", "amazon.in", "fsn e-commerce", "tata digital", "tata neu", "trent limited", "aditya birla fashion", "lifestyle intern", "life style intern", "shein", "zudio", "hopscotch", "reliance brands", "babyhug", "mothercare", "gyftr", "qwikcilver", "smartbuy", "gift card", "pine labs", "apple store",
  ],
  },
  {
    category: "entertainment",
    keywords: [
      "netflix", "spotify", "hotstar", "disney+", "prime video", "sonyliv", "zee5", "bookmyshow",
      "pvr", "inox", "cinepolis", "youtube premium", "jiocinema", "gaana", "wynk",
      "timezone", "smaaash", "wonderla", "snow world", "fun city", "kidzania", "paytm movies",
      "ticketnew", "essel world", "apple music", "audible",
      // Learned from real statement<->SMS pairs: parent/legal entity names -> brand category.
      "novi digital", "sony pictures", "bigtree", "google play", "apple.com", "apple services", "itunes", "icloud", "youtube", "microsoft", "adobe", "openai", "anthropic", "chatgpt", "vidiq", "eversub", "github", "hostinger", "godaddy", "namecheap", "linkedin", "canva", "dropbox", "figma", "vercel",
  ],
  },
  {
    category: "utilities",
    keywords: [
      "jio", "airtel", "vodafone", "vi prepaid", "vi postpaid", "vi recharge", "vi app", "vi bill", "bsnl", "electricity board", "discom", "water board", "gas agency",
      "indane", "hp gas", "broadband", "wifi bill", "dth", "tata sky", "d2h",
      "tata power", "adani electricity", "bescom", "mseb", "torrent power", "cesc", "bses",
      "act fibernet", "hathway", "excitel", "spectra", "railwire", "you broadband",
      // Learned from real statement<->SMS pairs: parent/legal entity names -> brand category.
      "msedc", "mahadiscom", "mahavitaran", "adani electric", "bharti airtel", "reliance jio", "tata play",
  ],
  },
  {
    category: "rent",
    keywords: ["rent payment", "housing rent", "nobroker", "rentpay", "magicbricks rent", "magicbricks"],
  },
  {
    category: "insurance",
    keywords: ["lic", "hdfc life", "icici prudential", "policybazaar", "star health", "insurance premium", "bajaj allianz", "icici lombard", "hdfc ergo"],
  },
  {
    category: "education",
    keywords: ["byju", "unacademy", "vedantu", "upgrad", "coursera", "udemy", "school fee", "tuition", "college fee"],
  },
  {
    category: "emi",
    keywords: ["emi", "loan installment", "loan emi", "bajaj finserv", "home credit", "nach", "bajaj fin", "newtap", "kissht", "pyu custcap"],
  },
];

export function categorizeMerchant(merchant: string | null | undefined): string | null {
  if (!merchant) return null;
  const lower = merchant.toLowerCase();
  for (const { category, keywords } of TAXONOMY) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return null;
}

/** The fine categories the AI merchant-classification pass (POST /categorization/classify) is
 * allowed to return — anything outside this set is dropped by the client. Kept next to the
 * taxonomy so the two never drift. */
export const CLASSIFIABLE_CATEGORIES = [
  "groceries", "medical", "fitness", "dining", "transport", "travel", "tolls", "fuel",
  "shopping", "entertainment", "utilities", "rent", "insurance", "education", "emi",
];
