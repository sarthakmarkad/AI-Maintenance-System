"use client";
// Shadcn/Radix composition, styled with the project's existing design tokens.
import * as React from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export function DialogContent({
  className,
  children,
  closeLabel = "Close dialog",
  ...props
}: React.ComponentProps<typeof Primitive.Content> & { closeLabel?: string }) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="ui-dialog-overlay" />
      <Primitive.Content
        data-slot="dialog-content"
        className={cn("ui-dialog-content", className)}
        {...props}
      >
        {children}
        <Primitive.Close className="ui-dialog-close" aria-label={closeLabel}>
          <X size={18} />
        </Primitive.Close>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
