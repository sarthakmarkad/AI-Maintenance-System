"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Search, type LucideIcon } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
type Section = {
  name: string;
  links: { title: string; href: string; icon: LucideIcon }[];
};
const keywords: Record<string, string[]> = {
  Team: ["staff", "people", "members", "invite", "accounts", "roles"],
  "Work orders": [
    "issue",
    "breakdown",
    "repair",
    "investigation",
    "task",
    "RCA",
  ],
  "Maintenance calendar": ["schedule", "plan", "reminder", "recurring"],
  "Manuals & SOPs": ["documents", "reference", "library", "procedure"],
  "Process trends": ["readings", "pressure", "temperature", "patterns"],
  "AI assistant": ["chat", "help", "question"],
  "Email alerts": ["notifications", "inbox", "settings"],
};
export function PageFinder({
  sections,
  onNavigate,
}: {
  sections: Section[];
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter(),
    pathname = usePathname();
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "k"
      )
        return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        !open &&
        (target?.isContentEditable ||
          target?.closest("input,textarea,select") ||
          document.querySelector('[role="dialog"]:not(dialog),dialog[open]'))
      )
        return;
      event.preventDefault();
      setOpen((value) => !value);
      setQuery("");
    }
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [open]);
  function navigate(href: string) {
    changeOpen(false);
    onNavigate();
    router.push(href);
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          type="button"
          className="page-finder-trigger"
          aria-label="Find a page"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Search size={15} />
          <span>Find a page</span>
          <kbd>⌘ K</kbd>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="page-finder-dialog"
        closeLabel="Close page finder"
      >
        <div className="visually-hidden">
          <DialogTitle>Find a page</DialogTitle>
          <DialogDescription>
            Jump to a workspace page. Search by page name or task.
          </DialogDescription>
        </div>
        <Command loop label="Search workspace pages">
          <CommandInput
            autoFocus
            aria-label="Search workspace pages"
            placeholder="Where do you want to go?"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty className="ui-command-empty">
              No pages found. Try a page name such as calendar or work orders.
            </CommandEmpty>
            {sections.map((section) => (
              <CommandGroup key={section.name} heading={section.name}>
                {section.links.map(({ title, href, icon: Icon }) => (
                  <CommandItem
                    key={href}
                    value={title}
                    keywords={keywords[title]}
                    onSelect={() => navigate(href)}
                  >
                    <span className="command-item-icon">
                      <Icon size={17} />
                    </span>
                    <span>{title}</span>
                    {href === pathname ? (
                      <small>Current page</small>
                    ) : (
                      <ArrowRight className="command-item-arrow" size={15} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="page-finder-footer">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> Navigate
            </span>
            <span>
              <kbd>↵</kbd> Open page
            </span>
            <span>
              <kbd>esc</kbd> Close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
