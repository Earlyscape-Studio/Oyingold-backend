export const ORDER_STEPS = [
  "Order Placed",
  "Payment confirmed",
  "Processing",
  "Shipped",
  "Delivered",
] as const;

type OrderStatus =
  | "PENDING_PAYMENT"
  | "UNFULFILLED"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED";


const STATUS_TO_STEP: Record<OrderStatus, number | null> = {
  PENDING_PAYMENT: 1,
  UNFULFILLED: 2,
  PROCESSING: 3,
  SHIPPED: 4,
  DELIVERED: 5,
  CANCELLED: null,
};

export function formatOrderNumber(orderNumber: number) {
  return `OG-${String(orderNumber).padStart(6, "0")}`;
}

// Include used for every customer-facing order query. Keeps responses lean.
export const CUSTOMER_ORDER_INCLUDE = {
  items: {
    select: {
      id: true,
      pricingType: true,
      unitPrice: true,
      quantity: true,
      productVariant: {
        select: {
          unitLabel: true,
          product: { select: { id: true, name: true, images: true } },
        },
      },
    },
  },
} as const;

type OrderRow = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  totalAmount: unknown;
  trackingNumber: string | null;
  shippingAddress: unknown;
  createdAt: Date;
  items: Array<{
    id: string;
    pricingType: string;
    unitPrice: unknown;
    quantity: number;
    productVariant: {
      unitLabel: string;
      product: { id: string; name: string; images: string[] };
    };
  }>;
};

export function presentOrder(order: OrderRow) {
  return {
    id: order.id,
    reference: formatOrderNumber(order.orderNumber),
    status: order.status,
    step: STATUS_TO_STEP[order.status],
    total: Number(order.totalAmount),
    trackingNumber: order.trackingNumber,
    shippingAddress: order.shippingAddress,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productVariant.product.id,
      name: item.productVariant.product.name,
      unitLabel: item.productVariant.unitLabel,
      image: item.productVariant.product.images[0] ?? null,
      pricingType: item.pricingType,
      unitPrice: Number(item.unitPrice),
      quantity: item.quantity,
    })),
  };
}