-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "orderNumber" SERIAL NOT NULL,
ADD COLUMN     "shippingAddress" JSONB,
ADD COLUMN     "trackingNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
