import { finish, type ReportSnapshot } from "../reports/model";
export function reportFixture(
  report = "work-orders",
  count = 3,
  detail = false,
): ReportSnapshot {
  const planned = report === "planned-maintenance",
    investigation = report === "investigations";
  const rows = Array.from({ length: count }, (_, i) => ({
    id: "fixture-" + i,
    orderId: "fixture-" + i,
    cells: planned
      ? [
          "23 Oct 2026, 12:00:00 am IST",
          "TEST weekly inspection " + i,
          "TEST technician",
          i % 2 ? "Closed" : "Not released",
          "Not recorded",
          "Not recorded",
        ]
      : [
          "WO-TEST000" + i + "\nTEST pressure-device inspection " + i,
          investigation ? "In progress" : "Breakdown",
          investigation ? "TEST technician" : "In progress",
          investigation ? "Inconclusive" : "TEST technician",
          "23 Oct 2026, 12:00:00 am IST",
          "Not recorded",
        ],
  }));
  return finish({
    report,
    title: detail
      ? "Individual maintenance report"
      : planned
        ? "Planned maintenance report"
        : investigation
          ? "Investigation outcomes report"
          : "Maintenance work-order report",
    organization: "TEST organization - synthetic QA fixture",
    machineCode: "WH-C",
    machineName: "TEST fixture machine",
    generatedAt: "2026-10-23T10:00:00.000Z",
    requestedBy: "TEST reviewer",
    requestedRole: "Maintenance head",
    from: detail ? "" : "2026-10-01",
    to: detail ? "" : "2026-10-23",
    basis: detail
      ? "Work order WO-TEST0001 / version 65"
      : planned
        ? "Due date"
        : "Created date",
    status: "ALL",
    kind: null,
    total: count,
    counts: { open: count, closed: 0, skipped: 0 },
    warning: investigation
      ? "SYNTHETIC statistical evidence. No actual machine fault or production-loss cause is established."
      : null,
    notes: [
      "Synthetic QA fixture only; not an actual operational report.",
      "Dates use IST. Individual work-order reports retain the complete event history.",
      "Attachment bytes are excluded; file details are a manifest only.",
    ],
    columns: planned
      ? [
          "Fixed due (IST)",
          "Task",
          "Current / planned technician",
          "Current stage",
          "Performed (IST)",
          "Closed (IST)",
        ]
      : investigation
        ? [
            "Reference / title",
            "Current stage",
            "Technician",
            "Current outcome",
            "Created (IST)",
            "Closed (IST)",
          ]
        : [
            "Reference / title",
            "Type",
            "Current stage",
            "Technician",
            "Created (IST)",
            "Closed (IST)",
          ],
    rows,
    sheets: [
      {
        name: "Fixture records",
        headers: ["ID", "Title", "Current stage", "Test value"],
        rows: Array.from({ length: count }, (_, i) => [
          "fixture-" + i,
          "TEST pressure-device inspection " + i,
          "In progress",
          i,
        ]),
      },
    ],
    ...(detail
      ? {
          sections: [
            {
              title: "Original report",
              fields: [
                {
                  label: "Work order",
                  value: "WO-TEST0001 - synthetic QA only",
                },
                { label: "Title", value: "TEST pressure-device investigation" },
                { label: "Technician", value: "TEST तपासणी तंत्रज्ञ" },
                {
                  label: "Findings",
                  value: "TEST long findings. ".repeat(170),
                },
              ],
            },
            {
              title: "Complete action history (65 events, oldest first)",
              fields: Array.from({ length: 65 }, (_, i) => ({
                label: `v${i + 1} TEST history event / 23 Oct 2026, 3:30:00 pm IST`,
                value: `TEST actor (Technician)\nIn progress -> In progress\n${i === 64 ? "FINAL HISTORY MARKER" : "TEST retained findings and checks. ".repeat(4)}`,
              })),
            },
            {
              title: "Attachment manifest (1 file)",
              fields: [
                {
                  label: "TEST pressure inspection.png",
                  value:
                    "Synthetic fixture; image bytes are not embedded.\nimage/png; 68 bytes; SHA-256 " +
                    "a".repeat(64) +
                    "\nTEST technician, 23 Oct 2026, 3:30:00 pm IST, v65",
                },
              ],
            },
          ],
        }
      : {}),
  });
}
