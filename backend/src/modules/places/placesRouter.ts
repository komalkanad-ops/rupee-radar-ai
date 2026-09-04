import { Router } from "express";
import { prisma } from "../../lib/prisma.js";

export const placesRouter = Router();

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

async function resolveMerchantFromLatLng(lat: number, lng: number): Promise<string | null> {
  if (!GOOGLE_PLACES_API_KEY) return null;
  const url =
    `https://places.googleapis.com/v1/places:searchNearby?key=${GOOGLE_PLACES_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask": "places.displayName,places.primaryType",
    },
    body: JSON.stringify({
      maxResultCount: 1,
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 50 } },
    }),
  });
  const data: any = await res.json();
  return data?.places?.[0]?.displayName?.text ?? null;
}

// Consults the admin-managed MerchantCardRecommendation table (merchant name pattern -> category)
// first, since that's a curated mapping instead of a guess. Falls back to null if nothing matches,
// letting the caller fall back to raw substring matching against each card's own categories.
async function resolveCategoryFromMapping(merchant: string): Promise<string | null> {
  const mappings = await prisma.merchantCardRecommendation.findMany();
  const merchantLower = merchant.toLowerCase();
  const match = mappings.find((m) => merchantLower.includes(m.merchantNamePattern.toLowerCase()));
  return match?.category ?? null;
}

// GET /places/recommend?lat=&lng=&merchant=&cardIds=id1,id2,...
// Resolves the merchant at the given coordinates (or uses the merchant name directly if passed),
// then ranks the user's saved cards by which one has a matching merchant_bonus_categories entry —
// preferring the admin-curated merchant->category mapping over raw substring matching.
placesRouter.get("/recommend", async (req, res) => {
  const { lat, lng, merchant: merchantParam, cardIds } = req.query;

  let merchant = merchantParam ? String(merchantParam) : null;
  if (!merchant && lat && lng) {
    merchant = await resolveMerchantFromLatLng(Number(lat), Number(lng));
  }
  if (!merchant) {
    return res.status(400).json({ error: "Could not resolve a merchant — pass merchant= or lat/lng with GOOGLE_PLACES_API_KEY configured" });
  }

  const ids = cardIds ? String(cardIds).split(",") : [];
  const cards = await prisma.creditCard.findMany({
    where: ids.length ? { id: { in: ids } } : {},
    include: { bank: true },
  });

  const mappedCategory = await resolveCategoryFromMapping(merchant);
  const merchantLower = merchant.toLowerCase();
  const ranked = cards
    .map((card) => {
      const bonusCategories = (card.merchantBonusCategories as string[] | null) ?? [];
      const matches = bonusCategories.filter((c) => {
        const cLower = c.toLowerCase();
        if (mappedCategory && cLower === mappedCategory.toLowerCase()) return true;
        return merchantLower.includes(cLower) || cLower.includes(merchantLower);
      });
      return { card, matchScore: matches.length, matchedCategories: matches };
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  res.json({
    merchant,
    resolvedCategory: mappedCategory,
    recommendation: ranked[0]?.matchScore ? ranked[0] : null,
    allRanked: ranked,
  });
});
