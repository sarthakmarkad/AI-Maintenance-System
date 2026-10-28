"use client";
import type { ComponentProps } from "react";
import { Command as Primitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
export function Command({
  className,
  ...props
}: ComponentProps<typeof Primitive>) {
  return <Primitive className={cn("ui-command", className)} {...props} />;
}
export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof Primitive.Input>) {
  return (
    <div className="ui-command-input-wrap">
      <Search size={19} />
      <Primitive.Input
        className={cn("ui-command-input", className)}
        {...props}
      />
    </div>
  );
}
export function CommandList({
  className,
  ...props
}: ComponentProps<typeof Primitive.List>) {
  return (
    <Primitive.List className={cn("ui-command-list", className)} {...props} />
  );
}
export const CommandEmpty = Primitive.Empty;
export const CommandGroup = Primitive.Group;
export function CommandItem({
  className,
  ...props
}: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item className={cn("ui-command-item", className)} {...props} />
  );
}
