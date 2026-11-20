// Auction service. DB-backed (prisma.auctionListing) with race-safe buy.
//
// Key invariants:
//   - list() validates qty/price ranges and total transaction cap
//   - buy() uses atomic deleteMany so two concurrent buyers can't both win
//   - On addToInventory failure post-claim, re-list (don't lose the item)
//   - cancel() returns item via mail (avoids inventory-full edge case)

import type { PrismaClient } from "@prisma/client";
import { ITEMS } from "@game/shared";

const MAX_QTY = 99;
const MAX_PRICE = 10_000_000;
const MAX_TOTAL = 999_999_999;
const LIST_FEE_RATIO = 0.01;
const SEARCH_LIMIT = 100;

export type ListInput = { sellerName: string; itemId: string; qty: number; pricePer: number };
export type Listing = { id: string; sellerName: string; itemId: string; qty: number; pricePer: number };

export type ListValidation =
  | { ok: true; fee: number; total: number }
  | { ok: false; reason: "qty" | "price" | "total-too-large" };

export type ClaimResult =
  | { ok: true; listing: Listing; total: number }
  | { ok: false; reason: "missing" | "self-buy" | "lost-race" | "error" };

export class Auction {
  constructor(private prisma: PrismaClient) {}

  /** Validate price/qty pair. Returns the fee + total so caller can charge. */
  validateList(qty: number, pricePer: number): ListValidation {
    if (qty < 1 || qty > MAX_QTY) return { ok: false, reason: "qty" };
    if (pricePer < 1 || pricePer > MAX_PRICE) return { ok: false, reason: "price" };
    const total = qty * pricePer;
    if (total > MAX_TOTAL) return { ok: false, reason: "total-too-large" };
    return { ok: true, total, fee: Math.max(1, Math.floor(total * LIST_FEE_RATIO)) };
  }

  async create(input: ListInput): Promise<Listing | null> {
    try {
      const row = await (this.prisma as any).auctionListing.create({ data: input });
      return row as Listing;
    } catch (e) {
      console.error("[auction.create]", e);
      return null;
    }
  }

  async browse(search?: string): Promise<Listing[]> {
    try {
      const where = search ? { itemId: { contains: search.toLowerCase() } } : undefined;
      return await (this.prisma as any).auctionListing.findMany({
        where, orderBy: { pricePer: "asc" }, take: SEARCH_LIMIT,
      }) as Listing[];
    } catch (e) {
      console.error("[auction.browse]", e);
      return [];
    }
  }

  /**
   * Atomically claim a listing as buyer. Returns the listing details on
   * success so caller can grant items + transfer zeny. The atomic
   * deleteMany guarantees at most one buyer wins per listing.
   */
  async claimForBuy(id: string, buyerName: string): Promise<ClaimResult> {
    try {
      const listing = await (this.prisma as any).auctionListing.findUnique({ where: { id } });
      if (!listing) return { ok: false, reason: "missing" };
      if (listing.sellerName === buyerName) return { ok: false, reason: "self-buy" };

      const claim = await (this.prisma as any).auctionListing.deleteMany({
        where: { id, sellerName: { not: buyerName } },
      });
      if (claim.count === 0) return { ok: false, reason: "lost-race" };

      return { ok: true, listing, total: listing.pricePer * listing.qty };
    } catch (e) {
      console.error("[auction.claimForBuy]", e);
      return { ok: false, reason: "error" };
    }
  }

  /** Re-create a listing — used when the buyer's inventory was full so we can't deliver. */
  async relist(listing: Listing): Promise<void> {
    try {
      await (this.prisma as any).auctionListing.create({
        data: {
          sellerName: listing.sellerName, itemId: listing.itemId,
          qty: listing.qty, pricePer: listing.pricePer,
        },
      });
    } catch (e) {
      console.error("[auction.relist]", e);
    }
  }

  /**
   * Cancel a listing if owned by sellerName. Returns the listing so caller
   * can mail the item back. Returns null if listing missing or wrong owner.
   */
  async cancel(id: string, sellerName: string): Promise<Listing | null> {
    try {
      const listing = await (this.prisma as any).auctionListing.findUnique({ where: { id } });
      if (!listing || listing.sellerName !== sellerName) return null;
      const claim = await (this.prisma as any).auctionListing.deleteMany({
        where: { id, sellerName },
      });
      return claim.count > 0 ? (listing as Listing) : null;
    } catch (e) {
      console.error("[auction.cancel]", e);
      return null;
    }
  }

