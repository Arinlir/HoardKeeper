/*
 * Where to actually buy a card.
 *
 * Deliberately built from the card's name rather than stored per card:
 * Scryfall hands out per-printing purchase URLs, but keeping three long URLs
 * on every row of a ten-thousand-card collection to save one search box is a
 * poor trade. These open the shop's own search, which is where you'd end up
 * anyway — and they work for cards added years ago.
 */

export function buyLinks(card) {
  const name = (card?.name || "").split("//")[0].trim();
  if (!name) return [];
  const q = encodeURIComponent(name);
  return [
    {
      key: "cardmarket",
      label: "Cardmarket",
      hint: "European market, prices in €",
      url: `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${q}`,
    },
    {
      key: "tcgplayer",
      label: "TCGplayer",
      hint: "US market, prices in $",
      url: `https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${q}`,
    },
    {
      key: "scryfall",
      label: "Scryfall",
      hint: "Every printing, all prices",
      url: card?.scryfallUri || `https://scryfall.com/search?q=${q}`,
    },
  ];
}
