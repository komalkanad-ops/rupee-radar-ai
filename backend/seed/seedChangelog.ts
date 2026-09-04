// Seeds the public "What's New" changelog. Idempotent via upsert on `version`. Run with
// `npm run seed:changelog`.
//
// Every entry's `version` matches the real Android build's `AppVersion.versionName` exactly
// ("0.<versionCode>.0-beta"), so the What's New page and the app's in-app version line show the
// same number. 0.5.0-beta–0.24.0-beta are the retroactive backfill from this project's session-log
// history, renumbered onto that scheme by release date; add a new entry per release going forward.
import { prisma } from "../src/lib/prisma.js";

type HighlightType = "FEATURE" | "FIX" | "IMPROVEMENT";
type Platform = "android" | "web" | "admin" | "backend";

interface Entry {
  version: string;
  releaseDate: string;
  platforms: Platform[];
  summary: string;
  highlights: { type: HighlightType; platform?: Platform; text: string }[];
}

const entries: Entry[] = [
  {
    version: "0.5.0-beta",
    releaseDate: "2026-08-22",
    platforms: ["backend", "web"],
    summary: "Fixed a stuck backend release, and added a free EMI calculator to the website.",
    highlights: [
      { type: "FIX", platform: "backend", text: "Resolved a stuck backend release that was silently not reaching production." },
      { type: "FEATURE", platform: "web", text: "Added a free EMI calculator with a full month-by-month payment schedule." },
      { type: "IMPROVEMENT", platform: "web", text: "Expanded the homepage feature highlights to cover recently shipped app features." },
    ],
  },
  {
    version: "0.6.0-beta",
    releaseDate: "2026-08-22",
    platforms: ["android"],
    summary: "Fixed Mall Mode not showing store recommendations, and redesigned the Insights spending chart.",
    highlights: [
      { type: "FIX", platform: "android", text: "Fixed Mall Mode and the Wallet card recommender showing empty even when cards were added — they were reading from the wrong, unsynced card list." },
      { type: "IMPROVEMENT", platform: "android", text: "Redesigned the Insights screen with a larger, clearer spending wheel chart with category labels." },
      { type: "IMPROVEMENT", platform: "android", text: "Simplified the Insights screen so budget details, trends, and top merchants are tucked into a collapsible section." },
    ],
  },
  {
    version: "0.7.0-beta",
    releaseDate: "2026-08-22",
    platforms: ["android", "backend"],
    summary: "Cleared a backlog of small fixes, and added payment-method/app detection to expenses.",
    highlights: [
      { type: "FIX", platform: "backend", text: "Fixed transfer transactions (like credit card bill payments) still being counted as real spending in budgets and totals." },
      { type: "FEATURE", platform: "android", text: "Added the ability to mark a loan as foreclosed, moving it to its own section instead of just disappearing." },
      { type: "FEATURE", platform: "android", text: "You can now add or edit a contact's phone/UPI details on an existing Lending entry, unlocking the reminder buttons." },
      { type: "FEATURE", platform: "android", text: "Expenses now show the payment method (UPI/card/bank transfer) and, where detectable, the app used (GPay, PhonePe, Paytm, etc.)." },
    ],
  },
  {
    version: "0.8.0-beta",
    releaseDate: "2026-08-22",
    platforms: ["android", "web", "admin", "backend"],
    summary: "Added a full feedback loop across the app, website, and admin console.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Added a \"Send feedback\" option in Settings that earns 100 reward coins per submission." },
      { type: "FEATURE", platform: "web", text: "Added a public feedback page to the website." },
      { type: "FEATURE", platform: "admin", text: "Added a Feedback triage page for admins to review and resolve submissions." },
    ],
  },
  {
    version: "0.9.0-beta",
    releaseDate: "2026-08-22",
    platforms: ["android", "admin", "backend"],
    summary: "Added an app version catalog with beta/stable release tracking.",
    highlights: [
      { type: "FEATURE", platform: "admin", text: "Added an App Versions page for logging each Android release and promoting it from Beta to Stable." },
      { type: "FEATURE", platform: "android", text: "The app now shows an \"update available\" hint when a newer version has been released on your channel." },
    ],
  },
  {
    version: "0.10.0-beta",
    releaseDate: "2026-08-22",
    platforms: ["web", "android"],
    summary: "Added animations to the website, and fixed real usage issues in Mall Mode, Insights, and Loans.",
    highlights: [
      { type: "IMPROVEMENT", platform: "web", text: "Added smooth entrance and scroll animations across the website." },
      { type: "FIX", platform: "web", text: "Fixed the mobile menu — Credit Cards, Statement Analyzer, EMI Calculator, and Why Rupee Radar AI were unreachable on phones." },
      { type: "IMPROVEMENT", platform: "android", text: "Redesigned Mall Mode as a tappable grid of store tiles with a detail screen ranking your best card per store." },
      { type: "IMPROVEMENT", platform: "android", text: "Insights' spending wheel chart no longer overlaps labels, and can be tapped and resized." },
      { type: "FIX", platform: "android", text: "Fixed the loan type selector overflowing off-screen, and added a way to edit an existing loan's details." },
    ],
  },
  {
    version: "0.11.0-beta",
    releaseDate: "2026-08-22",
    platforms: ["android", "backend"],
    summary: "Added a dated repayment history to Lending, a brand-new Savings Tracker, and expense filters.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Added a new Savings Tracker for FDs, gold, stocks, mutual funds, and physical gold/silver." },
      { type: "FEATURE", platform: "android", text: "Lending now keeps a full dated history of repayments instead of just a running total." },
      { type: "FEATURE", platform: "android", text: "Added category filters and an income/expense toggle to the Expenses screen." },
      { type: "FIX", platform: "android", text: "Fixed long UPI transaction names overflowing off the edge of the Expenses list." },
      { type: "FIX", platform: "android", text: "Fixed the Settings screen and feedback form being impossible to scroll on smaller devices." },
    ],
  },
  {
    version: "0.12.0-beta",
    releaseDate: "2026-08-22",
    platforms: ["android", "backend"],
    summary: "Added editing/undo to Lending, search to every list screen, and a smarter notification bell.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Lending entries can now be edited after creation, and a logged repayment can be removed if it was a mistake." },
      { type: "FEATURE", platform: "android", text: "Added a search box to Expenses, Lending, Recurring, Todo, Loans, and Savings." },
      { type: "FEATURE", platform: "android", text: "The notification bell now lists uncategorized transactions you can tap to categorize on the spot." },
      { type: "IMPROVEMENT", platform: "android", text: "Simplified transaction rows to show just the vendor and amount, with full detail in the tap-through dialog." },
    ],
  },
  {
    version: "0.13.0-beta",
    releaseDate: "2026-08-22",
    platforms: ["android", "web"],
    summary: "Categorizing one transaction now recategorizes similar ones automatically, plus a real Terms of Service.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Categorizing one transaction from a merchant now offers to recategorize every other transaction from that same merchant too." },
      { type: "FEATURE", platform: "web", text: "Published a real Terms of Service page." },
      { type: "IMPROVEMENT", platform: "web", text: "Updated support contact email and refreshed the homepage feature descriptions." },
    ],
  },
  {
    version: "0.14.0-beta",
    releaseDate: "2026-08-22",
    platforms: ["android"],
    summary: "Fixed dismissed Todo suggestions coming back, and added a badge to tell them apart.",
    highlights: [
      { type: "FIX", platform: "android", text: "Fixed dismissed Smart Action suggestions (like tax-exemption reminders) reappearing in Todo after being removed." },
      { type: "FEATURE", platform: "android", text: "Added a \"Suggested\" badge to Todo items that were auto-generated rather than typed in by you." },
    ],
  },
  {
    version: "0.15.0-beta",
    releaseDate: "2026-08-22",
    platforms: ["android", "backend"],
    summary: "Added overdue-bill alerts, a learning categorizer, Savings integration, more filters, credit alerts, an AI chat assistant, and multi-installment lending schedules.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "The notification bell now flags overdue loan EMIs and overdue money you're owed or owe." },
      { type: "FEATURE", platform: "android", text: "The app now remembers your manual category corrections and applies them automatically to future transactions from the same merchant." },
      { type: "FEATURE", platform: "android", text: "Net Worth can now sync directly from your Savings Tracker holdings, and Insights shows a \"Saved this month\" card." },
      { type: "FEATURE", platform: "android", text: "Added status filters to Lending and Todo." },
      { type: "FEATURE", platform: "android", text: "Added a credit-utilization alert when a card crosses 30/75/90% of its limit." },
      { type: "FEATURE", platform: "android", text: "Added an AI chat assistant (PRO) that can answer questions using your real loans, spending, and savings data." },
      { type: "FEATURE", platform: "android", text: "Lending now supports a full planned multi-installment repayment schedule, not just one expected return date." },
    ],
  },
  {
    version: "0.16.0-beta",
    releaseDate: "2026-08-22",
    platforms: ["android", "admin", "backend"],
    summary: "Made the AI chat assistant free (with limits), modernized the app's UI toolchain, and gave admins full control over feature rollout.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "The AI chat assistant is now available to free users too, with a 3-message lifetime limit and short replies; PRO users get longer, richer answers." },
      { type: "IMPROVEMENT", platform: "android", text: "Modernized the app's underlying UI toolchain (Kotlin, Compose, charting library, image loading) as groundwork for future visual updates." },
      { type: "FEATURE", platform: "admin", text: "Admins can now mark any app feature as Live, Beta, Early Access, Coming Soon, Maintenance, or fully Disabled." },
      { type: "FEATURE", platform: "admin", text: "Admins can now publish an app-wide announcement banner." },
      { type: "IMPROVEMENT", platform: "android", text: "The app now respects admin-set feature states — showing badges, blocking taps with a message, or hiding a feature entirely." },
    ],
  },

  {
    version: "0.17.0-beta",
    releaseDate: "2026-08-23",
    platforms: ["android", "admin"],
    summary: "Fixed a real AI chat timeout bug, added this What's New page, and gave the admin console a dark theme.",
    highlights: [
      { type: "FIX", platform: "android", text: "Fixed the AI assistant timing out on longer questions — the network connection was being cut off too early." },
      { type: "FEATURE", platform: "android", text: "Added this What's New page so you can see what's changed after every update." },
      { type: "FEATURE", platform: "admin", text: "Added a dark theme to the admin console." },
    ],
  },
  {
    version: "0.18.0-beta",
    releaseDate: "2026-08-23",
    platforms: ["android", "admin"],
    summary: "Fixed the back button always returning to Home, and added a one-tap way to report a bug or suggestion from any screen.",
    highlights: [
      { type: "FIX", platform: "android", text: "Fixed the back button resetting all the way to Home instead of returning to the screen you came from." },
      { type: "FEATURE", platform: "android", text: "Added a small button on every screen to report a bug or suggestion in one tap." },
      { type: "FEATURE", platform: "admin", text: "Added a Bug Reports page for admins to review and resolve submissions." },
    ],
  },
  {
    version: "0.19.0-beta",
    releaseDate: "2026-08-28",
    platforms: ["android"],
    summary: "The AI assistant now remembers your conversation, and stays focused on your finances and the app.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "The AI chat assistant's conversation history now persists — it's no longer lost when you close the app." },
      { type: "IMPROVEMENT", platform: "android", text: "The AI assistant now stays focused on your finance data and app features, and won't answer unrelated questions." },
    ],
  },
  {
    version: "0.20.0-beta",
    releaseDate: "2026-08-28",
    platforms: ["android", "admin"],
    summary: "Fixed Google and phone sign-in errors, and split the Bug Reports page into open and resolved.",
    highlights: [
      { type: "FIX", platform: "android", text: "Fixed Google Sign-In and phone sign-in failing with a server error." },
      { type: "FEATURE", platform: "admin", text: "Admins can now let a specific beta tester's phone number sign in with a real identity while phone verification is otherwise unavailable." },
      { type: "IMPROVEMENT", platform: "admin", text: "The Bug Reports page now separates open reports from a collapsible resolved history." },
    ],
  },
  {
    version: "0.21.0-beta",
    releaseDate: "2026-08-28",
    platforms: ["android"],
    summary: "Added a short profile setup step after phone sign-in, and fixed the Profile screen sometimes showing stale sign-in status.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Signing in with a phone number now asks for your name, email, and gender, the same details Google sign-in already provides automatically." },
      { type: "FIX", platform: "android", text: "Fixed the Profile screen sometimes still showing you as signed out right after completing sign-in." },
    ],
  },
  {
    version: "0.22.0-beta",
    releaseDate: "2026-08-28",
    platforms: ["android"],
    summary: "Fixed a crash on the profile setup form, added an optional profile photo, and cleared several reported bugs.",
    highlights: [
      { type: "FIX", platform: "android", text: "Fixed the phone sign-in profile form failing to save your details." },
      { type: "FEATURE", platform: "android", text: "You can now add an optional profile photo, or get a gender-tinted default avatar if you skip it." },
      { type: "FIX", platform: "android", text: "Fixed the category filters on the Cards screen not being scrollable." },
      { type: "IMPROVEMENT", platform: "android", text: "Sign-in errors now show a clear explanation instead of a raw error code." },
      { type: "FIX", platform: "android", text: "Fixed Mall Mode's back button sometimes leaving Mall Mode entirely instead of just going back to the store list." },
    ],
  },
  {
    version: "0.23.0-beta",
    releaseDate: "2026-08-28",
    platforms: ["android"],
    summary: "Added the ability to delete your account, and to edit your profile details anytime.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Added a \"Delete account\" option in Settings that permanently removes your account and all your data." },
      { type: "FEATURE", platform: "android", text: "You can now edit your name, email, and gender anytime from your Profile, not just once at sign-up." },
    ],
  },
  {
    version: "0.24.0-beta",
    releaseDate: "2026-08-28",
    platforms: ["android"],
    summary: "The app now has its real icon.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "Replaced the placeholder launcher icon with the real Rupee Radar AI app icon, across every device size." },
    ],
  },


  {
    version: "0.25.0-beta",
    releaseDate: "2026-08-29",
    platforms: ["android", "web"],
    summary: "A profile photo editor, a friendlier Dashboard greeting, and the website's real logo.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Added a photo editor for your profile picture — pinch to zoom and drag to reposition before saving." },
      { type: "IMPROVEMENT", platform: "android", text: "The Dashboard now greets you by your real name and shows your profile photo." },
      { type: "IMPROVEMENT", platform: "web", text: "The website now uses the real Rupee Radar AI logo for its icon, favicon, and link previews." },
    ],
  },
  {
    version: "0.26.0-beta",
    releaseDate: "2026-08-29",
    platforms: ["android"],
    summary: "A big batch from your on-device reports: Net Worth improvements, a Parking Tickets tracker, a redesigned Cashflow Calendar, drag-to-reorder services, and several fixes.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "You can now edit a Net Worth entry after adding it, see a plain \"how this is calculated\" breakdown, and the job-loss runway now explains where you stand when it's low or negative." },
      { type: "IMPROVEMENT", platform: "android", text: "Replaced the cluttered Net Worth allocation chart with a cleaner one." },
      { type: "FIX", platform: "android", text: "Insights now reliably shows your data — it was coming up blank for some accounts even with years of synced SMS." },
      { type: "FEATURE", platform: "android", text: "New Parking Tickets tracker for parking fines and challans, with due dates and paid/unpaid status." },
      { type: "IMPROVEMENT", platform: "android", text: "Redesigned the Cashflow Calendar as a proper month grid with month navigation, a balance trend, and a clearer day view." },
      { type: "IMPROVEMENT", platform: "android", text: "Rearrange your services by pressing and holding a row and dragging it, instead of tapping arrows." },
      { type: "FIX", platform: "android", text: "Fixed the \"Overdue\" label on the Loans screen rendering one letter per line." },
      { type: "FIX", platform: "android", text: "Blinkit transactions now show the correct Blinkit badge and colour instead of Zepto's." },
      { type: "FIX", platform: "android", text: "Fixed the daily-streak counter sometimes showing the wrong number of days." },
      { type: "IMPROVEMENT", platform: "android", text: "The Statement Analyzer is becoming its own dedicated app — it's marked \"Coming Soon\" for now." },
    ],
  },
  {
    version: "0.27.0-beta",
    releaseDate: "2026-08-29",
    platforms: ["android"],
    summary: "SMS scanning now runs in the background, understands EMIs and card statements, and projects what you owe this month and next.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "Scanning your SMS history now runs in the background with a progress notification — it keeps going and doesn't lose progress if you leave the screen." },
      { type: "FEATURE", platform: "android", text: "The scanner now recognises EMI payments and credit-card statement messages (total due, minimum due, due date) and adds them to your Recurring Payments automatically." },
      { type: "FEATURE", platform: "android", text: "The Recurring Payments screen now shows how much you owe this month and next month, itemised." },
      { type: "IMPROVEMENT", platform: "android", text: "The Privacy Policy, Terms, and other help pages now open inside the app instead of switching to your browser." },
    ],
  },
  {
    version: "0.33.0-beta",
    releaseDate: "2026-08-30",
    platforms: ["android"],
    summary: "The app now adapts to how you earn, plus new trackers for product warranties and wishlist savings.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Tell the app whether you're salaried, run a business, create content, or none of these — it then adapts the income wording, the net-worth framing, and the \"what if income stops\" planning to fit. You can change this any time from your Profile." },
      { type: "FEATURE", platform: "android", text: "New Products & Warranty tracker — record what you bought, when, and the warranty period, and keep invoice and receipt photos with it. Photos stay on your phone." },
      { type: "FEATURE", platform: "android", text: "New Wishlist — save towards things you want, add a photo and a link, and watch a progress bar fill as you set money aside." },
      { type: "IMPROVEMENT", platform: "android", text: "Text fields across the app now capitalise names and sentences as you'd expect while typing." },
      { type: "FIX", platform: "android", text: "The Arrange Services screen title is no longer hidden behind the back button." },
    ],
  },
  {
    version: "1.0.0",
    releaseDate: "2026-08-30",
    platforms: ["android"],
    summary: "Rupee Radar AI 1.0 — our first stable release.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "You can now track transactions from your banking-app notifications, as an alternative to SMS — turn it on in Settings." },
      { type: "FEATURE", platform: "android", text: "Export your bank and card transaction SMS to a CSV from the Expenses screen — your data, yours to keep." },
      { type: "FEATURE", platform: "android", text: "Rupee Radar AI PRO can now be purchased directly through Google Play." },
      { type: "IMPROVEMENT", platform: "android", text: "Clearer explanation of exactly what SMS access is used for, shown before the permission is requested." },
    ],
  },
  {
    version: "1.0.1",
    releaseDate: "2026-08-30",
    platforms: ["android"],
    summary: "Sign-in polish and a privacy fix for the Household Vault.",
    highlights: [
      { type: "FIX", platform: "android", text: "Household Vault: members now only ever see each other's name and shared totals — never another member's email, phone, city or income." },
      { type: "IMPROVEMENT", platform: "android", text: "The phone sign-in screen now has a country-code picker (defaults to India) — just type your number." },
    ],
  },
  {
    version: "1.0.3",
    releaseDate: "2026-08-30",
    platforms: ["android"],
    summary: "Instant voucher redemption.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Redeem a voucher with your coins and get the code (and PIN) straight away — no waiting." },
      { type: "FEATURE", platform: "android", text: "New \"My rewards\" list shows every voucher you have redeemed and its code." },
    ],
  },
  {
    version: "1.0.4",
    releaseDate: "2026-08-31",
    platforms: ["android"],
    summary: "PRO is free while we're in beta.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Every PRO feature is free during the beta — open the PRO screen and tap \"Unlock PRO now\", no code or card needed." },
      { type: "FIX", platform: "android", text: "Fixed the \"Have a promo code?\" box not appearing for some testers." },
    ],
  },
  {
    version: "1.0.5",
    releaseDate: "2026-08-31",
    platforms: ["android"],
    summary: "Behind-the-scenes diagnostics.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "Behind-the-scenes reliability and diagnostics improvements to help us spot and fix issues faster during the beta." },
    ],
  },
  {
    version: "1.0.6",
    releaseDate: "2026-08-31",
    platforms: ["android"],
    summary: "Sign-in is now required.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "You now sign in with Google or your phone number before using the app, so your data is always tied to your account and safe across reinstalls." },
      { type: "FIX", platform: "android", text: "Signing out now returns you to the sign-in screen instead of leaving the app open without an account." },
    ],
  },
  {
    version: "1.0.7",
    releaseDate: "2026-08-31",
    platforms: ["android"],
    summary: "Tidier back button.",
    highlights: [
      { type: "FIX", platform: "android", text: "The back button no longer overlaps the text at the top of a screen — every screen now leaves room for it." },
      { type: "IMPROVEMENT", platform: "android", text: "The back button is now a clear coloured circle with a subtle animated arrow." },
    ],
  },
  {
    version: "1.0.8",
    releaseDate: "2026-08-31",
    platforms: ["android"],
    summary: "Mall Mode: Mumbai malls + best card for everyone.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Mall Mode now covers major Mumbai, Thane and Navi Mumbai malls alongside Pune, with a city filter." },
      { type: "IMPROVEMENT", platform: "android", text: "Mall Mode no longer needs cards in your Wallet — it recommends the best credit card for every store from the full catalog, and highlights the ones you own." },
      { type: "FEATURE", platform: "android", text: "New stylized mall map view for browsing stores by floor and wing; card-discount offers show on a store when available." },
    ],
  },
  {
    version: "1.0.9",
    releaseDate: "2026-08-31",
    platforms: ["android"],
    summary: "Parking & Tolls, clearer bills screen.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "\"Parking Tickets\" is now \"Parking & Tolls\" — a log of what you spend on parking and tolls, with a Parking/Toll toggle and cash entry." },
      { type: "IMPROVEMENT", platform: "android", text: "\"Recurring Payments\" is now \"Bills & Subscriptions\", and the \"Pay a Bill\" shortcut is renamed to match where it goes." },
      { type: "FIX", platform: "android", text: "Fixed an extra blank gap at the top of a few screens after the recent back-button change." },
    ],
  },
  {
    version: "1.0.10",
    releaseDate: "2026-08-31",
    platforms: ["android"],
    summary: "A fresher look — part 1.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "New raised \"add an expense\" button in the centre of the bottom bar." },
      { type: "IMPROVEMENT", platform: "android", text: "More colour across the app — every service tile now has its own hue instead of one repeated tint." },
      { type: "IMPROVEMENT", platform: "android", text: "Loan, savings, bills, expense and profile forms now use clean dropdowns (bank, city, type, category) with helpful placeholder hints instead of blank text boxes." },
    ],
  },
  {
    version: "1.0.11",
    releaseDate: "2026-08-31",
    platforms: ["android"],
    summary: "A fresher look — part 2.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "Placeholder hints added across the Todo, Wishlist, Products, Cash Flow, Credit Score and Net Worth forms." },
      { type: "IMPROVEMENT", platform: "android", text: "Insights and Todo section headings now have a subtle colour accent; the Products category is a clean dropdown." },
    ],
  },
  {
    version: "1.0.12",
    releaseDate: "2026-08-31",
    platforms: ["android"],
    summary: "A fresher look — part 3.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "The centre bottom-bar button is now the wallet mark, larger, with the four tabs eased to the sides around it." },
      { type: "IMPROVEMENT", platform: "android", text: "Colour and placeholder-hint polish across the Wallet, Nearby, Rewards, Family Vault and Arrange Services screens." },
    ],
  },
  {
    version: "1.0.13",
    releaseDate: "2026-09-01",
    platforms: ["android"],
    summary: "Budgets + Financial Review.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "New Budgets page — set a monthly spending limit per category and watch progress bars fill through the month." },
      { type: "FEATURE", platform: "android", text: "New Financial Review (PRO) — a plain-language report card on your money for any month, quarter or year, with a grade, what changed, biggest expenses and an AI summary." },
    ],
  },
  {
    version: "1.0.14",
    releaseDate: "2026-09-01",
    platforms: ["android"],
    summary: "Safety Net + Money Leaks.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "New Safety Net (PRO) — your savings rate, emergency-fund runway and debt-to-income, each against the standard benchmark." },
      { type: "FEATURE", platform: "android", text: "New Money Leaks (PRO) — an audit of forgotten subscriptions, bank fees, duplicate charges and categories creeping up, with a monthly recoverable total." },
      { type: "IMPROVEMENT", platform: "android", text: "The Health Score now factors in your emergency fund and debt-to-income (scores will shift slightly)." },
    ],
  },
  {
    version: "1.0.15",
    releaseDate: "2026-09-01",
    platforms: ["android"],
    summary: "Goals + Debt Freedom.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "New Goals planner — set a target amount and date, and we'll work out how much to save each month and whether you're on track." },
      { type: "FEATURE", platform: "android", text: "New Debt Freedom (PRO) — order your loans by the snowball or avalanche method, see your debt-free date, and find out what an extra ₹/month would save in time and interest." },
    ],
  },
  {
    version: "1.0.16",
    releaseDate: "2026-09-01",
    platforms: ["android"],
    summary: "Net worth projection + Spending Habits.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Net Worth now projects forward (PRO) — where your net worth lands in 1, 3, 5 and 10 years at your recent savings pace, with an adjustable return assumption." },
      { type: "FEATURE", platform: "android", text: "New Spending Habits (PRO) — weekday vs weekend, a day-and-time heat map, your most expensive day, payment-method mix, and your average transaction-size trend." },
    ],
  },
  {
    version: "1.0.17",
    releaseDate: "2026-09-01",
    platforms: ["android"],
    summary: "Cash Flow, Money Leaks & Safety Net now read your data. Bug fixes.",
    highlights: [
      { type: "FIX", platform: "android", text: "Cash Flow Calendar, Money Leaks and Safety Net now compute from the transactions and accounts on your phone — they were showing empty or inaccurate results when your SMS had synced under an earlier sign-in." },
      { type: "FIX", platform: "android", text: "Debt Freedom no longer gets stuck on the loading spinner." },
      { type: "FIX", platform: "android", text: "Mall Mode's \"All\" filter now lists every city's malls, not just two." },
      { type: "FIX", platform: "android", text: "Category names in the expense editor now show capitalised (\"Groceries\", not \"groceries\")." },
      { type: "IMPROVEMENT", platform: "android", text: "Spending Overview and Debt Freedom got a visual refresh — category emojis, coloured progress bars and a denser layout." },
    ],
  },
  {
    version: "1.0.18",
    releaseDate: "2026-09-01",
    platforms: ["android"],
    summary: "Recurring-payment detection now runs on your phone.",
    highlights: [
      { type: "FIX", platform: "android", text: "Bills & Subscriptions now detects repeating charges (Airtel, electricity, EMIs, card-bill autopay, streaming…) from the transactions on your phone, so it works even when your SMS synced under an earlier sign-in." },
      { type: "IMPROVEMENT", platform: "android", text: "Each detected payment now suggests the right type (EMI / Card bill / Subscription…) so adding it is one tap." },
    ],
  },
  {
    version: "1.0.19",
    releaseDate: "2026-09-01",
    platforms: ["android"],
    summary: "Reshuffled the bottom navigation.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "Bottom tabs are now Home, Spending Overview, Todo and Loan & EMI, with Financial Review as the centre button — Cards and Profile are still one tap away from the services list and your avatar." },
      { type: "IMPROVEMENT", platform: "android", text: "The services list now leads with Add Expense, Budgets, Insights and Cash Flow." },
    ],
  },
  {
    version: "1.0.20",
    releaseDate: "2026-09-01",
    platforms: ["android"],
    summary: "Cleaner bottom navigation, and a way to reset your custom service order.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "Bottom tabs are now icon-only for a cleaner, better-aligned bar." },
      { type: "FEATURE", platform: "android", text: "Arrange Services now has a \"Reset to default\" button if you'd rearranged things and want to start over." },
    ],
  },
  {
    version: "1.0.21",
    releaseDate: "2026-09-02",
    platforms: ["android"],
    summary: "App-wide bug and polish pass — Dashboard, Expenses, Cards, and Trackers.",
    highlights: [
      { type: "FIX", platform: "android", text: "The \"Save this card\" button on a card's detail page now actually reflects whether it's saved, and correcting a card's info shows a real confirmation." },
      { type: "FIX", platform: "android", text: "Fixed the notification bell undercounting past 20 uncategorized transactions, and dismissing a budget alert now removes it from the bell too, not just the card." },
      { type: "FIX", platform: "android", text: "The \"Best card for everyday spend\" tile no longer shows an arbitrary card when none of your cards actually have a reward value on file." },
      { type: "IMPROVEMENT", platform: "android", text: "Amount fields across Expenses, Todo, Loans, Lending, Savings, and Parking now open the numeric keyboard, and several Save/Log buttons now clearly disable instead of silently doing nothing on invalid input." },
      { type: "IMPROVEMENT", platform: "android", text: "Logging a lending repayment now warns if the amount is more than what's still outstanding." },
      { type: "IMPROVEMENT", platform: "android", text: "The Spending Overview merchant breakdown now scrolls properly for merchants with many transactions in a month." },
      { type: "IMPROVEMENT", platform: "android", text: "Loading and \"not found\" states added to the Card Explorer and Card Detail screens instead of a blank screen." },
    ],
  },
  {
    version: "1.0.22",
    releaseDate: "2026-09-02",
    platforms: ["android"],
    summary: "App-wide bug and polish pass, part 2 — Analytics, Discovery, and Account screens.",
    highlights: [
      { type: "FIX", platform: "android", text: "Net Worth's job-loss runway now works even if your SMS synced under an earlier sign-in — it's computed on your phone now, like the rest of Insights." },
      { type: "FIX", platform: "android", text: "\"Best card nearby\" now actually ranks your real saved cards instead of ignoring them." },
      { type: "FIX", platform: "android", text: "Removing a wallet card, confirming card usage, and logging a lounge visit now show a real error if something goes wrong, instead of always claiming success." },
      { type: "FIX", platform: "android", text: "Fixed a bug where a failed household create/join, or a failed challenge join, could show no error at all." },
      { type: "FIX", platform: "android", text: "Fixed \"Export CSV\" on Tax Nudges silently doing nothing when the export failed." },
      { type: "IMPROVEMENT", platform: "android", text: "Financial Review no longer re-runs its AI summary every time you step between periods you've already viewed." },
      { type: "IMPROVEMENT", platform: "android", text: "Credit Score's date-of-birth field is now a proper date picker, and its mobile number field opens the phone keypad." },
      { type: "IMPROVEMENT", platform: "android", text: "Peer Comparison now tells apart a real connection error from a missing profile." },
      { type: "IMPROVEMENT", platform: "android", text: "Mall Mode's location button now shows a spinner while finding your nearest mall." },
    ],
  },
  {
    version: "1.0.23",
    releaseDate: "2026-09-02",
    platforms: ["android", "backend"],
    summary: "A quick-actions dial on Home, AI-assisted duplicate cleanup for detected bills, and more colour on Spending Overview.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Home now has a draggable quick-actions button — tap it to reach your Quick Actions from anywhere on the screen without scrolling." },
      { type: "FEATURE", platform: "backend", text: "Bills & Subscriptions can now clean up detected candidates with AI — merges the same biller written differently (e.g. \"ZOMATO\" vs \"Zomato Ltd\") so you don't see duplicate entries to confirm." },
      { type: "IMPROVEMENT", platform: "android", text: "Spending Overview now shows category emoji on merchant rows, the chart legend, payment methods, and stat tiles, and its progress bars use a richer gradient fill." },
      { type: "IMPROVEMENT", platform: "android", text: "Budgets' progress bars also got the gradient treatment." },
    ],
  },
  {
    version: "1.0.24",
    releaseDate: "2026-09-02",
    platforms: ["android"],
    summary: "A redesigned Home screen — net worth up top, a new monthly-limit ring, and a quicker way to browse services.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "Home now leads with your net worth and a \"this month\" change, with the Financial Health score and a new Monthly Limit ring side by side just below it." },
      { type: "FEATURE", platform: "android", text: "The new Monthly Limit ring shows how much of your monthly budget you've spent — set category budgets and it tracks the total, otherwise it uses your recent average." },
      { type: "IMPROVEMENT", platform: "android", text: "Services are now a quick side-scrolling row on Home, with the full grid one tap away." },
      { type: "IMPROVEMENT", platform: "android", text: "Upcoming Bills now show two-up with a Pay button, and Recent Transactions has a See All link." },
    ],
  },
  {
    version: "1.0.25",
    releaseDate: "2026-09-02",
    platforms: ["android"],
    summary: "Spending Overview rebuilt around your budgets — filter by payment type, track each category against its limit.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Filter Spending Overview by payment type — All, UPI, Card, Cash, or Auto-detected — and every figure updates." },
      { type: "FEATURE", platform: "android", text: "Each category now shows a 6-month trend, what you've spent against your budget for it, an On Track / Over status, and whether it was picked up from SMS." },
      { type: "IMPROVEMENT", platform: "android", text: "Added a \"daily average\" for the month and a cleaner category breakdown bar." },
    ],
  },
  {
    version: "1.0.26",
    releaseDate: "2026-09-02",
    platforms: ["android"],
    summary: "The Wallet is now a Credit Card Hub — your cards, what you owe, and the best card to use where.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Wallet is rebuilt as a Credit Card Hub: a card carousel, each card's outstanding balance and minimum due with a Pay button, and your reward-point earnings." },
      { type: "FEATURE", platform: "android", text: "\"Best card for category\" suggests which of your cards to use for dining, shopping, fuel and more." },
      { type: "IMPROVEMENT", platform: "android", text: "\"Recommended for you\" surfaces catalog cards worth considering; subscriptions move to a section at the bottom of the hub." },
    ],
  },
  {
    version: "1.0.27",
    releaseDate: "2026-09-02",
    platforms: ["android"],
    summary: "Loans & EMIs redesigned — total outstanding up top, an EMI calendar, and a prepayment optimizer.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "Loans & EMIs now leads with your total outstanding, active-liability count and average rate, then each loan with its balance and payoff progress." },
      { type: "FEATURE", platform: "android", text: "New \"Upcoming EMI Calendar\" shows the next payment due for each loan." },
      { type: "FEATURE", platform: "android", text: "The Loan Optimizer estimates how much interest a small extra monthly payment would save on your priciest loan, with a tap through to the full plan." },
      { type: "IMPROVEMENT", platform: "android", text: "Added \"total interest paid this financial year\" with a tax-deductible flag for home loans." },
    ],
  },
  {
    version: "1.0.28",
    releaseDate: "2026-09-02",
    platforms: ["android"],
    summary: "Small fixes to the Home screen quick-actions dial.",
    highlights: [
      { type: "FIX", platform: "android", text: "The quick-actions dial's labels were hard to read against the dark background — they're now light chips on a dimmed backdrop." },
      { type: "FIX", platform: "android", text: "Removed \"Loan & EMI\" from the default quick actions since it's already a bottom tab; Net Worth takes its place." },
      { type: "FIX", platform: "android", text: "Restored the original centre-tab icon." },
    ],
  },
  {
    version: "1.0.29",
    releaseDate: "2026-09-02",
    platforms: ["android", "backend"],
    summary: "Financial Review redesigned, with a place to track your investments.",
    highlights: [
      { type: "FEATURE", platform: "android", text: "Track your investment holdings — mutual funds, stocks, FDs — on the Financial Review screen, with a portfolio total and per-holding returns. Manual entry, no linking required." },
      { type: "IMPROVEMENT", platform: "android", text: "Financial Review rebuilt: income vs expenses tiles, a savings-rate ring, a 6-month outflow chart, and your top merchants." },
      { type: "IMPROVEMENT", platform: "android", text: "Category names on Financial Review now show their icon, so \"medical\", \"shopping\" etc. are quicker to scan." },
    ],
  },
  {
    version: "1.0.30",
    releaseDate: "2026-09-03",
    platforms: ["android"],
    summary: "Date-handling and data-sync fixes.",
    highlights: [
      { type: "FIX", platform: "android", text: "Fixed transaction, loan and other dates being stored 5½ hours off — a late-evening entry could land on the wrong day (and, at month-end, the wrong month) after syncing to a new device." },
      { type: "FIX", platform: "android", text: "Your net worth history now restores from the server after an app update or reinstall, instead of starting empty." },
      { type: "FIX", platform: "android", text: "Fixed a crash on the Money Leaks screen when two fees or charges landed on the same day." },
      { type: "IMPROVEMENT", platform: "android", text: "Tolls now count as an essential expense in the needs/wants split, matching the rest of the app." },
    ],
  },
  {
    version: "1.0.31",
    releaseDate: "2026-09-03",
    platforms: ["android"],
    summary: "PRO unlock now takes effect immediately.",
    highlights: [
      { type: "FIX", platform: "android", text: "After unlocking PRO, features unlock straight away — you no longer have to leave and re-open the screen." },
      { type: "FIX", platform: "android", text: "A brief connection hiccup can no longer show the PRO paywall to an active subscriber; the app remembers your last confirmed status." },
    ],
  },
  {
    version: "1.0.32",
    releaseDate: "2026-09-03",
    platforms: ["android"],
    summary: "Faster support when something goes wrong.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "Every request now carries a reference id, so a bug report or a 'send diagnostics' can be traced to exactly what happened on the server — support fixes land quicker." },
    ],
  },
  {
    version: "1.0.33",
    releaseDate: "2026-09-03",
    platforms: ["android"],
    summary: "Polish pass: readability, contrast and smoother motion.",
    highlights: [
      { type: "FIX", platform: "android", text: "The Loans 'total outstanding' header is now readable in daylight — the light amber banner was washing out its white text." },
      { type: "FIX", platform: "android", text: "In light mode, cards now cast a real shadow instead of looking like flat outlines." },
      { type: "IMPROVEMENT", platform: "android", text: "The net-worth figure on the home screen no longer re-counts from zero every time you scroll back to it, and screen transitions now share one consistent timing. Respects your device's 'remove animations' setting." },
    ],
  },
  {
    version: "1.0.34",
    releaseDate: "2026-09-03",
    platforms: ["android"],
    summary: "Insight screens now tell you when a load fails — and you can pull to refresh.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "Money Leaks, Safety Net, Budgets and Goals now show a clear 'couldn't load / you're offline' message with a Try Again button instead of a blank 'nothing here yet' screen when a load fails." },
      { type: "IMPROVEMENT", platform: "android", text: "Pull down to refresh on those screens." },
    ],
  },
  {
    version: "1.0.35",
    releaseDate: "2026-09-03",
    platforms: ["android"],
    summary: "Pull-to-refresh on more screens.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "Pull down to refresh on Loans, the Credit Card Hub, Bills & Subscriptions, Financial Review and Spending Overview." },
      { type: "IMPROVEMENT", platform: "android", text: "The Credit Card Hub now shows a proper error with a retry button if it can't reach the server on a fresh install." },
    ],
  },
  {
    version: "1.0.36",
    releaseDate: "2026-09-03",
    platforms: ["android"],
    summary: "Bigger tap targets and a gentler list entrance.",
    highlights: [
      { type: "FIX", platform: "android", text: "The small close/remove buttons on announcements, the SMS scan bar, and lending repayments/installments are now full-size tap targets — no more mis-taps landing on the row behind." },
      { type: "IMPROVEMENT", platform: "android", text: "Goals, Products and Wishlist rows now fade in with a subtle stagger on first open (and not again on scroll-back). Honours 'remove animations'." },
    ],
  },
  {
    version: "1.0.37",
    releaseDate: "2026-09-03",
    platforms: ["android", "web"],
    summary: "A lighter download and groundwork for faster crash fixes.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "The app download is ~2.7 MB smaller — it no longer bundles native code for emulator-only chip types." },
      { type: "IMPROVEMENT", platform: "android", text: "Crash reports are now automatically scrubbed of amounts, phone numbers and account numbers before they leave your device, and never include screenshots or message text." },
      { type: "IMPROVEMENT", platform: "web", text: "The privacy policy now spells out exactly what a crash report contains and how long it's kept." },
    ],
  },
  {
    version: "1.0.38",
    releaseDate: "2026-09-04",
    platforms: ["android"],
    summary: "Crash reporting is now live.",
    highlights: [
      { type: "IMPROVEMENT", platform: "android", text: "If the app crashes, we now get an automatic (scrubbed) report so it can be fixed faster — nothing changes for you." },
    ],
  },
  {
    version: "1.0.39",
    releaseDate: "2026-09-04",
    platforms: ["android", "backend"],
    summary: "Insights spending wheel fixes.",
    highlights: [
      { type: "FIX", platform: "android", text: "The Insights spending wheel no longer includes transfers (like credit-card bill payments) as a spend slice — that slice's label was also being cut off the edge of the chart." },
      { type: "FIX", platform: "android", text: "Wheel labels can no longer render past the edge of the chart." },
    ],
  },
];

async function seedChangelog() {
  for (const entry of entries) {
    await prisma.changelogEntry.upsert({
      where: { version: entry.version },
      create: {
        version: entry.version,
        releaseDate: new Date(entry.releaseDate),
        platforms: entry.platforms,
        summary: entry.summary,
        highlights: entry.highlights,
      },
      update: {
        releaseDate: new Date(entry.releaseDate),
        platforms: entry.platforms,
        summary: entry.summary,
        highlights: entry.highlights,
      },
    });
  }
  console.log(`Seeded ${entries.length} changelog entries.`);
}

seedChangelog()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