  async registerHandlers(
    getPlayer: (sid: string) => any,
    sendToClient: (sid: string, type: string, data: any) => void,
    addToInventory: (p: any, itemId: string, qty: number) => boolean,
    sendMail: (input: any) => Promise<void>,
    auditLog: (action: string, opts: Record<string, unknown>) => void = () => {},
  ) {
    return {
      "auction:list": async (client: any, msg: any) => {
        const p = getPlayer(client.sessionId);
        if (!p) return;
        const invIndex = msg?.invIndex | 0;
        if (!Number.isInteger(invIndex) || invIndex < 0 || invIndex >= p.inventory.length) return;
        const stack = p.inventory[invIndex];
        const qty = msg?.qty | 0;
        const pricePer = msg?.pricePer | 0;
        const v = this.validateList(qty, pricePer);
        if (!v.ok) {
          const reason = (v as { ok: false; reason: string }).reason;
          const reasonMsg = reason === "qty" ? "Geçersiz miktar (1-99)"
            : reason === "price" ? "Fiyat üst sınırı aştı (10M zeny)"
            : "Toplam fiyat çok yüksek (üst sınır 999M zeny)";
          return sendToClient(client.sessionId, "system", { text: reasonMsg });
        }
        if (!stack || stack.qty < qty) return sendToClient(client.sessionId, "system", { text: "Yeterli eşya yok" });
        // Reject items not present in the ITEMS registry — otherwise the
        // listing becomes stranded (buyer cannot accept addToInventory).
        if (!ITEMS[stack.itemId]) return sendToClient(client.sessionId, "system", { text: "Bu eşya ilana çıkarılamaz" });
        if (p.zeny < v.fee) return sendToClient(client.sessionId, "system", { text: `İlan komisyonu için ${v.fee}z gerekli` });
        const created = await this.create({ sellerName: p.name, itemId: stack.itemId, qty, pricePer });
        if (!created) return sendToClient(client.sessionId, "system", { text: "⚠ İlan oluşturulamadı" });
        p.zeny -= v.fee;
        stack.qty -= qty;
        if (stack.qty <= 0) p.inventory.splice(invIndex, 1);
        sendToClient(client.sessionId, "system", { text: `📢 ${qty} adet ilan verildi @${pricePer}z` });
        auditLog("auction.list", { metadata: { sellerName: p.name, itemId: stack.itemId, qty, pricePer } });
      },

      "auction:browse": async (client: any, msg: any) => {
        const listings = await this.browse(String(msg?.search ?? ""));
        sendToClient(client.sessionId, "auction:browse", { listings });
      },

      "auction:buy": async (client: any, msg: any) => {
        const p = getPlayer(client.sessionId);
        if (!p) return;
        const r = await this.claimForBuy(String(msg?.id ?? ""), p.name);
        if (!r.ok) {
          const reasonMsg = r.reason === "missing" ? "Eşya satın alınmış ya da silinmiş"
            : r.reason === "self-buy" ? "Kendi eşyanı satın alamazsın"
            : r.reason === "lost-race" ? "Eşyayı başka biri satın aldı"
            : "⚠ Satın alma sırasında hata oluştu";
          return sendToClient(client.sessionId, "system", { text: reasonMsg });
        }
        if (p.zeny < r.total) {
          await this.relist(r.listing);
          return sendToClient(client.sessionId, "system", { text: `Yeterli para yok (${r.total}z gerekli)` });
        }
        const ok = addToInventory(p, r.listing.itemId, r.listing.qty);
        if (!ok) {
          await this.relist(r.listing);
          return sendToClient(client.sessionId, "system", { text: "Çanta dolu — eşya yeniden ilana kondu" });
        }
        p.zeny -= r.total;
        await sendMail({
          fromName: "AUCTION", toName: r.listing.sellerName,
          subject: `Satıldı: ${r.listing.itemId} ×${r.listing.qty}`,
          body: `${r.listing.itemId} ×${r.listing.qty} satıldı, toplam ${r.total}z`,
          zeny: r.total,
        });
        sendToClient(client.sessionId, "system", { text: `✅ ${r.listing.itemId} ×${r.listing.qty} satın alındı (-${r.total}z)` });
        auditLog("auction.buy", { metadata: { buyerName: p.name, listing: r.listing, total: r.total } });
      },

      "auction:cancel": async (client: any, msg: any) => {
        const p = getPlayer(client.sessionId);
        if (!p) return;
        const listing = await this.cancel(String(msg?.id ?? ""), p.name);
        if (!listing) return;
        // Refund the listing fee — was charged at create time. Without this,
        // canceling silently destroys the fee, which feels like a bug to
        // players and a gold sink that bypasses the auction's intent.
        const v = this.validateList(listing.qty, listing.pricePer);
        const feeRefund = v.ok ? v.fee : 0;
        await sendMail({
          fromName: "AUCTION", toName: p.name,
          subject: `İptal: ${listing.itemId} ×${listing.qty}`,
          body: feeRefund > 0 ? `İlanı iptal ettin (komisyon iadesi ${feeRefund}z)` : "İlanı iptal ettin",
          zeny: feeRefund, itemId: listing.itemId, itemQty: listing.qty,
        });
        sendToClient(client.sessionId, "system", { text: "İlan iptal edildi" });
        auditLog("auction.cancel", { metadata: { sellerName: p.name, listing, feeRefund } });
      },
    };
  }
}

export { MAX_QTY, MAX_PRICE, MAX_TOTAL, LIST_FEE_RATIO };