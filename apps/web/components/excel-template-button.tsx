"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { apiBlob } from "@/lib/api";
import { Button } from "./ui/button";
export function ExcelTemplateButton({
  path,
  filename,
  token,
  label = "Download Excel template",
}: {
  path: string;
  filename: string;
  token: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const blob = await apiBlob(path, token);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Could not download the template.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={16} />
        {busy ? "Preparing template…" : label}
      </Button>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </div>
  );
}
