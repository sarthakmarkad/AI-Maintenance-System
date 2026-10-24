// Replace with generated DTO aliases after parent integrates OpenAPI generation.
export type WorkOrderNotification = {
  id: string;
  orderId: string;
  title: string;
  kind: string;
  action: string;
  eventVersion: number;
  actorName: string;
  message: string;
  createdAt: string;
  readAt: string | null;
};
export type WorkOrderNotificationsResponse = {
  items: WorkOrderNotification[];
  unread: number;
  nextCursor: string | null;
};
