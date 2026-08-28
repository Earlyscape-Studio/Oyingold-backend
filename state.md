## This File records details about the current state of the project

#### These were flagged about the db schema:
- piecePrice is nullable on ProductVariant — matches the price list having some SKUs with only a carton price. Once you hear back from the client on that, you may just need a sellsByPiece: Boolean toggle instead of relying on null-checks, but this works fine for tomorrow.
- unitPrice is snapshotted on OrderItem rather than looked up live from the variant — so price changes later don't retroactively change past orders.
- pricingType on OrderItem records whether that line was bought at carton or piece rate, since a customer could buy either.
- Left out Variant attributes like color/size since this catalog doesn't need them — unit label (e.g. "5 Litre") does the job here.




